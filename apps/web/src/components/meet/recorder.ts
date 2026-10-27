"use client";

/** Recording a meeting on the admin's own computer: the meeting as the page
 * shows it (everyone's faces, or a shared screen with the faces beside it) is
 * drawn into one picture, everyone's voices are mixed into one sound, and the
 * video is written to a file the admin chooses, a second at a time, as the
 * meeting goes. Nothing is uploaded anywhere. In a browser that cannot write
 * to a file as it goes (Firefox, Safari), the video is kept in the page and
 * saved as a download when the recording stops. */

type Writable = { write: (data: Blob) => Promise<void>; close: () => Promise<void> };
type SavePicker = (options: { suggestedName: string; id?: string; startIn?: string; types: { description: string; accept: Record<string, string[]> }[] }) =>
  Promise<{ name: string; createWritable: () => Promise<Writable> }>;

const WIDTH = 1280, HEIGHT = 720, FPS = 15;
const BACKGROUND = "#030807", TILE = "#0d1a14", INK = "#ecfff3", LEAF = "#b8ec93";

export type Recording = { file: string; stop: () => Promise<void> };

/** The name a recording is offered under: "2026-10-27 14.05 Team meeting.webm". */
const fileName = (title: string) => {
  const now = new Date();
  const two = (value: number) => String(value).padStart(2, "0");
  const safe = title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Meeting";
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}.${two(now.getMinutes())} ${safe}.webm`;
};

/** Asks where to save first (it must follow the admin's click at once), then records `room`. */
export async function startRecording(room: HTMLElement, title: string, onStopped: (reason: string) => void): Promise<Recording | null> {
  const suggested = fileName(title);
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  let target: { name: string; out: Writable } | null = null;
  if (picker) {
    try {
      const handle = await picker({ suggestedName: suggested, id: "kiasa-recordings", startIn: "videos", types: [{ description: "Meeting recording", accept: { "video/webm": [".webm"] } }] });
      target = { name: handle.name, out: await handle.createWritable() };
    } catch (error) {
      // Closed without choosing: no recording.
      if ((error as Error).name === "AbortError") return null;
      throw error;
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const draw = canvas.getContext("2d")!;

  // Everyone's voices, mixed; anyone who joins later is added as they come.
  const audio = new AudioContext();
  const mix = audio.createMediaStreamDestination();
  const heard = new Set<string>();
  const listen = () => {
    for (const element of room.querySelectorAll<HTMLMediaElement>("[data-voice]")) {
      const stream = element.srcObject as MediaStream | null;
      for (const track of stream?.getAudioTracks() ?? []) {
        if (heard.has(track.id) || track.readyState !== "live") continue;
        heard.add(track.id);
        audio.createMediaStreamSource(new MediaStream([track])).connect(mix);
      }
    }
  };
  listen();

  const paint = () => {
    draw.fillStyle = BACKGROUND;
    draw.fillRect(0, 0, WIDTH, HEIGHT);
    const tiles = [...room.querySelectorAll<HTMLElement>("[data-tile]")];
    const shared = tiles.find(tile => tile.dataset.tile === "screen");
    const faces = tiles.filter(tile => tile.dataset.tile !== "screen");
    if (shared) {
      // The screen large, the faces in a column beside it.
      tile(shared, 16, 16, WIDTH - 312, HEIGHT - 32, true);
      const height = Math.min(160, (HEIGHT - 32 - (faces.length - 1) * 12) / Math.max(1, faces.length));
      faces.forEach((face, index) => tile(face, WIDTH - 280, 16 + index * (height + 12), 264, height, false));
    } else {
      const columns = Math.ceil(Math.sqrt(faces.length || 1));
      const rows = Math.ceil((faces.length || 1) / columns);
      const width = (WIDTH - 32 - (columns - 1) * 12) / columns, height = (HEIGHT - 32 - (rows - 1) * 12) / rows;
      faces.forEach((face, index) => tile(face, 16 + (index % columns) * (width + 12), 16 + Math.floor(index / columns) * (height + 12), width, height, false));
    }
    // That this is a recording, in its corner.
    draw.fillStyle = "#ff5d5d";
    draw.beginPath();
    draw.arc(WIDTH - 30, 30, 7, 0, Math.PI * 2);
    draw.fill();
  };

  function tile(element: HTMLElement, x: number, y: number, width: number, height: number, whole: boolean) {
    draw.fillStyle = TILE;
    draw.beginPath();
    draw.roundRect(x, y, width, height, 12);
    draw.fill();
    const video = element.querySelector("video");
    const showing = video && element.dataset.camera !== "off" && video.videoWidth > 0;
    if (showing) {
      draw.save();
      draw.beginPath();
      draw.roundRect(x, y, width, height, 12);
      draw.clip();
      // A screen whole, a face filling its tile.
      const scale = whole ? Math.min(width / video.videoWidth, height / video.videoHeight) : Math.max(width / video.videoWidth, height / video.videoHeight);
      const w = video.videoWidth * scale, h = video.videoHeight * scale;
      draw.drawImage(video, x + (width - w) / 2, y + (height - h) / 2, w, h);
      draw.restore();
    } else {
      const radius = Math.min(width, height) * 0.2;
      draw.fillStyle = "#2b5a3e";
      draw.beginPath();
      draw.arc(x + width / 2, y + height / 2, radius, 0, Math.PI * 2);
      draw.fill();
      draw.fillStyle = INK;
      draw.font = `700 ${Math.round(radius * 0.8)}px system-ui, sans-serif`;
      draw.textAlign = "center";
      draw.textBaseline = "middle";
      draw.fillText(element.dataset.initials ?? "", x + width / 2, y + height / 2);
    }
    if (element.dataset.speaking === "true") {
      draw.strokeStyle = LEAF;
      draw.lineWidth = 3;
      draw.beginPath();
      draw.roundRect(x + 1.5, y + 1.5, width - 3, height - 3, 11);
      draw.stroke();
    }
    const name = element.dataset.name ?? "";
    if (name) {
      draw.font = "600 15px system-ui, sans-serif";
      draw.textAlign = "left";
      draw.textBaseline = "alphabetic";
      const label = draw.measureText(name).width + 20;
      draw.fillStyle = "rgb(3 8 7 / 0.7)";
      draw.beginPath();
      draw.roundRect(x + 10, y + height - 36, label, 26, 8);
      draw.fill();
      draw.fillStyle = INK;
      draw.fillText(name, x + 20, y + height - 18);
    }
  }

  paint();
  const picture = canvas.captureStream(FPS);
  const stream = new MediaStream([...picture.getVideoTracks(), ...mix.stream.getAudioTracks()]);
  const type = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find(kind => MediaRecorder.isTypeSupported(kind)) ?? "";
  const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 1_500_000, audioBitsPerSecond: 96_000 });
  const kept: Blob[] = [];
  let writing = Promise.resolve();
  let failed = "";
  recorder.ondataavailable = ({ data }) => {
    if (!data.size) return;
    if (!target) { kept.push(data); return; }
    writing = writing.then(() => target!.out.write(data)).catch(() => {
      failed = "The recording could not be written to its file (is the disk full?). It stopped there.";
    });
  };
  // A timer, not animation frames: it keeps drawing while the tab is behind another.
  const timer = window.setInterval(() => {
    paint();
    listen();
    if (failed && recorder.state === "recording") void stop(failed);
  }, 1000 / FPS);
  recorder.start(1000);

  let stopping: Promise<void> | null = null;
  const stop = (reason = "") => stopping ??= (async () => {
    window.clearInterval(timer);
    if (recorder.state !== "inactive") {
      const done = new Promise(resolve => recorder.addEventListener("stop", resolve, { once: true }));
      recorder.stop();
      await done;
    }
    picture.getTracks().forEach(track => track.stop());
    await audio.close().catch(() => {});
    await writing;
    if (target) await target.out.close().catch(() => {});
    else if (kept.length) {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob(kept, { type: "video/webm" }));
      link.download = suggested;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
    }
    onStopped(reason);
  })();

  return { file: target?.name ?? suggested, stop: () => stop() };
}
