import { useState } from "react";
import { ChevronUp, Clapperboard } from "lucide-react";
import { saveClip } from "@/lib/clips";
import { useVoiceSettings } from "@/lib/voice-settings";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DEFAULT_SCREEN_SHARE_QUALITY,
  type ScreenShareQuality,
  type ScreenShareResolution,
} from "@/lib/livekit";

const KEY = "dexy.screenShareQuality";
const RESOLUTIONS: { value: ScreenShareResolution; label: string }[] = [
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
  { value: "1440p", label: "1440p" },
  { value: "source", label: "Nativa" },
];

function load(): ScreenShareQuality {
  try {
    const q = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (q && RESOLUTIONS.some((r) => r.value === q.resolution) && (q.fps === 30 || q.fps === 60)) return q;
  } catch {
    // ignore
  }
  return DEFAULT_SCREEN_SHARE_QUALITY;
}

export function useScreenShareQuality() {
  const [quality, setQuality] = useState<ScreenShareQuality>(load);
  const update = (q: ScreenShareQuality) => {
    setQuality(q);
    try {
      localStorage.setItem(KEY, JSON.stringify(q));
    } catch {
      // ignore
    }
  };
  return [quality, update] as const;
}

export function qualityLabel(q: ScreenShareQuality) {
  return `${q.resolution === "source" ? "Nativa" : q.resolution} · ${q.fps}`;
}

function Segment<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid gap-1 rounded-lg bg-secondary p-1" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={`px-2 py-1.5 rounded-md text-xs font-semibold transition ${
            value === o.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ScreenShareQualityPicker({
  value,
  onChange,
}: {
  value: ScreenShareQuality;
  onChange: (q: ScreenShareQuality) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          title="Qualidade da transmissão"
          className="h-8 px-2.5 rounded-full flex items-center gap-1 bg-secondary text-[11px] font-semibold text-muted-foreground hover:text-foreground transition"
        >
          {qualityLabel(value)}
          <ChevronUp className="w-3 h-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" className="w-64 space-y-3">
        <div className="text-xs font-semibold uppercase text-muted-foreground">Qualidade da transmissão</div>
        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground">Resolução</div>
          <Segment options={RESOLUTIONS} value={value.resolution} onChange={(resolution) => onChange({ ...value, resolution })} />
        </div>
        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground">Taxa de quadros</div>
          <Segment
            options={[
              { value: 30 as const, label: "30 FPS" },
              { value: 60 as const, label: "60 FPS" },
            ]}
            value={value.fps}
            onChange={(fps) => onChange({ ...value, fps })}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Nativa transmite na resolução do seu monitor (até 4K). Muda na hora, mesmo durante a transmissão.
        </p>
      </PopoverContent>
    </Popover>
  );
}

export function SaveClipButton({ sharing }: { sharing: boolean }) {
  const { clipsEnabled } = useVoiceSettings();
  if (!sharing || !clipsEnabled) return null;
  return (
    <button
      onClick={() => void saveClip()}
      title="Salvar clipe"
      aria-label="Salvar clipe"
      className="w-10 h-10 rounded-full grid place-items-center bg-secondary text-foreground hover:bg-secondary/70 transition"
    >
      <Clapperboard className="w-4 h-4" />
    </button>
  );
}
