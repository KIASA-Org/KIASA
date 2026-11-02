"""
Live Script: real-time captions of whatever the PC is playing, in an always-on-top
window, saved to a text file. Runs entirely on the CPU of this PC, with no GPU, no internet
after the first run, and no need for Windows 11 or the Windows Live Captions feature
(it uses WASAPI loopback, so Windows only).

Speech recognition is NVIDIA's Nemotron streaming model, run through sherpa-onnx. It
writes words, capitals and punctuation as the audio arrives.

Install:
    pip install sherpa-onnx huggingface_hub PyAudioWPatch numpy scipy

Run:
    python live_script.py

The speech model (about 660 MB) is downloaded on first run.
"""
import argparse
import os
import queue
import re
import sys
import threading
import time
from datetime import datetime
from math import floor
from pathlib import Path

import numpy as np
import pyaudiowpatch as pyaudio
import sherpa_onnx
from huggingface_hub import hf_hub_download
from scipy.signal import butter, sosfilt, sosfilt_zi

# ----------------------------- CONFIG ---------------------------------
# The 560 ms version was the best fit for ordinary PCs in testing: it shows words about
# half a second after they are spoken, and uses far less CPU than the shorter chunk sizes.
MODEL_REPO = "csukuangfj2/sherpa-onnx-nemotron-speech-streaming-en-0.6b-560ms-int8-2026-04-25"
MODEL_REVISION = "52056fdc070914a48dcd68b31b44d6a6f5b85902"
MODEL_FILES = {
    "tokens": "tokens.txt",
    "decoder": "decoder.int8.onnx",
    "joiner": "joiner.int8.onnx",
    "encoder": "encoder.int8.onnx",
}
# On one thread a long continuous stream fell minutes behind (recognition just under
# real time, so the lag piled up). A few threads run it well ahead of real time.
NUM_THREADS = min(6, max(2, (os.cpu_count() or 4) - 1))
MAX_LAG_SECONDS = 4.0  # if it ever still falls this far behind, skip the oldest audio to stay live
# Both the capture and the recognition stream are retired for fresh ones at a quiet moment
# this far into a session (every word kept), so nothing that builds up inside them over a
# long run can slow it down or stop it. The capture is also reopened on its own if it
# stops delivering: it can die quietly (a device reset, a driver quirk, the default output
# changing) with no error at all, leaving the loop feeding silence forever.
REFRESH_MINUTES = 8
CAPTURE_STALL_SECONDS = 45  # harmless when nothing is playing: it just opens the same capture again
# Built as an .exe, its own files are unpacked beside it, and what it writes goes to the user's data.
FROZEN = getattr(sys, "frozen", False)
HERE = Path(sys._MEIPASS) if FROZEN else Path(__file__).resolve().parent
DATA = Path(os.environ["LOCALAPPDATA"]) / "KIASA Live Script" if FROZEN else HERE
PUNCT_DIR = HERE / "models" / "punctuation"
PUNCT_HOLD = 3        # the newest words wait this long for punctuation, to avoid flicker
SETTLE_AFTER = 40      # fix older punctuation once this many words are still open
SETTLE_MARGIN = 10     # never fix marks this close to the newest word
PAUSE_SECONDS = 1.2    # after this much quiet, punctuate the newest words as well
FILLERS = {"um", "uh", "ah", "er", "hmm", "mm", "mhm"}  # sounds left out of the text
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
TRANSCRIPT_DIR = DATA / "transcripts"
SAVE_EVERY = 2.0  # seconds between transcript saves
BURST_SECONDS = 0.25  # spread each burst of words over about this long
MIN_WORD_GAP = 0.03   # seconds between words appearing, fastest
MAX_WORD_GAP = 0.1    # seconds between words appearing, slowest
FONT = ("Segoe UI", 18)
# ----------------------------------------------------------------------

SR = 16000  # the model expects 16 kHz mono


class Resampler:
    """Stateful downsampler, so chunk boundaries don't add clicks that hurt recognition."""

    def __init__(self, rate: int):
        self.ratio = rate / SR
        self.pos = 0.0
        self.prev = 0.0
        self.sos = None
        if rate > SR:
            self.sos = butter(8, 7600 / (rate / 2), output="sos")
            self.zi = sosfilt_zi(self.sos) * 0.0

    def __call__(self, x: np.ndarray) -> np.ndarray:
        if self.ratio == 1.0:
            return x
        if self.sos is not None:
            x, self.zi = sosfilt(self.sos, x, zi=self.zi)
        y = np.concatenate(([self.prev], x))
        last = len(y) - 1
        n = floor((last - self.pos) / self.ratio) + 1
        if n <= 0:
            self.pos -= last
            self.prev = y[-1]
            return np.zeros(0, dtype=np.float32)
        points = self.pos + self.ratio * np.arange(n)
        self.pos = points[-1] + self.ratio - last
        self.prev = y[-1]
        return np.interp(points, np.arange(len(y)), y).astype(np.float32)


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


def find_loopback(p: pyaudio.PyAudio) -> dict:
    """Find the loopback device for the default speakers/headphones."""
    wasapi = p.get_host_api_info_by_type(pyaudio.paWASAPI)
    speakers = p.get_device_info_by_index(wasapi["defaultOutputDevice"])
    if speakers.get("isLoopbackDevice"):
        return speakers
    for lb in p.get_loopback_device_info_generator():
        if speakers["name"] in lb["name"]:
            return lb
    raise RuntimeError("No WASAPI loopback device found for your default output.")


class _Quiet:
    """Swallows the download bar's own output: the page shows the progress instead."""

    def write(self, *_args) -> None: pass
    def flush(self) -> None: pass
    def isatty(self) -> bool: return False


def _counting_bar(report):
    """A download bar that reports how far along it is, instead of drawing itself."""
    from tqdm import tqdm as base_tqdm

    class Bar(base_tqdm):
        def __init__(self, *args, **kwargs):
            kwargs["disable"] = False   # it must count, even where bars are switched off
            kwargs["file"] = _Quiet()
            super().__init__(*args, **kwargs)

        def update(self, n=1):
            done = super().update(n)
            if self.total:
                report(min(1.0, self.n / self.total))
            return done

    return Bar


def load_recognizer(status, on_progress=None) -> sherpa_onnx.OnlineRecognizer:
    """`on_progress(part, parts, fraction)`, if given, follows each file as it downloads."""
    paths = {}
    parts = len(MODEL_FILES)
    for i, (part, filename) in enumerate(MODEL_FILES.items(), start=1):
        status(f"Getting speech model (first run downloads about 660 MB), part {i} of {parts}...")
        extra = {}
        if on_progress is not None:
            extra["tqdm_class"] = _counting_bar(lambda fraction, i=i: on_progress(i, parts, fraction))
        paths[part] = hf_hub_download(MODEL_REPO, filename, revision=MODEL_REVISION, **extra)
    status("Loading speech model...")
    return sherpa_onnx.OnlineRecognizer.from_transducer(
        **paths,
        num_threads=NUM_THREADS,
        sample_rate=SR,
        feature_dim=128,
        # Resetting the model at pauses lost the words around each reset, so it runs nonstop.
        enable_endpoint_detection=False,
        decoding_method="greedy_search",
        provider="cpu",
    )


_TERM_FIXES = {term.lower(): term for term in TERMS}
_TERM_FIXES.update(TERM_SPELLINGS)
_TERM_PATTERN = re.compile(
    r"(?<![\w'-])(" + "|".join(sorted(map(re.escape, _TERM_FIXES), key=len, reverse=True)) + r")(?![\w'-])",
    re.IGNORECASE,
)


def fix_terms(text: str) -> str:
    """Write known technical terms the standard way, such as "Id" as "ID"."""
    return _TERM_PATTERN.sub(lambda m: _TERM_FIXES[m.group(1).lower()], text)


def clean_words(text: str) -> list[str]:
    """Split the model's text into words, without its punctuation or filler sounds."""
    words = (w.strip(".,?!;:") for w in text.split())
    return [w for w in words if w and w.lower() not in FILLERS]


class Punctuator:
    """Adds punctuation with a small separate model, because the speech model stops
    writing it after the first few seconds of a nonstop stream.

    Only the marks come from this model; words and their capitals stay as the speech
    model wrote them, apart from a capital at the start of each sentence.
    """

    def __init__(self):
        self.model = sherpa_onnx.OnlinePunctuation(
            sherpa_onnx.OnlinePunctuationConfig(
                model_config=sherpa_onnx.OnlinePunctuationModelConfig(
                    cnn_bilstm=str(PUNCT_DIR / "model.int8.onnx"),
                    bpe_vocab=str(PUNCT_DIR / "bpe.vocab"),
                    num_threads=1,
                )
            )
        )
        self.settled: list[str] = []  # final marks for the earliest words
        # Words whose marks are final are written out once and kept, so a long
        # session does not re-punctuate its whole transcript on every new word.
        self.done_text = ""
        self.done_words = 0
        self.capital_next = True

    def _marks(self, words: list[str]) -> list[str]:
        """The mark after each word, or "" for none."""
        result = self.model.add_punctuation_with_case(" ".join(w.lower() for w in words)).split()
        if len(result) != len(words):
            return [""] * len(words)  # the model split a word differently: skip marks this time
        return [w[-1] if w[-1] in ".,?!" else "" for w in result]

    def format(self, words: list[str], hold: int) -> str:
        """Punctuate the text, leaving the newest `hold` words unmarked until they settle."""
        start = min(len(self.settled), len(words))
        recent = words[start:]
        marks = self._marks(recent) if recent else []
        if hold:
            marks[-hold:] = [""] * min(hold, len(marks))

        # Fix marks once they are well behind the newest words, so they can't flicker.
        if len(recent) > SETTLE_AFTER:
            last_end = max(
                (i for i, m in enumerate(marks[:-SETTLE_MARGIN]) if m in (".", "?", "!") and m),
                default=len(recent) // 2,
            )
            self.settled += marks[:last_end + 1]

        all_marks = self.settled[:start] + marks

        def written(index: int, capital: bool) -> tuple[str, bool]:
            word = words[index]
            mark = all_marks[index] if index < len(all_marks) else ""
            return (word[0].upper() + word[1:] if capital else word) + mark, mark in (".", "?", "!") and mark != ""

        # Everything whose mark is settled is written out once and remembered, so the work
        # here stays the same size however long the session runs.
        final = min(len(self.settled), len(words))
        if final > self.done_words:
            batch = []
            capital = self.capital_next
            for index in range(self.done_words, final):
                piece, capital = written(index, capital)
                batch.append(piece)
            self.capital_next = capital
            chunk = fix_terms(" ".join(batch))
            self.done_text += (" " + chunk) if self.done_text else chunk
            self.done_words = final

        tail = []
        capital = self.capital_next
        for index in range(self.done_words, len(words)):
            piece, capital = written(index, capital)
            tail.append(piece)
        if not tail:
            return self.done_text
        rest = fix_terms(" ".join(tail))
        return (self.done_text + " " + rest) if self.done_text else rest


class Engine:
    """Capture and recognition. Talks to the window through ui_q."""

    def __init__(self, ui_q, recognizer=None):
        self.ui_q = ui_q  # anything with a put() method
        self.recognizer = recognizer  # pass a loaded model so that starting is instant
        self.audio_q: "queue.Queue[bytes]" = queue.Queue()
        self.stop = threading.Event()
        self.pa = None
        self.stream = None
        self.rate = 0
        self.channels = 0

    def status(self, text: str) -> None:
        self.ui_q.put(("status", text))

    def _open_capture(self) -> None:
        """Open the loopback capture, or open it again: it follows whatever the default
        output is now, and a fresh stream replaces one that has quietly stopped."""
        dev = find_loopback(self.pa)
        rate = int(dev["defaultSampleRate"])
        channels = int(dev["maxInputChannels"])

        def callback(in_data, frame_count, time_info, status):
            self.audio_q.put(in_data)
            return (None, pyaudio.paContinue)

        new = self.pa.open(
            format=pyaudio.paInt16,
            channels=channels,
            rate=rate,
            input=True,
            input_device_index=dev["index"],
            frames_per_buffer=rate // 20,  # 50 ms chunks
            stream_callback=callback,
        )
        old, self.stream, self.rate, self.channels = self.stream, new, rate, channels
        if old is not None:
            try:
                old.stop_stream()
                old.close()
            except OSError:
                pass
        self.status(f"Listening to: {dev['name']}")

    def run(self) -> None:
        try:
            recognizer = self.recognizer or load_recognizer(self.status)
            self.pa = pyaudio.PyAudio()
            self._open_capture()
            self._recognize_loop(recognizer)
        except Exception as exc:
            self.ui_q.put(("error", f"{type(exc).__name__}: {exc}"))

    def _recognize_loop(self, recognizer) -> None:
        def fresh_stream():
            s = recognizer.create_stream()
            # The model loses the first second or two if speech is already playing when it starts.
            s.accept_waveform(SR, np.zeros(SR, dtype=np.float32))
            return s

        def reopen_capture() -> None:
            nonlocal resample, channels
            try:
                self._open_capture()
                resample = Resampler(self.rate)
                channels = self.channels
            except Exception as exc:
                self.status(f"Capture stopped ({exc}); trying again")

        stream = fresh_stream()
        resample = Resampler(self.rate)
        channels = self.channels
        punctuator = Punctuator()
        committed: list[str] = []  # the words of streams already retired (see the refresh below)
        words: list[str] = []
        shown = ""
        last_audio = last_change = last_chunk = last_refresh = last_try = time.monotonic()
        paused = True

        while not self.stop.is_set():
            chunks = []
            try:
                chunks.append(self.audio_q.get(timeout=0.2))
                while True:
                    chunks.append(self.audio_q.get_nowait())
            except queue.Empty:
                pass

            # If recognition ever falls behind (a big backlog drained at once), drop the
            # oldest audio and keep only the most recent, so the script stays live instead
            # of drifting minutes back on a long stream. Each chunk is 50 ms.
            max_chunks = int(MAX_LAG_SECONDS * 20)
            if len(chunks) > max_chunks:
                chunks = chunks[-max_chunks:]

            now = time.monotonic()
            if chunks:
                last_chunk = now
            # The capture has stopped, or gone a long while without a chunk: open it again.
            if (not self.stream.is_active() or now - last_chunk > CAPTURE_STALL_SECONDS) and now - last_try > 5:
                last_try = last_chunk = now
                reopen_capture()
                chunks = []  # anything drained came from the stream just closed
            if chunks:
                raw = np.frombuffer(b"".join(chunks), dtype=np.int16).reshape(-1, channels)
                audio = resample(raw.mean(axis=1).astype(np.float32) / 32768.0)
            else:
                # Windows sends nothing while no app plays sound, so feed silence
                # to let the last words through when a video is paused or stopped.
                audio = np.zeros(int((now - last_audio) * SR), dtype=np.float32)
            last_audio = now
            if len(audio) == 0:
                continue

            stream.accept_waveform(SR, audio)
            while recognizer.is_ready(stream):
                recognizer.decode_stream(stream)

            latest = committed + clean_words(recognizer.get_result(stream))
            if latest != words:
                words = latest
                last_change = now
                paused = False
                text = punctuator.format(words, hold=PUNCT_HOLD)
            elif not paused and now - last_change >= PAUSE_SECONDS:
                paused = True  # the speaker stopped, so the newest words can be punctuated too
                text = punctuator.format(words, hold=0)
                # A quiet moment well into the session: retire both streams for fresh ones.
                if now - last_refresh > REFRESH_MINUTES * 60:
                    committed = list(words)
                    stream = fresh_stream()
                    reopen_capture()
                    last_refresh = now
            else:
                continue
            if text != shown:
                shown = text
                self.ui_q.put(("text", text))

    def close(self) -> None:
        self.stop.set()
        try:
            if self.stream is not None:
                self.stream.stop_stream()
                self.stream.close()
            if self.pa is not None:
                self.pa.terminate()
        except OSError:
            pass


class Window:
    BG = "#2b2b2b"

    def __init__(self, verbose: bool):
        import tkinter as tk  # only this window needs it, not the service

        self.verbose = verbose
        self.ui_q: "queue.Queue[tuple]" = queue.Queue()
        self.engine = Engine(self.ui_q)
        self.shown = ""   # the text on screen
        self.target = ""  # everything the model has given so far
        self.last_reveal = 0.0
        self.saved = ""
        self.last_save = time.monotonic()
        TRANSCRIPT_DIR.mkdir(exist_ok=True)
        self.path = TRANSCRIPT_DIR / f"script_{datetime.now():%Y%m%d_%H%M%S}.txt"

        self.root = tk.Tk()
        self.root.title("Live Script")
        self.root.configure(bg=self.BG)
        self.root.attributes("-topmost", True)
        width, height = 900, 240
        x = (self.root.winfo_screenwidth() - width) // 2
        y = self.root.winfo_screenheight() - height - 90
        self.root.geometry(f"{width}x{height}+{x}+{y}")

        self.status_label = tk.Label(
            self.root, text="Starting...", anchor="w", bg=self.BG, fg="#9a9a9a",
            font=("Segoe UI", 9), padx=16,
        )
        self.status_label.pack(side="bottom", fill="x")
        self.text = tk.Text(
            self.root, wrap="word", bg=self.BG, fg="white", font=FONT, bd=0, padx=16, pady=12,
            highlightthickness=0, insertwidth=0, spacing2=4, cursor="arrow",
        )
        self.text.pack(fill="both", expand=True)
        self.text.configure(state="disabled")

        self.root.protocol("WM_DELETE_WINDOW", self.quit)
        threading.Thread(target=self.engine.run, daemon=True).start()
        self.root.after(20, self.poll)

    def log(self, kind: str, text: str) -> None:
        if self.verbose:
            print(f"{datetime.now():%H:%M:%S.%f}"[:-3], kind, text, flush=True)

    def poll(self) -> None:
        latest = None
        while True:
            try:
                event = self.ui_q.get_nowait()
            except queue.Empty:
                break
            if event[0] == "text":
                latest = event[1]
            elif event[0] == "status":
                self.status_label.configure(text=event[1])
                self.log("status", event[1])
            elif event[0] == "error":
                self.status_label.configure(text=f"Error: {event[1]}", fg="#ff8080")
                self.log("error", event[1])
        if latest is not None:
            self.target = latest
        self.reveal()
        if time.monotonic() - self.last_save >= SAVE_EVERY:
            self.save()
        self.root.after(20, self.poll)

    def reveal(self) -> None:
        """The model delivers words in bursts, so show each burst one word at a time."""
        if self.shown == self.target:
            return
        if not self.target.startswith(self.shown):
            # A word or mark already on screen changed: fix it now, at the same length.
            self.show(" ".join(self.target.split()[:len(self.shown.split())]))
        pending = self.target[len(self.shown):].split()
        if not pending:
            return
        # Fast enough to finish this burst before the next one arrives.
        gap = min(MAX_WORD_GAP, max(MIN_WORD_GAP, BURST_SECONDS / len(pending)))
        now = time.monotonic()
        if now - self.last_reveal >= gap:
            self.last_reveal = now
            start = len(self.shown) + len(self.target[len(self.shown):]) - len(
                self.target[len(self.shown):].lstrip())
            end = self.target.find(" ", start)
            self.show(self.target if end == -1 else self.target[:end])

    def show(self, new: str) -> None:
        """Update only the part of the text that changed."""
        follow = self.text.yview()[1] > 0.98  # don't jump while the user reads older text
        same = len(os.path.commonprefix([self.shown, new]))
        self.text.configure(state="normal")
        self.text.delete(f"1.0+{same}c", "end-1c")
        self.text.insert("end-1c", new[same:])
        self.text.configure(state="disabled")
        if follow:
            self.text.see("end")
        self.shown = new
        self.log("text", new[-90:])

    def save(self) -> None:
        self.last_save = time.monotonic()
        if self.target and self.target != self.saved:
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(self.target + "\n", encoding="utf-8")
            os.replace(tmp, self.path)
            self.saved = self.target

    def quit(self) -> None:
        self.engine.close()
        self.save()
        self.root.destroy()


def main() -> None:
    keep_fast()
    parser = argparse.ArgumentParser(description="Live captions of PC audio, saved to a text file.")
    parser.add_argument("--verbose", action="store_true", help="print timed caption events")
    args = parser.parse_args()
    window = Window(args.verbose)
    try:
        window.root.mainloop()
    except KeyboardInterrupt:
        window.quit()


if __name__ == "__main__":
    main()
