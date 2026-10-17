import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
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
