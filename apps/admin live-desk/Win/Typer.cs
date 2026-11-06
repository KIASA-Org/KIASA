using System.Collections.Concurrent;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Automation;
using System.Windows.Automation.Text;
using LiveDesk.Core;

namespace LiveDesk.Win;

/// <summary>Why words are waiting instead of going in.</summary>
public enum Hold { None, NoBox, Selected, KeysDown }

/// <summary>Puts words where the cursor is, and only when it is safe: in a box that takes words, with
/// no keys held and no text selected (writing over a selection would replace it). Otherwise the words
/// wait, and nothing is lost.
///
/// How, and why, all measured on Windows 11 with Notepad (Nov 2026):
/// - Not typed key by key: at any useful speed it comes out as "hhhhhere,hhhh", and saves that way.
/// - Pasted, in one piece, which also undoes as one. But other programs open the clipboard the moment
///   it changes (Remote Desktop, HelpWire, Windows itself), and a paste that meets one of them silently
///   does nothing: 29 of 40 sentences were lost like that. A program asking for the words does not
///   prove anything either, as those programs ask too.
/// - So: wait for the clipboard to go quiet, paste, and read back the words before the cursor. They
///   changed: it went in. They did not: paste again. That lost and doubled nothing in 150 sentences.
///
/// What was on the clipboard is put back, unless the person has copied something since. The words stay
/// out of Windows' clipboard history and cloud clipboard: nothing is kept.</summary>
public sealed class Typer : IDisposable
{
    private const int QuietMs = 25;           // the clipboard unopened for this long, before pasting
    private const int QuietAtMostMs = 300;
    private const int LandsWithinMs = 600;    // how long a paste gets to show before the next try
    private const int Tries = 3;
    private const int UnseenQuietMs = 120;    // a box that cannot be read back: more care instead
    private const int UnseenSettleMs = 250;
    private const int MostAtOnce = 20_000;    // characters in one paste
    private const long PutBackAfterMs = 450;  // quiet this long, and the person's clipboard goes back
    private const int SlowKeyMs = 16;         // a box that refuses pasting gets typed, at a safe speed
    private const long WordsPutBackAfterMs = 1_500; // word by word, the next word is usually about to come
    private const int TakenBackWithinMs = 700;      // the box has not changed for this long: it is not going to
    private const int TakeBackSettledMs = 150;      // not changing for this long: the keys have all arrived
    private const int MostTooFar = 40;              // further past the words than this is not our keys
    private const int BackKeysAtOnce = 6;
    private const long UnknownAtMostMs = 1_500; // how long to wait on a box that says nothing about itself

    private readonly CaretTracker _caret;
    private readonly ConcurrentQueue<string> _waiting = new();
    private readonly AutoResetEvent _wake = new(false);
    private readonly Thread _thread;
    private readonly Clipboard _clipboard = new();
    private volatile bool _stop;
    private volatile int _clearAsked;
    private volatile Hold _hold;
    private int _count;
    private long _unknownSince;
    private string? _again;   // words that did not go in, as the person moved away just then
    private IntPtr _wordsBox;

    /// <summary>Word by word, when on. The typer asks it for the next change whenever it is ready, so
    /// that a slow box gets fewer, bigger changes, and never falls behind.</summary>
    public WordWriter? Words { get; set; }

    /// <summary>There may be something new to write.</summary>
    public void Nudge() => _wake.Set();

    /// <summary>Something about the waiting words changed. Runs on the typer's thread.</summary>
    public event Action? Changed;
    /// <summary>Words went in. Runs on the typer's thread.</summary>
    public event Action? WentIn;

    public Typer(CaretTracker caret)
    {
        _caret = caret;
        _thread = new Thread(Run) { IsBackground = true, Name = "typer" };
        _thread.SetApartmentState(ApartmentState.STA);
        _thread.Start();
    }

    public int Waiting => Volatile.Read(ref _count);
    public Hold Holding => _hold;

#if DESK_TEST
    /// <summary>In a test build words go only into a window with this in its title: the tests run on
    /// a computer someone is using, and must never write into whatever they have open.</summary>
    public static string? OnlyInto = Environment.GetEnvironmentVariable("KIASA_DESK_ONLY_INTO");
#endif

    public void Write(string words)
    {
        if (string.IsNullOrWhiteSpace(words)) return;
        _waiting.Enqueue(words);
        Interlocked.Increment(ref _count);
        _wake.Set();
        Changed?.Invoke();
    }

    /// <summary>Forget what has not gone in yet.</summary>
    public void Clear()
    {
        _clearAsked = 1;
        _wake.Set();
    }

    private void Run()
    {
        _clipboard.Open();
        long putBackAt = 0;
        while (!_stop)
        {
            if (_clearAsked == 1)
            {
                _clearAsked = 0;
                _again = null;
                Take(int.MaxValue, _ => { });
                SetHold(Hold.None);
                Changed?.Invoke();
            }
            var words = Words;
            if (_again == null && _waiting.IsEmpty && (words == null || !words.HasWork(Environment.TickCount64)))
            {
                SetHold(Hold.None);
                if (putBackAt != 0 && Environment.TickCount64 >= putBackAt)
                {
                    _clipboard.PutBack();
                    putBackAt = 0;
                }
                var wait = putBackAt != 0 ? (int)Math.Max(1, putBackAt - Environment.TickCount64) : -1;
                // Word by word, a word being held goes in once it has gone quiet: look again soon.
                if (words is { On: true }) wait = wait < 0 ? 40 : Math.Min(wait, 40);
                _clipboard.Wait(_wake, wait);
                continue;
            }
            var hold = Check(out var target);
            SetHold(hold);
            if (hold != Hold.None)
            {
                // While waiting on the person, their clipboard is theirs.
                if (putBackAt != 0) { _clipboard.PutBack(); putBackAt = 0; }
                _clipboard.Wait(_wake, 60);
                continue;
            }

            if (_again == null && _waiting.IsEmpty)
            {
                WriteWords(words!, target);
                putBackAt = Environment.TickCount64 + WordsPutBackAfterMs;
                continue;
            }

            // Everything waiting goes in as one paste: fewer times the clipboard changes, fewer collisions.
            var text = new StringBuilder();
            var between = target.NewLines ? "\r\n" : " ";
            if (_again != null) text.Append(_again);
            _again = null;
            Take(MostAtOnce, words => text.Append(text.Length > 0 ? between : "").Append(words.Trim()));
            if (text.Length == 0) continue;
            _again = PasteOrType(target.NewLines ? text.ToString() : text.Append(' ').ToString(), target);
            // A new line after the last sentence is its own key: LibreOffice drops one at the end of a paste.
            // Never on a selection: Enter would replace it, whatever was chosen in that instant.
            if (_again == null && target.NewLines && Native.GetForegroundWindow() == target.Window && _caret.LookNow() is not { Selected: true }) PressEnter();
            if (_again == null) WentIn?.Invoke();
            putBackAt = Environment.TickCount64 + PutBackAfterMs;
            Changed?.Invoke();
        }
        _clipboard.PutBack();
        _clipboard.Close();
    }

    /// <summary>The next change word by word. A word is put right only after seeing that what would
    /// be taken back is really what is before the cursor, so the person's own text is never touched:
    /// if they moved the cursor or typed, or the box cannot be read back, what is there stays.</summary>
    private void WriteWords(WordWriter words, Target target)
    {
        if (target.Focus != _wordsBox)
        {
            // Another box: what went into the last one is not here to put right.
            words.Freeze();
            _wordsBox = target.Focus;
        }
        var edit = words.Next(target.NewLines ? "\n" : " ", Environment.TickCount64);
        if (edit == null) return;
        if (edit.Delete > 0)
        {
            var left = TakeBack(edit.TakeBack, target);
            if (left < 0 || left >= edit.Delete)
            {
                words.Freeze();
                return;
            }
            if (left > 0)
            {
                // Part of it went: those words are written again, and the rest is taken back next time.
                words.TookBack(edit.Delete - left);
                return;
            }
        }
        var text = edit.Insert;
        var newLine = text.EndsWith('\n');   // Its own key, as LibreOffice drops one at the end of a paste.
        if (newLine) text = text[..^1];
        if (text.Length > 0 && PasteOrType(text.Replace("\n", "\r\n"), target) == text.Replace("\n", "\r\n"))
        {
            // None of it went in: the person moved away just then. It goes in when they come back.
            words.TookBackOnly(edit);
            return;
        }
        if (newLine && Native.GetForegroundWindow() == target.Window && _caret.LookNow() is not { Selected: true }) PressEnter();
        words.Applied(edit);
        WentIn?.Invoke();
        Changed?.Invoke();
    }

    /// <summary>Takes the words back and looks at what really happened. Gives back how many of them are
    /// still there: 0 when all are gone, all of them when nothing was touched, below zero if what is
    /// there is no longer what was written (the person typed or moved the cursor).
    ///
    /// Measured in Notepad: of about 30 Backspace presses sent together, 2 did nothing, and the words that
    /// followed ran on from what was left ("w3CORRECTED"). And sending some 370 took longer than any fixed
    /// time allowed, so a take-back that had worked was reported as failed, and writing carried on from
    /// after words no longer there ("it would tak has truly made me"). So this waits for the box to stop
    /// changing, however long the keys take, and never assumes.</summary>
    private int TakeBack(string words, Target target)
    {
        var before = BeforeCursor(words.Length);
        if (before == null) return words.Length;
        var had = Plain(before);
        var gone = Plain(words);
        if (!had.EndsWith(gone, StringComparison.Ordinal)) return words.Length;
        var keep = had.Length - gone.Length;
        var startOfBox = before.Length < Window(words.Length);   // All of the box is in what was read.
        var left = gone.Length;
        for (var again = false; ; again = true)
        {
            var keys = gone[..left].Count(c => !char.IsLowSurrogate(c));
            var sent = PressBack(keys, target.Window);
            if (sent < keys) return left - sent;   // The person moved away: the keys stopped there.
            var there = Settled(had, keep, startOfBox, words.Length, again);
            if (there < 0) return -1;
            if (there < keep)
            {
                // Pressing again went too far: what was there before these words goes back.
                return PasteOrType(had[there..keep].Replace("\n", "\r\n"), target) == null ? 0 : -1;
            }
            var still = there - keep;
            if (still == 0 || still >= left) return still;
            left = still;
        }
    }

    /// <summary>Presses Backspace, only while the window is still in front. Gives back how many were sent.</summary>
    private int PressBack(int keys, IntPtr window)
    {
        var size = Marshal.SizeOf<Native.INPUT>();
        for (var sent = 0; sent < keys; sent += BackKeysAtOnce)
        {
            if (Native.GetForegroundWindow() != window) return sent;
            var now = Math.Min(BackKeysAtOnce, keys - sent);
            var inputs = new Native.INPUT[now * 2];
            for (var i = 0; i < now; i++)
            {
                inputs[i * 2] = BackKey(false);
                inputs[i * 2 + 1] = BackKey(true);
            }
            Native.SendInput((uint)inputs.Length, inputs, size);
            if (sent + BackKeysAtOnce < keys) _clipboard.Idle(1);
        }
        return keys;
    }

    /// <summary>How many characters of what was there are there now, once it has stopped changing.
    /// Below zero if what is there is not that: something else has changed it.</summary>
    private int Settled(string had, int keep, bool startOfBox, int length, bool pressedAgain)
    {
        var last = -2;
        var changedAt = Environment.TickCount64;
        while (true)
        {
            _clipboard.Idle(5);
            var raw = BeforeCursor(length);
            var there = raw == null ? last : Remaining(had, Plain(raw), keep, startOfBox);
            var now = Environment.TickCount64;
            if (there != last)
            {
                last = there;
                changedAt = now;
            }
            // Keys pressed a second time may still be arriving, even when it reads right.
            if (there == keep && !pressedAgain) return there;
            if (there >= 0 && now - changedAt >= TakeBackSettledMs) return there;
            if (now - changedAt >= TakenBackWithinMs) return Math.Max(there, -1);
        }
    }

    /// <summary>Backspace only takes from the end, so what is before the cursor now is the start of what
    /// was there. This finds how much of it. Below zero if it is not that at all.</summary>
    private static int Remaining(string had, string now, int keep, bool startOfBox)
    {
        var least = Math.Max(0, keep - MostTooFar);
        if (startOfBox) return now.Length >= least && had.StartsWith(now, StringComparison.Ordinal) ? now.Length : -1;
        if (now.Length == 0) return -1;
        for (var length = had.Length; length >= Math.Max(1, least); length--)
        {
            var compare = Math.Min(length, now.Length);
            if (now.AsSpan(now.Length - compare).SequenceEqual(had.AsSpan(length - compare, compare))) return length;
        }
        return -1;
    }

    private static int Window(int length) => Math.Max(240, length * 2);

    private static Native.INPUT BackKey(bool up) => new()
    {
        type = Native.INPUT_KEYBOARD,
        u = new Native.INPUTUNION { ki = new Native.KEYBDINPUT { wVk = Native.VK_BACK, dwFlags = up ? Native.KEYEVENTF_KEYUP : 0 } },
    };

    /// <summary>Text as different programs give it back: their own new lines and hard spaces.</summary>
    private static string Plain(string text) =>
        text.Replace("\r\n", "\n").Replace('\r', '\n').Replace('\v', '\n').Replace('\u00A0', ' ');

    /// <summary>Takes waiting words up to about this many characters; always at least one sentence.</summary>
    private void Take(int most, Action<string> use)
    {
        var taken = 0;
        while (taken < most && _waiting.TryDequeue(out var words))
        {
            use(words);
            taken += words.Length;
            Interlocked.Decrement(ref _count);
        }
    }

    /// <summary>Puts the words in. Gives back whatever did not go in, because the person moved to another
    /// window just then: it waits for them to come back, and is not counted as written.</summary>
    private string? PasteOrType(string text, Target target)
    {
        var before = BeforeCursor(text.Length);
        _clipboard.Offer(text);
        if (before == null)
        {
            // This box cannot say what it holds (LibreOffice cannot). No reading back, so more care.
            _clipboard.WaitForQuiet(UnseenQuietMs, QuietAtMostMs * 2);
            if (Native.GetForegroundWindow() != target.Window) return text;
            _clipboard.PressPaste();
            _clipboard.Idle(UnseenSettleMs);
            return null;
        }
        for (var attempt = 0; attempt < Tries; attempt++)
        {
            _clipboard.WaitForQuiet(QuietMs, QuietAtMostMs);
            if (Native.GetForegroundWindow() != target.Window) return text;
            _clipboard.PressPaste();
            var until = Environment.TickCount64 + LandsWithinMs;
            while (Environment.TickCount64 < until)
            {
                _clipboard.Idle(8);
                var now = BeforeCursor(text.Length);
                if (now != null && now != before) return null;
            }
            // Moved away with nothing to show for it: this paste met the other window, or nothing.
            if (Native.GetForegroundWindow() != target.Window) return text;
        }
        // Three pastes and the words before the cursor have not changed: it does not take pastes.
        return TypeSlowly(text, target);
    }

    /// <summary>The words just before the cursor; null if this box cannot say. Long enough that
    /// the same short sentence said again still shows as a change.</summary>
    private string? BeforeCursor(int length)
    {
        var chars = Window(length);
        var look = Task.Run(() =>
        {
            try
            {
                var element = AutomationElement.FocusedElement;
                if (element == null || !element.TryGetCurrentPattern(TextPattern.Pattern, out var pattern)) return null;
                var selection = ((TextPattern)pattern).GetSelection();
                if (selection.Length == 0) return null;
                var range = selection[0].Clone();
                range.MoveEndpointByUnit(TextPatternRangeEndpoint.Start, TextUnit.Character, -chars);
                return range.GetText(chars + 8);
            }
            catch (Exception)
            {
                return null;
            }
        });
        var giveUp = Environment.TickCount64 + 400;
        while (!look.IsCompleted && Environment.TickCount64 < giveUp) _clipboard.Idle(2);
        return look.IsCompleted ? look.Result : null;
    }

    private void SetHold(Hold hold)
    {
        if (hold == _hold) return;
        _hold = hold;
        Changed?.Invoke();
    }

    private Hold Check(out Target target)
    {
        target = _caret.Latest;
        if (!target.Writable) return Hold.NoBox;
        if (Native.GetForegroundWindow() != target.Window) return Hold.NoBox;
#if DESK_TEST
        if (OnlyInto != null && !Native.TitleOf(target.Window).Contains(OnlyInto, StringComparison.OrdinalIgnoreCase)) return Hold.NoBox;
#endif
        if (AnyKeyHeld()) return Hold.KeysDown;
        var fresh = _caret.LookNow();
        if (fresh == null)
        {
            // It did not answer, so nothing is known about a selection. Wait a moment before going on
            // without knowing: a box that never answers would otherwise never be written to.
            if (_unknownSince == 0) _unknownSince = Environment.TickCount64;
            if (Environment.TickCount64 - _unknownSince < UnknownAtMostMs) return Hold.KeysDown;
        }
        else _unknownSince = 0;
        if (fresh is { Password: true } or { ValueReadOnly: true }) return Hold.NoBox;
        if (fresh is { Selected: true }) return Hold.Selected;
        return Hold.None;
    }

    private static bool AnyKeyHeld() =>
        Native.IsDown(Native.VK_CONTROL) || Native.IsDown(Native.VK_MENU) || Native.IsDown(Native.VK_SHIFT) ||
        Native.IsDown(Native.VK_LWIN) || Native.IsDown(Native.VK_RWIN) ||
        Native.IsDown(Native.VK_LBUTTON) || Native.IsDown(Native.VK_RBUTTON) || Native.IsDown(Native.VK_MBUTTON);

    private static void PressEnter() =>
        Native.SendInput(2, [Key(true, '\n', false), Key(true, '\n', true)], Marshal.SizeOf<Native.INPUT>());

    /// <summary>A key at a time, slowly enough to come out right, stopping if the person moves away.</summary>
    private static string? TypeSlowly(string text, Target target)
    {
        var size = Marshal.SizeOf<Native.INPUT>();
        var plain = text.Replace("\r\n", "\n");
        for (var i = 0; i < plain.Length; i++)
        {
            if (Native.GetForegroundWindow() != target.Window) return plain[i..].Replace("\n", "\r\n");
            var c = plain[i];
            var isReturn = c == '\n';
            Native.SendInput(2, [Key(isReturn, c, false), Key(isReturn, c, true)], size);
            Thread.Sleep(SlowKeyMs);
        }
        return null;
    }

    private static Native.INPUT Key(bool isReturn, char c, bool up) => new()
    {
        type = Native.INPUT_KEYBOARD,
        u = new Native.INPUTUNION
        {
            ki = isReturn
                ? new Native.KEYBDINPUT { wVk = Native.VK_RETURN, dwFlags = up ? Native.KEYEVENTF_KEYUP : 0 }
                : new Native.KEYBDINPUT { wScan = c, dwFlags = Native.KEYEVENTF_UNICODE | (up ? Native.KEYEVENTF_KEYUP : 0) },
        },
    };

    public void Dispose()
    {
        _stop = true;
        _wake.Set();
        _thread.Join(600);   // Long enough to put the person's clipboard back.
    }

    // ── The clipboard ───────────────────────────────────────────────────────────────────────────

    private sealed class Clipboard
    {
        private const uint CF_UNICODETEXT = 13, CF_BITMAP = 2, CF_METAFILEPICT = 3, CF_PALETTE = 9, CF_ENHMETAFILE = 14, CF_OWNERDISPLAY = 0x80;
        private const uint GMEM_MOVEABLE = 2;
        private const long SaveAtMostMs = 1_000;
        private const long SaveAtMostBytes = 64 * 1024 * 1024;
        private static readonly IntPtr MessageOnly = new(-3);
        private static readonly uint HideFromWatchers = RegisterClipboardFormat("ExcludeClipboardContentFromMonitorProcessing");
        private static readonly uint InHistory = RegisterClipboardFormat("CanIncludeInClipboardHistory");
        private static readonly uint InCloud = RegisterClipboardFormat("CanUploadToCloudClipboard");

        private delegate IntPtr WndProc(IntPtr h, uint message, IntPtr wParam, IntPtr lParam);
        private WndProc? _proc;   // Kept: Windows holds only a pointer to it.
        private IntPtr _window;
        private List<(uint Format, byte[] Data)>? _saved;
        private uint _ours;
        private string? _offered;

        public void Open()
        {
            _proc = DefWindowProc;
            var module = GetModuleHandle(null);
            var name = "KiasaLiveDeskClipboard";
            var type = new WNDCLASSEX
            {
                cbSize = Marshal.SizeOf<WNDCLASSEX>(),
                lpfnWndProc = Marshal.GetFunctionPointerForDelegate(_proc),
                hInstance = module,
                lpszClassName = name,
            };
            RegisterClassEx(ref type);
            _window = CreateWindowEx(0, name, "", 0, 0, 0, 0, 0, MessageOnly, IntPtr.Zero, module, IntPtr.Zero);
            if (_window == IntPtr.Zero) throw new Win32Exception();
        }

        public void Close()
        {
            if (_window != IntPtr.Zero) DestroyWindow(_window);
            _window = IntPtr.Zero;
        }

        /// <summary>Waits, seeing to the messages this thread is sent meanwhile, so that nobody
        /// taking the clipboard from this window is kept waiting.</summary>
        public void Wait(WaitHandle wake, int ms)
        {
            var handles = new[] { wake.SafeWaitHandle.DangerousGetHandle() };
            var end = ms < 0 ? long.MaxValue : Environment.TickCount64 + ms;
            while (true)
            {
                var left = end == long.MaxValue ? 0xFFFFFFFF : (uint)Math.Max(0, end - Environment.TickCount64);
                var result = Native.MsgWaitForMultipleObjects(1, handles, false, left, Native.QS_ALLINPUT);
                Pump();
                if (result == 0 || result == 0x102 /* timed out */) return;
                if (ms >= 0 && Environment.TickCount64 >= end) return;
            }
        }

        public void Idle(int ms)
        {
            var end = Environment.TickCount64 + ms;
            do
            {
                Native.MsgWaitForMultipleObjects(0, null, false, (uint)Math.Clamp(end - Environment.TickCount64, 1, 5), Native.QS_ALLINPUT);
                Pump();
            }
            while (Environment.TickCount64 < end);
        }

        private static void Pump()
        {
            while (Native.PeekMessage(out var message, IntPtr.Zero, 0, 0, Native.PM_REMOVE))
            {
                Native.TranslateMessage(ref message);
                Native.DispatchMessage(ref message);
            }
        }

        /// <summary>Waits until no one has had the clipboard open for a moment, as a paste meeting
        /// someone there does nothing.</summary>
        public void WaitForQuiet(int quietMs, int mostMs)
        {
            var end = Environment.TickCount64 + mostMs;
            var clear = Environment.TickCount64;
            while (Environment.TickCount64 < end)
            {
                if (GetOpenClipboardWindow() != IntPtr.Zero) clear = Environment.TickCount64;
                if (Environment.TickCount64 - clear >= quietMs) return;
                Idle(2);
            }
        }

        /// <summary>Puts the words on the clipboard, having saved what was there.</summary>
        public void Offer(string text)
        {
            if (_saved == null || !StillOurs()) _saved = Save();
            if (!OpenWithPatience()) return;
            try
            {
                EmptyClipboard();
                SetClipboardData(CF_UNICODETEXT, Global(Encoding.Unicode.GetBytes(text + "\0")));
                SetClipboardData(HideFromWatchers, Global(new byte[1]));
                SetClipboardData(InHistory, Global(new byte[4]));
                SetClipboardData(InCloud, Global(new byte[4]));
            }
            finally
            {
                CloseClipboard();
            }
            _offered = text;
            _ours = GetClipboardSequenceNumber();
        }

        public void PressPaste()
        {
            var size = Marshal.SizeOf<Native.INPUT>();
            Native.SendInput(4, [Vk(Native.VK_CONTROL, false), Vk(0x56, false), Vk(0x56, true), Vk(Native.VK_CONTROL, true)], size);
        }

        private static Native.INPUT Vk(int key, bool up) => new()
        {
            type = Native.INPUT_KEYBOARD,
            u = new Native.INPUTUNION { ki = new Native.KEYBDINPUT { wVk = (ushort)key, dwFlags = up ? Native.KEYEVENTF_KEYUP : 0 } },
        };

        /// <summary>A copy of what is on the clipboard now. Pictures come back from their plain form,
        /// and anything held in a way that cannot be copied is left out.</summary>
        private List<(uint, byte[])> Save()
        {
            var saved = new List<(uint, byte[])>();
            if (!OpenWithPatience()) return saved;
            try
            {
                var started = Environment.TickCount64;
                long total = 0;
                uint format = 0;
                while ((format = EnumClipboardFormats(format)) != 0)
                {
                    if (format is CF_BITMAP or CF_METAFILEPICT or CF_PALETTE or CF_ENHMETAFILE or CF_OWNERDISPLAY || format is >= 0x0300 and <= 0x03FF) continue;
                    if (Environment.TickCount64 - started > SaveAtMostMs) break;
                    var handle = GetClipboardData(format);
                    if (handle == IntPtr.Zero) continue;
                    var size = (long)GlobalSize(handle);
                    if (size <= 0 || total + size > SaveAtMostBytes) continue;
                    var pointer = GlobalLock(handle);
                    if (pointer == IntPtr.Zero) continue;
                    var data = new byte[size];
                    Marshal.Copy(pointer, data, 0, (int)size);
                    GlobalUnlock(handle);
                    saved.Add((format, data));
                    total += size;
                }
            }
            finally
            {
                CloseClipboard();
            }
            return saved;
        }

        /// <summary>Whether what is on the clipboard is still what this app put there. The clipboard's
        /// number alone cannot say: other programs that watch it can change the number without anyone
        /// copying anything. If that counted as a copy, these words would be saved as the person's own,
        /// and put back instead of what they really had.</summary>
        private bool StillOurs()
        {
            if (GetClipboardSequenceNumber() == _ours) return true;
            if (_offered == null || !OpenWithPatience()) return false;
            try
            {
                var handle = GetClipboardData(CF_UNICODETEXT);
                if (handle == IntPtr.Zero) return false;
                var pointer = GlobalLock(handle);
                if (pointer == IntPtr.Zero) return false;
                var text = Marshal.PtrToStringUni(pointer);
                GlobalUnlock(handle);
                return text == _offered;
            }
            finally
            {
                CloseClipboard();
            }
        }

        /// <summary>The person's clipboard again, unless they have copied something since.</summary>
        public void PutBack()
        {
            var saved = _saved;
            _saved = null;
            if (saved == null || !StillOurs()) return;
            if (!OpenWithPatience()) return;
            try
            {
                EmptyClipboard();
                foreach (var (format, data) in saved) SetClipboardData(format, Global(data));
            }
            finally
            {
                CloseClipboard();
            }
        }

        private bool OpenWithPatience()
        {
            for (var tries = 0; tries < 40; tries++)
            {
                if (OpenClipboard(_window)) return true;
                Idle(5);
            }
            return false;
        }

        private static IntPtr Global(byte[] data)
        {
            var handle = GlobalAlloc(GMEM_MOVEABLE, (nuint)data.Length);
            var pointer = GlobalLock(handle);
            Marshal.Copy(data, 0, pointer, data.Length);
            GlobalUnlock(handle);
            return handle;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct WNDCLASSEX
        {
            public int cbSize;
            public uint style;
            public IntPtr lpfnWndProc;
            public int cbClsExtra, cbWndExtra;
            public IntPtr hInstance, hIcon, hCursor, hbrBackground;
            public string? lpszMenuName;
            public string lpszClassName;
            public IntPtr hIconSm;
        }

        [DllImport("user32", SetLastError = true)] private static extern bool OpenClipboard(IntPtr owner);
        [DllImport("user32")] private static extern bool CloseClipboard();
        [DllImport("user32")] private static extern bool EmptyClipboard();
        [DllImport("user32")] private static extern IntPtr SetClipboardData(uint format, IntPtr data);
        [DllImport("user32")] private static extern IntPtr GetClipboardData(uint format);
        [DllImport("user32")] private static extern uint EnumClipboardFormats(uint format);
        [DllImport("user32")] private static extern uint GetClipboardSequenceNumber();
        [DllImport("user32")] private static extern IntPtr GetOpenClipboardWindow();
        [DllImport("user32", CharSet = CharSet.Unicode)] private static extern uint RegisterClipboardFormat(string name);
        [DllImport("user32", CharSet = CharSet.Unicode, SetLastError = true)] private static extern ushort RegisterClassEx(ref WNDCLASSEX type);
        [DllImport("user32", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateWindowEx(uint exStyle, string type, string name, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
        [DllImport("user32")] private static extern bool DestroyWindow(IntPtr h);
        [DllImport("user32", CharSet = CharSet.Unicode)] private static extern IntPtr DefWindowProc(IntPtr h, uint message, IntPtr wParam, IntPtr lParam);
        [DllImport("kernel32", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string? name);
        [DllImport("kernel32")] private static extern IntPtr GlobalAlloc(uint flags, nuint size);
        [DllImport("kernel32")] private static extern IntPtr GlobalLock(IntPtr h);
        [DllImport("kernel32")] private static extern bool GlobalUnlock(IntPtr h);
        [DllImport("kernel32")] private static extern nuint GlobalSize(IntPtr h);
    }
}
