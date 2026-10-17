import { useEffect, useRef, type ReactNode } from "react";
import type { Track } from "livekit-client";
import { Volume2, VolumeX } from "lucide-react";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Slider } from "@/components/ui/slider";
import { getPlaybackContext, setUserVolume, useUserVolume, type VolumeKind } from "@/lib/user-volume";

// Plays one remote audio track honoring the per-person volume/mute. Up to
// 100% uses the element's own volume (the plain path); above that the track
// goes through a Web Audio gain while the element stays attached but muted.
export function RemoteAudio({
  track,
  userId,
  kind,
  deafened,
}: {
  track: Track | undefined;
  userId: string;
  kind: VolumeKind;
  deafened?: boolean;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const { volume, muted } = useUserVolume(kind, userId);
  const silent = !!deafened || muted || volume <= 0;
  const boost = !silent && volume > 1;

  useEffect(() => {
    const el = ref.current;
    if (!el || !track) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.muted = silent || boost;
    el.volume = Math.min(1, Math.max(0, volume));
  }, [silent, boost, volume]);

  useEffect(() => {
    const mst = track?.mediaStreamTrack;
    if (!boost || !mst) return;
    const ctx = getPlaybackContext();
    const src = ctx.createMediaStreamSource(new MediaStream([mst]));
    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain);
    gain.connect(ctx.destination);
    return () => {
      src.disconnect();
      gain.disconnect();
    };
  }, [boost, volume, track]);

  return <audio ref={ref} autoPlay playsInline />;
}

export function VolumeControls({ userId, kind, name }: { userId: string; kind: VolumeKind; name: string }) {
  const { volume, muted } = useUserVolume(kind, userId);
  const pct = Math.round(volume * 100);
  return (
    <>
      <ContextMenuLabel className="truncate max-w-56">{name}</ContextMenuLabel>
      <ContextMenuSeparator />
      <div className="px-2 py-2 space-y-2" onPointerDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{kind === "voice" ? "Volume do usuário" : "Volume da transmissão"}</span>
          <span className="tabular-nums text-foreground">{pct}%</span>
        </div>
        <Slider
          aria-label={kind === "voice" ? "Volume do usuário" : "Volume da transmissão"}
          min={0}
          max={200}
          step={5}
          value={[pct]}
          onValueChange={([v]) => setUserVolume(kind, userId, { volume: v / 100, muted: false })}
        />
      </div>
      <ContextMenuSeparator />
      <ContextMenuCheckboxItem
        checked={muted}
        onSelect={(e) => e.preventDefault()}
        onCheckedChange={(v) => setUserVolume(kind, userId, { muted: !!v })}
      >
        {muted ? <VolumeX className="w-4 h-4 mr-2" /> : <Volume2 className="w-4 h-4 mr-2" />}
        {kind === "voice" ? "Silenciar" : "Silenciar transmissão"}
      </ContextMenuCheckboxItem>
    </>
  );
}

// Right-click menu on a person's tile (voice) or on their stream (stream).
// Nothing for yourself.
export function ParticipantContextMenu({
  userId,
  name,
  isLocal,
  kinds,
  children,
}: {
  userId: string;
  name: string;
  isLocal: boolean;
  kinds: VolumeKind[];
  children: ReactNode;
}) {
  if (isLocal) return <>{children}</>;
  return (
    <ContextMenu>
      {/* display:contents keeps grid/flex layout untouched; the contextmenu
          event still bubbles up to this wrapper. */}
      <ContextMenuTrigger className="contents">{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-64">
        {kinds.map((k, i) => (
          <div key={k}>
            {i > 0 && <ContextMenuSeparator />}
            <VolumeControls userId={userId} kind={k} name={k === "voice" ? name : `Transmissão de ${name}`} />
          </div>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
