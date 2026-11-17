"""What KIASA Live Script needs besides Windows Live Captions: where it keeps its files,
keeping Windows from slowing it down, and writing technical terms the standard way.

KIASA Live Script reads Windows' own Live Captions (system_captions.py) and hands the words to
KIASA's Interview page (live_server.py). It has no speech model of its own.
"""

import os
import re
import sys
from pathlib import Path

# Built as an .exe, its own files are unpacked beside it, and what it writes goes to the user's data.
FROZEN = getattr(sys, "frozen", False)
HERE = Path(sys._MEIPASS) if FROZEN else Path(__file__).resolve().parent
DATA = Path(os.environ["LOCALAPPDATA"]) / "KIASA Live Script" if FROZEN else HERE
TRANSCRIPT_DIR = DATA / "transcripts"

# Terms always written exactly like this. Add your own here. Leave out anything that is
# also a normal word, such as IT (it), US (us), RAM (ram), RAG (rag) or REST (rest).
TERMS = [
    "ID", "IDs", "API", "APIs", "SDK", "SDKs", "URL", "URLs", "UI", "UX", "HTML", "CSS", "HTTP", "HTTPS",
    "JSON", "XML", "CSV", "PDF", "SQL", "NoSQL", "CPU", "CPUs", "GPU", "GPUs", "TCP", "UDP", "DNS", "VPN",
    "IP", "SSH", "SSL", "TLS", "JWT", "OAuth", "CLI", "IDE", "AWS", "GCP", "LLM", "LLMs", "NLP",
    "AI", "ML", "OOP", "CRUD", "CI", "CD", "QA", "CEO", "CTO", "HR", "PhD",
    "Python", "JavaScript", "TypeScript", "GitHub", "OpenAI", "YouTube", "LinkedIn", "PostgreSQL", "MySQL",
    "MongoDB", "Redis", "Kubernetes", "Docker", "WebSocket", "WebSockets", "CoderPad", "LangChain", "LangGraph",
]
# Terms the speech model tends to write in pieces or spell differently.
TERM_SPELLINGS = {
    "web socket": "WebSocket", "web sockets": "WebSockets", "coder pad": "CoderPad",
    "open ai": "OpenAI", "git hub": "GitHub", "java script": "JavaScript", "type script": "TypeScript",
    "you tube": "YouTube", "linked in": "LinkedIn", "lang chain": "LangChain", "lang graph": "LangGraph",
    "my sql": "MySQL", "no sql": "NoSQL", "postgres": "Postgres", "pseudo code": "pseudocode",
}


def keep_fast() -> None:
    """Windows slows a long-running windowless process down after a while (its power
    throttling, meant for background apps), which starved recognition until the app
    emitted a few words a minute; a fresh process is not throttled yet, so a restart
    always looked like a cure. Opt out of it, and run a little above normal priority
    so the audio work is scheduled ahead of background chores."""
    if sys.platform != "win32":
        return
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.windll.kernel32
    # Declare the signatures: left to ctypes' defaults, the 64-bit process handle is
    # passed as a 32-bit int, every call fails quietly, and nothing changes.
    kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    kernel32.SetPriorityClass.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel32.SetPriorityClass.restype = wintypes.BOOL
    kernel32.SetProcessInformation.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel32.SetProcessInformation.restype = wintypes.BOOL
    me = kernel32.GetCurrentProcess()

    class PowerThrottling(ctypes.Structure):
        _fields_ = [("Version", wintypes.ULONG), ("ControlMask", wintypes.ULONG), ("StateMask", wintypes.ULONG)]

    PROCESS_POWER_THROTTLING_CURRENT_VERSION = 1
    PROCESS_POWER_THROTTLING_EXECUTION_SPEED = 0x1   # the "EcoQoS" slowdown
    PROCESS_INFORMATION_POWER_THROTTLING = 4
    state = PowerThrottling(PROCESS_POWER_THROTTLING_CURRENT_VERSION, PROCESS_POWER_THROTTLING_EXECUTION_SPEED, 0)
    kernel32.SetProcessInformation(me, PROCESS_INFORMATION_POWER_THROTTLING, ctypes.byref(state), ctypes.sizeof(state))
    ABOVE_NORMAL_PRIORITY_CLASS = 0x8000
    kernel32.SetPriorityClass(me, ABOVE_NORMAL_PRIORITY_CLASS)


_TERM_FIXES = {term.lower(): term for term in TERMS}
_TERM_FIXES.update(TERM_SPELLINGS)
_TERM_PATTERN = re.compile(
    r"(?<![\w'-])(" + "|".join(sorted(map(re.escape, _TERM_FIXES), key=len, reverse=True)) + r")(?![\w'-])",
    re.IGNORECASE,
)


def fix_terms(text: str) -> str:
    """Write known technical terms the standard way, such as "Id" as "ID"."""
    return _TERM_PATTERN.sub(lambda m: _TERM_FIXES[m.group(1).lower()], text)
