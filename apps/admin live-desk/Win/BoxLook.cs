using System.Windows.Automation;

namespace LiveDesk.Win;

/// <summary>What Windows says about the focused box, in the fuller way. This can take a while, and
/// hang on a window as it closes (about 60 seconds, measured), so it never runs on a thread anything
/// else waits on: see <see cref="BoxLooker"/>.</summary>
internal sealed record BoxFacts(string Type, string Class, bool Password, bool? ValueReadOnly, bool HasText, bool Selected, int BoxX, int BoxY, int BoxW, int BoxH, int? CaretX, int? CaretY, int? CaretH)
{
    public static BoxFacts? Look()
    {
        try
        {
            var element = AutomationElement.FocusedElement;
            if (element == null) return null;
            var current = element.Current;
            var box = current.BoundingRectangle;
            var type = current.ControlType?.ProgrammaticName?.Replace("ControlType.", "") ?? "";
            bool? valueReadOnly = element.TryGetCurrentPattern(ValuePattern.Pattern, out var value) ? ((ValuePattern)value).Current.IsReadOnly : null;
            var hasText = false;
            var selected = false;
            int? caretX = null, caretY = null, caretH = null;
            if (element.TryGetCurrentPattern(TextPattern.Pattern, out var text))
            {
                hasText = true;
                var ranges = ((TextPattern)text).GetSelection();
                if (ranges.Length > 0)
                {
                    selected = ranges[0].GetText(1).Length > 0;
                    var rects = ranges[0].GetBoundingRectangles();
                    if (rects.Length > 0 && rects[0].Height > 0)
                    {
                        caretX = (int)rects[^1].Right;
                        caretY = (int)rects[^1].Top;
                        caretH = (int)rects[^1].Height;
                    }
                }
            }
            bool finite = !box.IsEmpty && !double.IsInfinity(box.X);
            return new BoxFacts(type, current.ClassName ?? "", current.IsPassword, valueReadOnly, hasText, selected,
                finite ? (int)box.X : 0, finite ? (int)box.Y : 0, finite ? (int)box.Width : 0, finite ? (int)box.Height : 0, caretX, caretY, caretH);
        }
        catch (Exception)
        {
            return null;   // The window closed or refused: nothing is known about it.
        }
    }
}

/// <summary>Runs those looks on a thread of their own, the newest request only. A look that hangs
/// is left behind, and a new thread takes over.</summary>
internal sealed class BoxLooker : IDisposable
{
    private const long StuckMs = 1_500;
    private readonly object _gate = new();
    private Action<BoxFacts?>? _next;
    private long _busySince;
    private bool _stopped;
    private Thread _thread;
    private readonly AutoResetEvent _wake = new(false);

    public BoxLooker() => _thread = Start();

    private Thread Start()
    {
        var thread = new Thread(Run) { IsBackground = true, Name = "box look" };
        thread.SetApartmentState(ApartmentState.MTA);
        thread.Start();
        return thread;
    }

    /// <summary>Ask for a look; <paramref name="done"/> runs on the look's thread. A request still
    /// waiting is replaced: only the newest matters.</summary>
    public void Ask(Action<BoxFacts?> done)
    {
        lock (_gate)
        {
            _next = done;
            if (_busySince != 0 && Environment.TickCount64 - _busySince > StuckMs)
            {
                _busySince = 0;
                _thread = Start();
            }
        }
        _wake.Set();
    }

    private void Run()
    {
        var me = Thread.CurrentThread;
        while (true)
        {
            _wake.WaitOne();
            while (true)
            {
                Action<BoxFacts?>? job;
                lock (_gate)
                {
                    if (_stopped || !ReferenceEquals(_thread, me)) return;
                    job = _next;
                    _next = null;
                    if (job == null) { _busySince = 0; break; }
                    _busySince = Environment.TickCount64;
                }
                var facts = BoxFacts.Look();
                lock (_gate)
                {
                    if (!ReferenceEquals(_thread, me)) return;   // Replaced while hung: not wanted now.
                }
                job(facts);
            }
        }
    }

    public void Dispose()
    {
        lock (_gate) _stopped = true;
        _wake.Set();
    }
}
