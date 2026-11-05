import { toast } from "sonner";
import { getDesktop } from "./desktop";
import { getVoiceSettings } from "./voice-settings";

// "Save the last N seconds" of the local screen share. WebM pieces cut from
// the middle of a recording aren't playable on their own, so two recorders
// run staggered: the older one always holds a valid file of N to 2N seconds.
const MIME_CANDIDATES = ["video/webm;codecs=h264,opus", "video/webm;codecs=vp9,opus", "video/webm"];

interface Segment {
  recorder: MediaRecorder;
  chunks: Blob[];
  startedAt: number;
}

let stream: MediaStream | null = null;
let segments: Segment[] = [];
let timers: ReturnType<typeof setTimeout>[] = [];
let mime = "";
let saving = false;

function spawn() {
  if (!stream) return;
  const seg: Segment = {
    recorder: new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 }),
    chunks: [],
    startedAt: Date.now(),
  };
  seg.recorder.ondataavailable = (e) => e.data.size > 0 && seg.chunks.push(e.data);
  seg.recorder.start(1000);
  segments.push(seg);
}

function dropOldest() {
  const old = segments.shift();
  if (old?.recorder.state !== "inactive") old?.recorder.stop();
}

export function isClipBufferActive() {
  return !!stream;
}

export function startClipBuffer(tracks: MediaStreamTrack[]) {
  stopClipBuffer();
  if (!getVoiceSettings().clipsEnabled || tracks.length === 0 || typeof MediaRecorder === "undefined") return;
  mime = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
  if (!mime) return;
  stream = new MediaStream(tracks);
  const lengthMs = getVoiceSettings().clipLengthSeconds * 1000;
  spawn();
  timers.push(setTimeout(spawn, lengthMs));
  timers.push(
    setTimeout(() => {
      const rotate = () => {
        dropOldest();
        spawn();
      };
      rotate();
      timers.push(setInterval(rotate, lengthMs) as unknown as ReturnType<typeof setTimeout>);
    }, lengthMs * 2),
  );
}

export function stopClipBuffer() {
  timers.forEach((t) => clearTimeout(t));
  timers.forEach((t) => clearInterval(t));
  timers = [];
  segments.forEach((s) => s.recorder.state !== "inactive" && s.recorder.stop());
  segments = [];
  stream = null;
}

function stamp() {
  return new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
}

export async function saveClip() {
  const seg = segments[0];
  if (!seg) {
    toast.error(
      getVoiceSettings().clipsEnabled
        ? "Os clipes gravam enquanto você compartilha a tela."
        : "Ative os clipes em Configurações › Voz e vídeo.",
    );
    return;
  }
  if (saving) return;
  saving = true;
  try {
    // Finishing the older recorder is what makes its file valid; the newer
    // one keeps running and a fresh one takes the freed slot.
    segments.shift();
    const done = new Promise<void>((resolve) => {
      seg.recorder.onstop = () => resolve();
    });
    seg.recorder.stop();
    spawn();
    await done;
    const blob = new Blob(seg.chunks, { type: "video/webm" });
    const seconds = Math.round((Date.now() - seg.startedAt) / 1000);
    const desktop = getDesktop();
    if (desktop?.saveClip) {
      const path = await desktop.saveClip(new Uint8Array(await blob.arrayBuffer()));
      if (!path) throw new Error("save failed");
      toast.success(`Clipe de ${seconds}s salvo`, {
        description: "Em Vídeos › Dexy Clipes",
        action: { label: "Abrir pasta", onClick: () => desktop.showClip?.(path) },
      });
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `dexy-clipe-${stamp()}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      toast.success(`Clipe de ${seconds}s salvo`);
    }
  } catch {
    toast.error("Não foi possível salvar o clipe.");
  } finally {
    saving = false;
  }
}
