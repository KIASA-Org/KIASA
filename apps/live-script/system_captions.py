"""
System live capture: the live script, with its words taken from Windows 11's own Live
Captions instead of KIASA's speech model. Nothing to download, and it runs however Windows
is set up: its language, and its microphone setting.

Windows offers no way to subscribe to Live Captions, so this reads its window the way a
screen reader does (UI Automation), several times a second. The text there is a buffer that
grows, whose newest words Windows keeps correcting, and whose oldest words may leave it;
Stitch turns that into one growing script.
"""
import ctypes
import gc
import os
import subprocess
import sys
import threading
import time
from ctypes import wintypes
from difflib import SequenceMatcher
from pathlib import Path

WINDOW_CLASS = "LiveCaptionsDesktopWindow"
CAPTIONS_ID = "CaptionsTextBlock"       # the words, once Windows has heard some
READY_ID = "ReadyToCaptionTextBlock"    # "Ready to show live captions in ...", before that
READ_EVERY = 0.1          # seconds between looks at the window
SEARCH_EVERY = 0.5        # the same, while the words are not on it yet
SETUP_HINT_AFTER = 6      # seconds before saying that Windows may be waiting for the member
OPEN_GIVE_UP = 20         # seconds for a window that does not appear at all
START_AGAIN_AFTER = 3     # seconds before asking again for a window that has not appeared (it takes about 1)
HEARS_AFTER = 3           # seconds after saying "Ready" that it hears speech from the first word (measured)
HOLD_MARK_FOR = 1.2       # seconds a sentence's last mark waits: Windows often takes it back
PROBE_WORDS = 8           # how many words to look for when finding where the buffer now starts
KEEP_OPEN = 300           # newest words still open to correction (the deepest measured was 139 back)

OUT_OF_REACH = (
    "Another program opened Windows Live Captions as administrator, so KIASA cannot read it. "
    "Close Live Captions (the X on its window), and KIASA will connect by itself."
)

# comtypes reads this when first imported. Nothing here runs a message loop, which is what
# COM's other mode would need.
sys.coinit_flags = 0

SW_MINIMIZE = 6
SW_RESTORE = 9
WM_CLOSE = 0x0010


def _plain(word: str) -> str:
    """A word as Windows might respell it a moment later: no capitals, no marks."""
    return "".join(c for c in word.casefold() if c.isalnum())


def _scrolled(old: list[str], new: list[str]) -> int:
    """How many words have left the front of the buffer between two reads."""
    if not old or not new:
        return len(old)
    probe = min(PROBE_WORDS, len(new), len(old))
    if old[:probe] == new[:probe]:
        return 0
    # The buffer lost its front: the new one starts somewhere inside the old one. Sentences
    # can repeat, so take the place where the most of what follows lines up as well.
    best, best_score = None, 0.0
    for start in range(len(old)):
        length = min(len(old) - start, len(new))
        if old[start:start + min(probe, length)] != new[:min(probe, length)]:
            continue
        same = sum(a == b for a, b in zip(old[start:start + length], new))
        score = same / length * min(length, 3)  # a match of one or two words proves little
        if score > best_score:
            best, best_score = start, score
    if best is not None and best_score >= 1.8:
        return best
    # The first words themselves changed, which happens when there are few of them. Line up
    # whatever does match; if nothing does, it is a different text and the old one is over.
    match = SequenceMatcher(None, old, new, autojunk=False).find_longest_match()
    if match.size >= min(3, len(old), len(new)):
        return max(0, match.a - match.b)
    return 0 if len(old) < PROBE_WORDS else len(old)


class Stitch:
    """One growing script from a buffer of captions. A word stays open to Windows'
    corrections while it is among the newest; after that it is final and written once,
    so the work stays the same size however long the session runs."""

    def __init__(self, fix=lambda text: text):
        self.fix = fix
        self.final = ""             # the script's settled words
        self.words: list[str] = []  # the buffer, as last read
        self.plain: list[str] = []
        self.done = 0               # how many of its first words are in `final`, or came before this session

    def begin(self, text: str) -> None:
        """Words already in the buffer belong to before this session, not to the script."""
        self.finish()
        self.words = text.split()
        self.plain = [_plain(word) for word in self.words]
        self.done = len(self.words)

    def finish(self) -> None:
        """The buffer is over (its window closed): everything in it is final."""
        self._settle(len(self.words))
        self.words, self.plain, self.done = [], [], 0

    def _settle(self, upto: int) -> None:
        if upto > self.done:
            chunk = self.fix(" ".join(self.words[self.done:upto]))
            self.final = f"{self.final} {chunk}" if self.final else chunk
            self.done = upto

    def read(self, text: str) -> bool:
        """Take in the buffer as it is now. Says whether anything changed. An empty read
        changes nothing: if the buffer really was emptied, the next words will show it."""
        words = text.split()
        if not words or words == self.words:
            return False
        plain = [_plain(word) for word in words]
        gone = _scrolled(self.plain, plain)
        self._settle(gone)
        self.done = max(0, self.done - gone)
        self.words, self.plain = words, plain
        if len(words) - self.done > KEEP_OPEN + 100:
            self._settle(len(words) - KEEP_OPEN)
        return True

    def script(self, hold_mark: bool = False) -> str:
        """The whole script. With hold_mark, the newest word goes without the mark Windows
        has just put on it (it adds one at every breath, and takes most of them back)."""
        words = self.words[self.done:]
        if hold_mark and words:
            words = words[:-1] + [words[-1].rstrip(".,?!")]
        tail = self.fix(" ".join(words))
        if not tail:
            return self.final
        return f"{self.final} {tail}" if self.final else tail


class Unavailable(Exception):
    """Windows cannot do this: the message says why, in words for the member."""


def _live_captions_program() -> Path:
    program = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "LiveCaptions.exe"
    if not program.exists():
        raise Unavailable(
            "This PC does not have Windows Live Captions: it comes with Windows 11, version 22H2 or "
            "newer. Choose KIASA live capture instead."
        )
    return program


def _start(program: Path) -> None:
    """Start a Windows program. A built app has told Windows to look for DLLs in its own
    folder first, and a child would inherit that: it must not load this app's copies."""
    kernel32 = ctypes.windll.kernel32
    kernel32.SetDllDirectoryW.argtypes = [wintypes.LPCWSTR]
    kernel32.GetDllDirectoryW.argtypes = [wintypes.DWORD, wintypes.LPWSTR]
    folder = ctypes.create_unicode_buffer(32768)
    has_folder = kernel32.GetDllDirectoryW(len(folder), folder) > 0
    kernel32.SetDllDirectoryW(None)
    try:
        subprocess.Popen([str(program)])
    finally:
        if has_folder:
            kernel32.SetDllDirectoryW(folder.value)


def _runs_as_admin(pid: int) -> bool:
    """Whether a process has administrator rights. False if Windows will not say."""
    kernel32 = ctypes.windll.kernel32
    advapi32 = ctypes.windll.advapi32
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    advapi32.OpenProcessToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
    advapi32.GetTokenInformation.argtypes = [
        wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD),
    ]
    PROCESS_QUERY_LIMITED_INFORMATION, TOKEN_QUERY, TOKEN_ELEVATION = 0x1000, 0x0008, 20
    process = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not process:
        return False
    token = wintypes.HANDLE()
    elevated = wintypes.DWORD(0)
    if advapi32.OpenProcessToken(process, TOKEN_QUERY, ctypes.byref(token)):
        size = wintypes.DWORD()
        advapi32.GetTokenInformation(token, TOKEN_ELEVATION, ctypes.byref(elevated), ctypes.sizeof(elevated), ctypes.byref(size))
        kernel32.CloseHandle(token)
    kernel32.CloseHandle(process)
    return bool(elevated.value)


def _out_of_reach(pid: int) -> bool:
    """Live Captions runs with the rights of whatever opened it, and Windows keeps a window
    with higher rights than this app's out of its reach: it could neither read nor close it."""
    return _runs_as_admin(pid) and not _runs_as_admin(os.getpid())


def _keep_up(pid: int) -> None:
    """Minimised, Live Captions is exactly what Windows slows down after a while (see
    keep_fast in live_script.py). Lift that for as long as it runs."""
    kernel32 = ctypes.windll.kernel32
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.SetProcessInformation.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel32.SetProcessInformation.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]

    class PowerThrottling(ctypes.Structure):
        _fields_ = [("Version", wintypes.ULONG), ("ControlMask", wintypes.ULONG), ("StateMask", wintypes.ULONG)]

    PROCESS_SET_INFORMATION = 0x0200
    handle = kernel32.OpenProcess(PROCESS_SET_INFORMATION, False, pid)
    if handle:
        state = PowerThrottling(1, 0x1, 0)  # current version; execution speed; not throttled
        kernel32.SetProcessInformation(handle, 4, ctypes.byref(state), ctypes.sizeof(state))
        kernel32.CloseHandle(handle)


class Engine:
    """Follows the Live Captions window. Talks to the service through ui_q, like the
    engine in live_script.py, and is started and closed the same way."""

    def __init__(self, ui_q, fix=lambda text: text):
        self.ui_q = ui_q
        self.stop = threading.Event()
        self.stitch = Stitch(fix)
        self.user32 = ctypes.windll.user32
        self.user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
        self.user32.IsWindow.argtypes = [wintypes.HWND]
        self.user32.IsIconic.argtypes = [wintypes.HWND]
        self.user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
        self.user32.FindWindowW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR]
        self.user32.FindWindowW.restype = wintypes.HWND
        self.user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
        self.hwnd = None
        self.opened_it = False       # we opened Live Captions, so we close it again
        self.just_opened = False     # and it has only now started
        self.minimised_it = False    # the member had it open, so we give it back as it was

    def close(self) -> None:
        self.stop.set()

    def run(self) -> None:
        import comtypes  # only this capture needs it

        comtypes.CoInitializeEx(comtypes.COINIT_MULTITHREADED)
        try:
            self._follow()
        except Unavailable as exc:
            self.ui_q.put(("problem", str(exc)))
        except Exception as exc:
            self.ui_q.put(("error", f"{type(exc).__name__}: {exc}"))
        finally:
            self._let_go()
            gc.collect()  # every COM object goes before COM does
            comtypes.CoUninitialize()

    def _follow(self) -> None:
        import comtypes
        import comtypes.client

        comtypes.client.GetModule("UIAutomationCore.dll")
        from comtypes.gen import UIAutomationClient as uia

        automation = comtypes.client.CreateObject(uia.CUIAutomation8, interface=uia.IUIAutomation2)
        # Left alone, a call reaching a window as it closes waits about a minute.
        automation.ConnectionTimeout = 2000
        automation.TransactionTimeout = 4000
        captions_is = automation.CreatePropertyCondition(uia.UIA_AutomationIdPropertyId, CAPTIONS_ID)
        ready_is = automation.CreatePropertyCondition(uia.UIA_AutomationIdPropertyId, READY_ID)

        def find(window, condition):
            # A search with no result gives an empty pointer, not None.
            try:
                return window.FindFirst(uia.TreeScope_Descendants, condition) or None
            except comtypes.COMError:
                return None

        first = True
        while not self.stop.is_set():
            self.ui_q.put(("connecting", "Connecting to system live capture…" if first
                           else "Windows Live Captions closed. Connecting to it again…"))
            pid = self._open()
            if pid is None:
                return
            try:
                window = automation.ElementFromHandle(self.hwnd)
                captions = self._wait_until_ready(window, find, captions_is, ready_is)
                if captions is False:
                    continue  # its window went away while waiting: open it again
                if self.stop.is_set():
                    return
                already = captions.CurrentName if captions else ""
            except comtypes.COMError:
                continue  # it went away just then
            _keep_up(pid)
            # On reopening, nothing in the new buffer came before this session.
            if first:
                self.stitch.begin(already or "")
            else:
                self.stitch.finish()
            first = False
            self._tuck_away()
            # "Connected" means every word from now on is heard.
            if self.just_opened:
                self.just_opened = False
                if self.stop.wait(HEARS_AFTER):
                    return
            self.ui_q.put(("connected", "Connected to system live capture"))
            self._read_on(window, captions, find, captions_is, comtypes.COMError)

    def _open(self) -> int | None:
        """Find the Live Captions window, or open it, and give its process. None if told to
        stop meanwhile; an error, for the member to read, if it will not open."""
        give_up = next_start = None
        told = False
        while not self.stop.is_set():
            hwnd = self.user32.FindWindowW(WINDOW_CLASS, None)
            now = time.monotonic()
            if hwnd:
                pid = wintypes.DWORD()
                self.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                if not _out_of_reach(pid.value):
                    self.hwnd = hwnd
                    return pid.value
                # Only the member can close this one. The moment they do, a copy this app
                # can read goes up, ahead of whatever opened it (it may well open it again).
                if not told:
                    told = True
                    self.ui_q.put(("connecting", OUT_OF_REACH))
                give_up = next_start = None
            else:
                if told:
                    told = False
                    self.ui_q.put(("connecting", "Connecting to system live capture…"))
                if give_up is None:
                    give_up = now + OPEN_GIVE_UP
                elif now > give_up:
                    raise Unavailable("Windows Live Captions did not open. Choose KIASA live capture, or try again.")
                # Only one copy runs at a time, and a new one hands over to it and leaves. A copy
                # still closing takes that with it, and no window comes: so ask again.
                if next_start is None or now >= next_start:
                    _start(_live_captions_program())
                    self.opened_it = self.just_opened = True
                    next_start = now + START_AGAIN_AFTER
            self.stop.wait(0.15)
        return None

    def _wait_until_ready(self, window, find, captions_is, ready_is):
        """Wait until the window can caption. The first time on a PC it asks the member first,
        and downloads its language files: leave it on show, and say so. Returns the captions
        element, None if Windows has not heard anything yet, or False if the window went."""
        began = time.monotonic()
        hinted = False
        while not self.stop.is_set():
            if not self.user32.IsWindow(self.hwnd):
                return False
            captions = find(window, captions_is)
            if captions or find(window, ready_is):
                return captions
            if not hinted and time.monotonic() - began > SETUP_HINT_AFTER:
                hinted = True
                self.ui_q.put(("connecting", "Windows Live Captions needs you: finish its setup in its window."))
            self.stop.wait(SEARCH_EVERY)
        return None

    def _tuck_away(self) -> None:
        """The script is on the KIASA page; the captions bar would only sit on top of it.
        Minimised, it goes on working, and it stays on the taskbar for the member."""
        if not self.user32.IsIconic(self.hwnd):
            self.user32.ShowWindow(self.hwnd, SW_MINIMIZE)
            self.minimised_it = True

    def _read_on(self, window, captions, find, captions_is, com_error) -> None:
        """Pass on each change of the words, until told to stop or the window goes."""
        changed = 0.0
        holding = False
        next_search = 0.0
        while not self.stop.wait(READ_EVERY):
            if not self.user32.IsWindow(self.hwnd):
                return
            now = time.monotonic()
            if not captions:
                if now < next_search:
                    continue
                next_search = now + SEARCH_EVERY
                captions = find(window, captions_is)
                if not captions:
                    continue
            try:
                text = captions.CurrentName
            except com_error:
                captions = None
                continue
            if self.stitch.read(text or ""):
                changed = now
                holding = True
                self.ui_q.put(("text", self.stitch.script(hold_mark=True)))
            elif holding and now - changed >= HOLD_MARK_FOR:
                holding = False
                self.ui_q.put(("text", self.stitch.script()))

    def _let_go(self) -> None:
        """Leave Live Captions as it was found: closed if we opened it, or back on show."""
        # Turned off before the window we opened had appeared: it still must not stay.
        tries = 50 if self.opened_it and not self.hwnd else 0
        while tries and not self.hwnd:
            time.sleep(0.1)
            self.hwnd = self.user32.FindWindowW(WINDOW_CLASS, None)
            tries -= 1
        if not self.hwnd or not self.user32.IsWindow(self.hwnd):
            return
        if self.opened_it:
            # Gone before this ends: a capture that starts next must not find it half closed.
            # A window that is still starting (about 4 s) does not heed being told: say it again.
            for tick in range(100):
                if not self.user32.IsWindow(self.hwnd):
                    break
                if tick % 5 == 0:
                    self.user32.PostMessageW(self.hwnd, WM_CLOSE, 0, 0)
                time.sleep(0.1)
        elif self.minimised_it:
            self.user32.ShowWindow(self.hwnd, SW_RESTORE)

