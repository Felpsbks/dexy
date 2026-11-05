import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { prettyKey } from "@/lib/ptt";
import {
  enumerateAudioDevices,
  getSelectedAudioDevice,
  saveSelectedAudioDevice,
  type AudioDevice,
} from "@/lib/audio-devices";
import {
  updateVoiceSettings,
  useVoiceSettings,
  type NoiseSuppressionMode,
} from "@/lib/voice-settings";

const NOISE_OPTIONS: { value: NoiseSuppressionMode; label: string; desc: string }[] = [
  {
    value: "krisp",
    label: "Krisp",
    desc: "Remove teclado, mouse, ventilador e música do jogo. Com headset compatível também remove vozes ao fundo.",
  },
  { value: "standard", label: "Padrão", desc: "Supressão básica do navegador. Mais leve, remove menos." },
  { value: "off", label: "Nenhuma", desc: "Áudio cru do microfone." },
];

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative w-11 h-6 rounded-full transition shrink-0 ${on ? "bg-primary" : "bg-muted"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-background transition ${on ? "translate-x-5" : ""}`}
      />
    </button>
  );
}

function MicTest() {
  const settings = useVoiceSettings();
  const [running, setRunning] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => () => stopRef.current?.(), []);

  const start = async () => {
    setError(null);
    try {
      const selected = await getSelectedAudioDevice().catch(() => null);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: settings.echoCancellation,
          autoGainControl: settings.autoGainControl,
          noiseSuppression: settings.noiseSuppression !== "off",
          ...(selected ? { deviceId: { exact: selected.deviceId } } : {}),
        },
      });
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      let raf = 0;
      const tick = () => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        const db = 10 * Math.log10(sum / buf.length + 1e-12);
        setLevel(Math.max(0, Math.min(1, (db + 60) / 60)));
        raf = requestAnimationFrame(tick);
      };
      tick();
      stopRef.current = () => {
        cancelAnimationFrame(raf);
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close();
        setLevel(0);
        setRunning(false);
        stopRef.current = null;
      };
      setRunning(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível abrir o microfone.");
    }
  };

  return (
    <div className="p-4 border border-border rounded-xl bg-card space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="font-medium">Teste de microfone</div>
          <div className="text-sm text-muted-foreground">Fale e veja o nível. O Krisp só atua dentro das chamadas.</div>
        </div>
        <button
          onClick={() => (running ? stopRef.current?.() : void start())}
          className="h-9 px-4 rounded-lg flex items-center gap-2 bg-secondary hover:bg-secondary/70 text-sm font-medium transition"
        >
          {running ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          {running ? "Parar" : "Vamos verificar"}
        </button>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-75"
          style={{ width: `${Math.round(level * 100)}%` }}
        />
      </div>
      {error && <div className="text-sm text-destructive">{error}</div>}
    </div>
  );
}

function PttKeyRecorder({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const [recording, setRecording] = useState(false);
  useEffect(() => {
    if (!recording) return;
    const key = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== "Escape") onChange(e.code);
      setRecording(false);
    };
    const mouse = (e: MouseEvent) => {
      if (e.button < 1) return;
      e.preventDefault();
      onChange(`Mouse${e.button + 1}`);
      setRecording(false);
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("mousedown", mouse, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("mousedown", mouse, true);
    };
  }, [recording, onChange]);
  return (
    <button
      onClick={() => setRecording(true)}
      onContextMenu={(e) => e.preventDefault()}
      className={`min-w-48 h-9 px-3 rounded-lg border text-sm transition ${
        recording ? "border-primary text-primary animate-pulse" : "border-border bg-background/40"
      }`}
    >
      {recording ? "Pressione uma tecla ou botão do mouse…" : prettyKey(value)}
    </button>
  );
}

export function VoiceVideoSettings() {
  const settings = useVoiceSettings();
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [deviceId, setDeviceId] = useState("");

  useEffect(() => {
    void (async () => {
      setDevices(await enumerateAudioDevices());
      const selected = await getSelectedAudioDevice().catch(() => null);
      if (selected) setDeviceId(selected.deviceId);
    })();
  }, []);

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="text-xs uppercase text-muted-foreground font-semibold">Dispositivo de entrada</div>
        <select
          value={deviceId}
          onChange={(e) => {
            setDeviceId(e.target.value);
            saveSelectedAudioDevice(e.target.value);
          }}
          className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm"
        >
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || "Microfone"}
            </option>
          ))}
        </select>
      </section>

      <MicTest />

      <section className="space-y-2">
        <div className="text-xs uppercase text-muted-foreground font-semibold">Modo de entrada</div>
        <div className="grid grid-cols-2 gap-2" role="radiogroup">
          {(
            [
              ["voice", "Detecção de voz", "Transmite quando você fala."],
              ["ptt", "Aperte para falar", "Só transmite enquanto segura a tecla."],
            ] as const
          ).map(([v, label, desc]) => (
            <button
              key={v}
              role="radio"
              aria-checked={settings.inputMode === v}
              onClick={() => updateVoiceSettings({ inputMode: v })}
              className={`text-left p-4 rounded-xl border transition ${
                settings.inputMode === v ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-secondary/40"
              }`}
            >
              <div className="font-medium">{label}</div>
              <div className="text-sm text-muted-foreground">{desc}</div>
            </button>
          ))}
        </div>
        {settings.inputMode === "ptt" && (
          <div className="space-y-3 p-4 border border-border rounded-xl bg-card">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-medium">Atalho</div>
                <div className="text-sm text-muted-foreground">
                  {typeof window !== "undefined" && (window as unknown as { dexyDesktop?: unknown }).dexyDesktop
                    ? "Funciona em qualquer lugar, inclusive dentro do jogo."
                    : "No navegador funciona com o Dexy em foco. No app desktop funciona em qualquer lugar."}
                </div>
              </div>
              <PttKeyRecorder value={settings.pttKey} onChange={(code) => updateVoiceSettings({ pttKey: code })} />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Atraso ao soltar</span>
                <span className="tabular-nums text-muted-foreground">{settings.pttReleaseDelay} ms</span>
              </div>
              <input
                type="range"
                min={0}
                max={1000}
                step={20}
                value={settings.pttReleaseDelay}
                onChange={(e) => updateVoiceSettings({ pttReleaseDelay: Number(e.target.value) })}
                className="w-full accent-[var(--primary)]"
                aria-label="Atraso ao soltar"
              />
            </div>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="text-xs uppercase text-muted-foreground font-semibold">Supressão de ruído</div>
        <div className="space-y-2" role="radiogroup">
          {NOISE_OPTIONS.map((o) => (
            <button
              key={o.value}
              role="radio"
              aria-checked={settings.noiseSuppression === o.value}
              onClick={() => updateVoiceSettings({ noiseSuppression: o.value })}
              className={`w-full text-left p-4 rounded-xl border transition ${
                settings.noiseSuppression === o.value ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-secondary/40"
              }`}
            >
              <div className="font-medium">{o.label}</div>
              <div className="text-sm text-muted-foreground">{o.desc}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="text-xs uppercase text-muted-foreground font-semibold">Clipes</div>
        <label className="flex items-start justify-between gap-4 p-4 border border-border rounded-xl bg-card">
          <div>
            <div className="font-medium">Gravar clipes enquanto transmito</div>
            <div className="text-sm text-muted-foreground">
              Guarda o que você transmite para salvar os últimos segundos com um atalho. Usa mais CPU enquanto compartilha a tela.
            </div>
          </div>
          <Toggle
            label="Gravar clipes"
            on={settings.clipsEnabled}
            onChange={(v) => updateVoiceSettings({ clipsEnabled: v })}
          />
        </label>
        {settings.clipsEnabled && (
          <div className="flex items-center justify-between gap-4 p-4 border border-border rounded-xl bg-card">
            <div className="font-medium">Duração mínima do clipe</div>
            <div className="flex gap-1 rounded-lg bg-secondary p-1">
              {[15, 30, 60].map((n) => (
                <button
                  key={n}
                  onClick={() => updateVoiceSettings({ clipLengthSeconds: n })}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition ${
                    settings.clipLengthSeconds === n ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {n}s
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="text-xs uppercase text-muted-foreground font-semibold">Processamento de voz</div>
        <label className="flex items-start justify-between gap-4 p-4 border border-border rounded-xl bg-card">
          <div>
            <div className="font-medium">Cancelamento de eco</div>
            <div className="text-sm text-muted-foreground">Evita que o som dos seus alto-falantes volte pelo microfone.</div>
          </div>
          <Toggle
            label="Cancelamento de eco"
            on={settings.echoCancellation}
            onChange={(v) => updateVoiceSettings({ echoCancellation: v })}
          />
        </label>
        <label className="flex items-start justify-between gap-4 p-4 border border-border rounded-xl bg-card">
          <div>
            <div className="font-medium">Controle automático de ganho</div>
            <div className="text-sm text-muted-foreground">
              Aumenta o volume de microfones baixos, mas também amplifica sons e vozes ao fundo.
            </div>
          </div>
          <Toggle
            label="Controle automático de ganho"
            on={settings.autoGainControl}
            onChange={(v) => updateVoiceSettings({ autoGainControl: v })}
          />
        </label>
      </section>
    </div>
  );
}
