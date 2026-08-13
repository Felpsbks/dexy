import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { Track } from "livekit-client";
import {
  Loader2,
  LogOut,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  MonitorUp,
  ScreenShareOff,
  Video,
  VideoOff,
} from "lucide-react";
import { useVoiceRoom, type ParticipantInfo, type ScreenShareQuality, type VoiceRoomHook } from "@/lib/livekit";
import { useReconnectingSound, useScreenShareSound, useMuteToggleSound } from "@/lib/callSounds";
import { avatarFor } from "@/lib/format";
import { SpeakingAwareAvatar } from "@/components/SpeakingAwareAvatar";
import type { MemberWithProfile } from "@/lib/queries";

function TrackVideo({ track, muted }: { track: Track | undefined; muted?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !track) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return (
    <video ref={ref} muted={muted} autoPlay playsInline className="w-full h-full object-cover" />
  );
}

function TrackAudio({ track, muted }: { track: Track | undefined; muted?: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !track) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return <audio ref={ref} autoPlay muted={muted} />;
}

// Fullscreens the tile's own container (not just the <video>) so the name/
// mic badge overlay comes along for the ride instead of disappearing.
// Tracks state via the fullscreenchange event, not just the click, so the
// icon still flips back if the user exits with Esc instead of this button.
function FullscreenButton({ targetRef }: { targetRef: React.RefObject<HTMLElement | null> }) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === targetRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [targetRef]);

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (document.fullscreenElement) document.exitFullscreen();
        else targetRef.current?.requestFullscreen();
      }}
      title={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
      className="absolute top-2 right-2 p-1.5 rounded-md bg-background/70 backdrop-blur text-foreground opacity-0 group-hover:opacity-100 transition hover:bg-background/90"
    >
      {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
    </button>
  );
}

function ParticipantTile({
  p,
  avatarSrc,
  deafened,
}: {
  p: ParticipantInfo;
  avatarSrc: string;
  deafened?: boolean;
}) {
  const videoTrack = p.screenShareTrack ?? p.cameraTrack;
  const tileRef = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={tileRef}
      className={`group relative aspect-video rounded-xl overflow-hidden bg-card border transition ${
        p.isSpeaking ? "border-primary shadow-[var(--shadow-glow)]" : "border-border"
      }`}
    >
      {!p.isLocal && <TrackAudio track={p.micTrack} muted={deafened} />}
      {videoTrack ? (
        <>
          <TrackVideo track={videoTrack} muted={p.isLocal} />
          <FullscreenButton targetRef={tileRef} />
        </>
      ) : (
        <div className="w-full h-full grid place-items-center">
          <SpeakingAwareAvatar
            src={avatarSrc}
            isSpeaking={p.isSpeaking}
            className={`w-16 h-16 rounded-full object-cover ring-2 ${
              p.isSpeaking ? "ring-primary" : "ring-transparent"
            }`}
          />
        </div>
      )}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-md bg-background/70 backdrop-blur text-xs">
        {p.micMuted ? (
          <MicOff className="w-3.5 h-3.5 text-destructive" />
        ) : (
          <Mic className="w-3.5 h-3.5 text-muted-foreground" />
        )}
        <span className="truncate max-w-32">{p.name}</span>
        {p.screenShareTrack && <MonitorUp className="w-3.5 h-3.5 text-primary" />}
      </div>
    </div>
  );
}

// Discord-style "you're sharing" banner: the toolbar button below only ever
// starts/stops (the single obvious action everyone expects); switching to a
// different window/screen without stopping lives here as a secondary action.
function ScreenShareBanner({ onSwap, onStop }: { onSwap: () => void; onStop: () => void }) {
  return (
    <div className="mx-4 mt-3 flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm">
      <MonitorUp className="w-4 h-4 text-primary shrink-0" />
      <span className="flex-1 min-w-0 truncate">Você está compartilhando sua tela</span>
      <button
        onClick={onSwap}
        className="text-xs font-semibold text-primary hover:underline shrink-0"
      >
        Trocar tela
      </button>
      <button
        onClick={onStop}
        className="text-xs font-semibold px-2 py-1 rounded-md bg-destructive text-destructive-foreground hover:brightness-110 transition shrink-0"
      >
        Parar de compartilhar
      </button>
    </div>
  );
}

function ScreenShareQualityToggle({
  value,
  onChange,
}: {
  value: ScreenShareQuality;
  onChange: (q: ScreenShareQuality) => void;
}) {
  return (
    <div className="flex items-center rounded-full bg-secondary p-0.5 text-[10px] font-semibold">
      {(["1080p", "4k"] as const).map((q) => (
        <button
          key={q}
          onClick={() => onChange(q)}
          className={`px-2 py-1 rounded-full transition ${
            value === q ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {q === "4k" ? "4K" : "HD"}
        </button>
      ))}
    </div>
  );
}

function ControlButton({
  active,
  onClick,
  icon: Icon,
  offIcon: OffIcon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Mic;
  offIcon: typeof Mic;
  label: string;
}) {
  const Displayed = active ? Icon : OffIcon;
  return (
    <button
      onClick={onClick}
      title={label}
      className={`w-11 h-11 rounded-full grid place-items-center transition ${
        active
          ? "bg-secondary text-foreground hover:bg-secondary/70"
          : "bg-destructive/15 text-destructive hover:bg-destructive/25"
      }`}
    >
      <Displayed className="w-4.5 h-4.5" />
    </button>
  );
}

export function VoiceRoomView({
  channelId,
  channelName,
  members,
  deafened,
  onVoiceChange,
}: {
  channelId: string;
  channelName: string;
  members: MemberWithProfile[];
  deafened?: boolean;
  onVoiceChange?: (voice: VoiceRoomHook | null) => void;
}) {
  const voice = useVoiceRoom(channelId);
  const [screenShareQuality, setScreenShareQuality] = useState<ScreenShareQuality>("1080p");
  const avatarByUserId = useMemo(
    () => new Map(members.map((m) => [m.user_id, m.profile.avatar_url])),
    [members],
  );
  useReconnectingSound(voice.reconnecting);
  useScreenShareSound(voice.screenShareEnabled);
  useMuteToggleSound(voice.status === "connected" && !voice.micEnabled);

  // See DmChatView's identical guard for why this can't just push `voice` up
  // unconditionally every render (useVoiceRoom returns a fresh object each
  // time — doing that turned into a continuous re-render loop last time).
  const lastVoiceSigRef = useRef<string>("");
  useEffect(() => {
    const sig = [
      voice.status,
      voice.error,
      voice.reconnecting,
      voice.micEnabled,
      voice.cameraEnabled,
      voice.screenShareEnabled,
      voice.participants
        .map(
          (p) =>
            `${p.identity}:${p.isSpeaking}:${p.micMuted}:${!!p.cameraTrack}:${!!p.screenShareTrack}`,
        )
        .join("|"),
    ].join("~");
    if (sig !== lastVoiceSigRef.current) {
      lastVoiceSigRef.current = sig;
      onVoiceChange?.(voice);
    }
  });
  useEffect(() => {
    return () => onVoiceChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (voice.status === "idle" || voice.status === "error") {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center"
      >
        <div
          className="w-16 h-16 rounded-3xl grid place-items-center text-primary-foreground"
          style={{ backgroundImage: "var(--gradient-dexy)" }}
        >
          <Video className="w-7 h-7" />
        </div>
        <div>
          <h2 className="text-xl font-bold">Sala de voz: #{channelName}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Áudio, câmera e compartilhamento de tela ao vivo.
          </p>
        </div>
        {voice.error && <p className="text-sm text-destructive">{voice.error}</p>}
        <button
          onClick={voice.join}
          className="inline-flex items-center gap-2 rounded-full px-6 py-3 font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:brightness-110"
          style={{ backgroundImage: "var(--gradient-dexy)" }}
        >
          Entrar na sala de voz
        </button>
      </motion.div>
    );
  }

  if (voice.status === "connecting") {
    return (
      <div className="flex-1 grid place-items-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex-1 flex flex-col min-h-0"
    >
      {voice.reconnecting && (
        <div className="mx-4 mt-3 flex items-center justify-center gap-2 rounded-lg bg-secondary px-3 py-1.5 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Reconectando...
        </div>
      )}
      {voice.screenShareEnabled && (
        <ScreenShareBanner
          onSwap={() => voice.toggleScreenShare(screenShareQuality)}
          onStop={voice.stopScreenShare}
        />
      )}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {voice.participants.map((p) => (
            <ParticipantTile
              key={p.identity}
              p={p}
              avatarSrc={avatarFor({
                id: p.identity,
                avatar_url: avatarByUserId.get(p.identity) ?? null,
              })}
              deafened={deafened}
            />
          ))}
        </div>
      </div>
      <div className="shrink-0 flex items-center justify-center flex-wrap gap-2 sm:gap-3 py-4 border-t border-border">
        <ControlButton
          active={voice.micEnabled}
          onClick={voice.toggleMic}
          icon={Mic}
          offIcon={MicOff}
          label="Microfone"
        />
        <ControlButton
          active={voice.cameraEnabled}
          onClick={voice.toggleCamera}
          icon={Video}
          offIcon={VideoOff}
          label="Câmera"
        />
        {!voice.screenShareEnabled && (
          <ScreenShareQualityToggle value={screenShareQuality} onChange={setScreenShareQuality} />
        )}
        <ControlButton
          active={voice.screenShareEnabled}
          onClick={() =>
            voice.screenShareEnabled
              ? voice.stopScreenShare()
              : voice.toggleScreenShare(screenShareQuality)
          }
          icon={MonitorUp}
          offIcon={ScreenShareOff}
          label={voice.screenShareEnabled ? "Parar de compartilhar" : "Compartilhar tela"}
        />
        <button
          onClick={voice.leave}
          title="Sair"
          className="w-11 h-11 rounded-full grid place-items-center bg-destructive text-destructive-foreground hover:brightness-110 transition"
        >
          <LogOut className="w-4.5 h-4.5" />
        </button>
      </div>
    </motion.div>
  );
}
