import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { X, Mic, Video, Monitor, Square, Download, Sparkles, Circle } from "lucide-react";

type Tab = "avatar" | "record" | "mirror";

const EMOJIS = ["🔥", "🦊", "🐉", "🌙", "⚡", "🌈", "🚀", "🎧", "🍀", "🌊", "🐺", "👾", "🪐", "🎨", "🍥", "☕"];
const GRADIENTS = [
  ["#f97316", "#e11d48"],
  ["#8b5cf6", "#ec4899"],
  ["#0ea5e9", "#22d3ee"],
  ["#22c55e", "#84cc16"],
  ["#f59e0b", "#f43f5e"],
  ["#6366f1", "#0f172a"],
];
const ANIMS = [
  { id: "pulse", label: "Pulsar" },
  { id: "spin", label: "Girar" },
  { id: "bounce", label: "Saltar" },
  { id: "float", label: "Flutuar" },
] as const;

type AnimId = (typeof ANIMS)[number]["id"];

function animProps(a: AnimId) {
  switch (a) {
    case "pulse":
      return { scale: [1, 1.15, 1] };
    case "spin":
      return { rotate: [0, 360] };
    case "bounce":
      return { y: [0, -10, 0] };
    case "float":
      return { y: [0, -6, 0], rotate: [-4, 4, -4] };
  }
}

export function StudioView({
  onClose,
  onApplyAvatar,
}: {
  onClose: () => void;
  onApplyAvatar: (dataUrl: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("avatar");
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="flex-1 flex flex-col overflow-hidden"
    >
      <div className="h-14 shrink-0 border-b border-border px-6 flex items-center gap-6">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="font-semibold">Studio</span>
        </div>
        <div className="flex gap-1">
          {(
            [
              ["avatar", "Avatar"],
              ["record", "Gravação"],
              ["mirror", "Espelhar 4K"],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-3 py-1.5 rounded-md text-sm transition ${
                tab === id ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button onClick={onClose} className="ml-auto p-2 rounded hover:bg-secondary text-muted-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-8">
        {tab === "avatar" && <AvatarBuilder onApply={onApplyAvatar} />}
        {tab === "record" && <Recorder />}
        {tab === "mirror" && <ScreenMirror />}
      </div>
    </motion.div>
  );
}

function AvatarBuilder({ onApply }: { onApply: (dataUrl: string) => void }) {
  const [emoji, setEmoji] = useState(EMOJIS[0]);
  const [grad, setGrad] = useState(0);
  const [anim, setAnim] = useState<AnimId>("pulse");

  const svgDataUrl = (() => {
    const [a, b] = GRADIENTS[grad];
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='128' height='128' viewBox='0 0 128 128'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='${a}'/><stop offset='100%' stop-color='${b}'/></linearGradient></defs><rect width='128' height='128' rx='64' fill='url(%23g)'/><text x='50%25' y='54%25' text-anchor='middle' dominant-baseline='middle' font-size='72' font-family='Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif'>${emoji}</text></svg>`;
    return `data:image/svg+xml;utf8,${svg.replace(/#/g, "%23").replace(/"/g, "'")}`;
  })();

  return (
    <div className="grid md:grid-cols-[280px_1fr] gap-8 max-w-4xl">
      <div className="flex flex-col items-center gap-4">
        <div
          className="w-56 h-56 rounded-full grid place-items-center shadow-xl"
          style={{ backgroundImage: `linear-gradient(135deg, ${GRADIENTS[grad][0]}, ${GRADIENTS[grad][1]})` }}
        >
          <motion.div
            animate={animProps(anim)}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            className="text-8xl select-none"
          >
            {emoji}
          </motion.div>
        </div>
        <button
          onClick={() => onApply(svgDataUrl)}
          className="px-5 py-2.5 rounded-lg text-primary-foreground font-medium"
          style={{ backgroundImage: "var(--gradient-dexy)" }}
        >
          Aplicar avatar
        </button>
        <p className="text-xs text-muted-foreground text-center">Válido apenas nesta sessão.</p>
      </div>
      <div className="space-y-6">
        <Section title="Emoji">
          <div className="grid grid-cols-8 gap-2">
            {EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => setEmoji(e)}
                className={`aspect-square rounded-lg text-2xl border transition ${
                  emoji === e ? "border-primary bg-primary/10" : "border-border bg-secondary hover:border-primary/40"
                }`}
              >
                {e}
              </button>
            ))}
          </div>
        </Section>
        <Section title="Fundo">
          <div className="flex flex-wrap gap-2">
            {GRADIENTS.map((g, i) => (
              <button
                key={i}
                onClick={() => setGrad(i)}
                className={`w-14 h-14 rounded-xl border-2 transition ${grad === i ? "border-primary scale-105" : "border-transparent"}`}
                style={{ backgroundImage: `linear-gradient(135deg, ${g[0]}, ${g[1]})` }}
              />
            ))}
          </div>
        </Section>
        <Section title="Animação">
          <div className="flex flex-wrap gap-2">
            {ANIMS.map((a) => (
              <button
                key={a.id}
                onClick={() => setAnim(a.id)}
                className={`px-3 py-1.5 rounded-md text-sm border transition ${
                  anim === a.id ? "border-primary bg-primary/10 text-foreground" : "border-border bg-secondary text-muted-foreground"
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">{title}</div>
      {children}
    </div>
  );
}

function Recorder() {
  const [mode, setMode] = useState<"audio" | "video">("audio");
  const [recording, setRecording] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<number | null>(null);

  const stopAll = () => {
    recRef.current?.state === "recording" && recRef.current.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => () => stopAll(), []);

  const start = async () => {
    setError(null);
    setUrl(null);
    setElapsed(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        mode === "audio" ? { audio: true } : { audio: true, video: { width: 1280, height: 720 } },
      );
      streamRef.current = stream;
      if (mode === "video" && videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mode === "audio" ? "audio/webm" : "video/webm" });
        setUrl(URL.createObjectURL(blob));
      };
      rec.start();
      recRef.current = rec;
      setRecording(true);
      timerRef.current = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao acessar mídia.");
    }
  };

  const stop = () => {
    stopAll();
    setRecording(false);
  };

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex gap-2">
        {(["audio", "video"] as const).map((m) => (
          <button
            key={m}
            onClick={() => !recording && setMode(m)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm transition ${
              mode === m ? "border-primary bg-primary/10" : "border-border bg-secondary text-muted-foreground"
            }`}
          >
            {m === "audio" ? <Mic className="w-4 h-4" /> : <Video className="w-4 h-4" />}
            {m === "audio" ? "Áudio" : "Vídeo + Áudio"}
          </button>
        ))}
      </div>

      {mode === "video" && (
        <video
          ref={videoRef}
          muted
          playsInline
          className="w-full aspect-video rounded-xl bg-black object-cover border border-border"
        />
      )}

      <div className="flex items-center gap-3">
        {!recording ? (
          <button
            onClick={start}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-primary-foreground"
            style={{ backgroundImage: "var(--gradient-dexy)" }}
          >
            <Circle className="w-4 h-4 fill-current" />
            Iniciar gravação
          </button>
        ) : (
          <button
            onClick={stop}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-destructive text-destructive-foreground"
          >
            <Square className="w-4 h-4 fill-current" />
            Parar
          </button>
        )}
        {recording && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
            {mm}:{ss}
          </div>
        )}
      </div>

      {error && <div className="text-sm text-destructive">{error}</div>}

      {url && (
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">Prévia</div>
          {mode === "audio" ? (
            <audio src={url} controls className="w-full" />
          ) : (
            <video src={url} controls className="w-full aspect-video rounded-xl bg-black border border-border" />
          )}
          <a
            href={url}
            download={`dexy-${mode}-${Date.now()}.webm`}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary border border-border hover:border-primary/40 text-sm"
          >
            <Download className="w-4 h-4" />
            Baixar
          </a>
        </div>
      )}
    </div>
  );
}

function ScreenMirror() {
  const [active, setActive] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recUrl, setRecUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<{ w: number; h: number; fps: number } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const stopAll = () => {
    recRef.current?.state === "recording" && recRef.current.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setActive(false);
    setRecording(false);
  };

  useEffect(() => () => stopAll(), []);

  const start = async () => {
    setError(null);
    setRecUrl(null);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 3840 },
          height: { ideal: 2160 },
          frameRate: { ideal: 60 },
        } as MediaTrackConstraints,
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      const track = stream.getVideoTracks()[0];
      const s = track.getSettings();
      setInfo({ w: s.width ?? 0, h: s.height ?? 0, fps: Math.round(s.frameRate ?? 0) });
      track.addEventListener("ended", stopAll);
      setActive(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível iniciar o compartilhamento.");
    }
  };

  const startRec = () => {
    if (!streamRef.current) return;
    chunksRef.current = [];
    const rec = new MediaRecorder(streamRef.current, { mimeType: "video/webm;codecs=vp9,opus" });
    rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      setRecUrl(URL.createObjectURL(blob));
    };
    rec.start();
    recRef.current = rec;
    setRecording(true);
  };

  const stopRec = () => {
    recRef.current?.stop();
    setRecording(false);
  };

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        {!active ? (
          <button
            onClick={start}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-primary-foreground"
            style={{ backgroundImage: "var(--gradient-dexy)" }}
          >
            <Monitor className="w-4 h-4" />
            Espelhar tela em 4K
          </button>
        ) : (
          <>
            <button onClick={stopAll} className="px-4 py-2 rounded-lg bg-secondary border border-border text-sm">
              Encerrar espelhamento
            </button>
            {!recording ? (
              <button
                onClick={startRec}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-destructive/90 text-destructive-foreground text-sm"
              >
                <Circle className="w-4 h-4 fill-current" />
                Gravar
              </button>
            ) : (
              <button onClick={stopRec} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-destructive text-destructive-foreground text-sm">
                <Square className="w-4 h-4 fill-current" />
                Parar gravação
              </button>
            )}
          </>
        )}
        {info && (
          <div className="text-xs text-muted-foreground">
            {info.w}×{info.h} · {info.fps}fps{" "}
            {info.w >= 3840 ? (
              <span className="ml-1 text-primary">4K</span>
            ) : (
              <span className="ml-1">(navegador/monitor entregou resolução menor)</span>
            )}
          </div>
        )}
      </div>

      <video
        ref={videoRef}
        muted
        playsInline
        className="w-full aspect-video rounded-xl bg-black object-contain border border-border"
      />

      {error && <div className="text-sm text-destructive">{error}</div>}
      {!active && !error && (
        <p className="text-xs text-muted-foreground">
          Pedimos <code>3840×2160@60</code>; o navegador entrega a maior resolução disponível para a fonte escolhida.
        </p>
      )}

      {recUrl && (
        <div className="space-y-3">
          <video src={recUrl} controls className="w-full aspect-video rounded-xl bg-black border border-border" />
          <a
            href={recUrl}
            download={`dexy-tela-${Date.now()}.webm`}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary border border-border hover:border-primary/40 text-sm"
          >
            <Download className="w-4 h-4" />
            Baixar gravação
          </a>
        </div>
      )}
    </div>
  );
}