import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import type { Track } from "livekit-client";
import {
  Loader2,
  LogOut,
  Mic,
  MicOff,
  MonitorUp,
  ScreenShareOff,
  Video,
  VideoOff,
} from "lucide-react";
import { useVoiceRoom, type ParticipantInfo } from "@/lib/livekit";

function avatarFor(identity: string) {
  return `https://api.dicebear.com/9.x/glass/svg?seed=${identity}`;
}

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
  return <video ref={ref} muted={muted} autoPlay playsInline className="w-full h-full object-cover" />;
}

function TrackAudio({ track }: { track: Track | undefined }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !track) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return <audio ref={ref} autoPlay />;
}

function ParticipantTile({ p }: { p: ParticipantInfo }) {
  const videoTrack = p.screenShareTrack ?? p.cameraTrack;
  return (
    <div
      className={`relative aspect-video rounded-xl overflow-hidden bg-card border transition ${
        p.isSpeaking ? "border-primary shadow-[var(--shadow-glow)]" : "border-border"
      }`}
    >
      {!p.isLocal && <TrackAudio track={p.micTrack} />}
      {videoTrack ? (
        <TrackVideo track={videoTrack} muted={p.isLocal} />
      ) : (
        <div className="w-full h-full grid place-items-center">
          <img
            src={avatarFor(p.identity)}
            alt=""
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
        active ? "bg-secondary text-foreground hover:bg-secondary/70" : "bg-destructive/15 text-destructive hover:bg-destructive/25"
      }`}
    >
      <Displayed className="w-4.5 h-4.5" />
    </button>
  );
}

export function VoiceRoomView({ channelId, channelName }: { channelId: string; channelName: string }) {
  const voice = useVoiceRoom(channelId);

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
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {voice.participants.map((p) => (
            <ParticipantTile key={p.identity} p={p} />
          ))}
        </div>
      </div>
      <div className="shrink-0 flex items-center justify-center gap-3 py-4 border-t border-border">
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
        <ControlButton
          active={voice.screenShareEnabled}
          onClick={voice.toggleScreenShare}
          icon={MonitorUp}
          offIcon={ScreenShareOff}
          label="Compartilhar tela"
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
