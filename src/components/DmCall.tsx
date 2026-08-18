import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Track } from "livekit-client";
import {
  AudioLines,
  Loader2,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Monitor,
  MonitorUp,
  Phone,
  PhoneMissed,
  PhoneOff,
  ScreenShareOff,
  Video,
  VideoOff,
} from "lucide-react";
import {
  formatCallDuration,
  type DmCallRow,
  type ParticipantInfo,
  type ScreenShareQuality,
} from "@/lib/livekit";
import { avatarFor } from "@/lib/format";
import { SpeakingAwareAvatar } from "@/components/SpeakingAwareAvatar";
import type { Database } from "@/lib/database.types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

function TrackVideo({
  track,
  muted,
  contain,
}: {
  track: Track | undefined;
  muted?: boolean;
  contain?: boolean;
}) {
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
    <video
      ref={ref}
      muted={muted}
      autoPlay
      playsInline
      className={`w-full h-full ${contain ? "object-contain" : "object-cover"}`}
    />
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
  return (
    <audio
      ref={ref}
      autoPlay
      muted={muted}
      // Audio element optimizations for voice clarity
      playsInline
      crossOrigin="anonymous"
    />
  );
}

// Fullscreens the target container (not just the <video>) so overlays like
// the name/mic badge come along. Tracks fullscreenchange, not just the
// click, so the icon still flips back if the user exits via Esc.
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
  fallbackProfile,
  deafened,
}: {
  p: ParticipantInfo;
  fallbackProfile: Profile;
  deafened?: boolean;
}) {
  const videoTrack = p.screenShareTrack ?? p.cameraTrack;
  const tileRef = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={tileRef}
      className={`group relative aspect-video rounded-2xl overflow-hidden bg-secondary border transition ${
        p.isSpeaking ? "border-primary shadow-[var(--shadow-glow)]" : "border-border"
      }`}
    >
      {!p.isLocal && <TrackAudio track={p.micTrack} muted={deafened} />}
      {!p.isLocal && p.screenShareTrack && (
        <TrackAudio track={p.screenShareAudioTrack} muted={deafened} />
      )}
      {videoTrack ? (
        <>
          <TrackVideo track={videoTrack} muted={p.isLocal} />
          <FullscreenButton targetRef={tileRef} />
        </>
      ) : (
        <div className="w-full h-full grid place-items-center">
          <SpeakingAwareAvatar
            src={avatarFor(fallbackProfile)}
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
      </div>
    </div>
  );
}

// Participant card for the row under a focused screen share — avatar top
// left, name + status stacked below it, mic (and screen-share) indicator on
// the right, a small waveform glyph in the corner and a teal ring around
// the whole card while the person is speaking.
function FloatingParticipantCard({
  p,
  fallbackProfile,
  sharing,
  deafened,
}: {
  p: ParticipantInfo;
  fallbackProfile: Profile;
  sharing: boolean;
  deafened?: boolean;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ type: "spring", stiffness: 300, damping: 26 }}
      className={`relative w-44 h-36 shrink-0 flex flex-col justify-between rounded-2xl border bg-secondary/70 p-3 transition-colors ${
        p.isSpeaking ? "border-primary shadow-(--shadow-glow)" : "border-white/10"
      }`}
    >
      {!p.isLocal && <TrackAudio track={p.micTrack} muted={deafened} />}
      {p.isSpeaking && <AudioLines className="absolute top-3 right-3 w-3.5 h-3.5 text-primary" />}
      {p.cameraTrack ? (
        <div className="w-12 h-12 rounded-full overflow-hidden">
          <TrackVideo track={p.cameraTrack} muted={p.isLocal} />
        </div>
      ) : (
        <SpeakingAwareAvatar
          src={avatarFor(fallbackProfile)}
          isSpeaking={p.isSpeaking}
          className="w-12 h-12 rounded-full object-cover"
        />
      )}
      <div className="mt-2.5 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground truncate">{p.name}</div>
          <div
            className={`text-xs truncate ${p.isSpeaking ? "text-primary" : "text-muted-foreground"}`}
          >
            {p.isLocal ? "Você" : "Online"}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {sharing && <Monitor className="w-3.5 h-3.5 text-primary" />}
          {p.micMuted ? (
            <MicOff className="w-3.5 h-3.5 text-destructive" />
          ) : (
            <Mic className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </div>
      </div>
    </motion.div>
  );
}

// The focused view when anyone in the call (local or remote) is sharing
// their screen — the share is the actual content (16:9, contain, never
// touched/cropped), Dexy's own UI (participants, controls) floats around
// and on top of it, never inside the captured frame.
function ScreenShareStage({
  sharer,
  participants,
  profileFor,
  deafened,
  onSwap,
  onStop,
}: {
  sharer: ParticipantInfo;
  participants: ParticipantInfo[];
  profileFor: (identity: string) => Profile;
  deafened?: boolean;
  onSwap: () => void;
  onStop: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="flex-1 min-h-0 flex flex-col gap-3"
    >
      {/* Bar 1: sharing status. */}
      <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm shrink-0">
        <MonitorUp className="w-4 h-4 text-primary shrink-0" />
        <span className="flex-1 min-w-0 truncate">
          {sharer.isLocal
            ? "Você está compartilhando sua tela"
            : `${sharer.name} está compartilhando a tela`}
        </span>
        {sharer.isLocal && (
          <>
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
          </>
        )}
      </div>

      {/* Bar 2: the capture itself — takes whatever space is left over
          after the status bar and the participant row below claim theirs
          (flex-1 + min-h-0, so it shrinks to fit rather than push the
          participants off-screen). A real 16:9 box, object-contain, never
          stretched/cropped, nothing of Dexy's own UI drawn inside it. */}
      <div
        ref={stageRef}
        className="group relative flex-1 min-h-0 rounded-2xl p-3 overflow-hidden"
        style={{ backgroundColor: "#050A10" }}
      >
        <div className="w-full h-full overflow-hidden">
          <TrackVideo track={sharer.screenShareTrack} muted={sharer.isLocal} contain />
        </div>
        {/* Tab/system audio, when the sharer's browser includes it — a
            separate published source from both the video and their
            microphone, so it needs its own element or it's captured by
            LiveKit but never actually played for anyone. Never rendered for
            the local sharer themselves (no self-echo of your own shared
            audio); respects deafen exactly like the mic track does. */}
        {!sharer.isLocal && <TrackAudio track={sharer.screenShareAudioTrack} muted={deafened} />}
        <FullscreenButton targetRef={stageRef} />
      </div>

      {/* Bar 3: participants — their own fixed-height section, physically
          separate from and always below the capture, never overlapping it.
          Fixed-width cards (never stretched to fill the row — a single
          participant shouldn't balloon to full width) centered as a group;
          wraps onto more rows once there's no room for everyone in one.
          AnimatePresence + layout on each card animates the reflow when
          someone joins/leaves instead of snapping. */}
      <div className="shrink-0 flex flex-wrap items-center justify-center gap-2">
        <AnimatePresence initial={false}>
          {participants.map((p) => (
            <FloatingParticipantCard
              key={p.identity}
              p={p}
              fallbackProfile={profileFor(p.identity)}
              sharing={p.identity === sharer.identity}
              deafened={deafened}
            />
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
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
      className={`w-10 h-10 rounded-full grid place-items-center transition ${
        active
          ? "bg-secondary text-foreground hover:bg-secondary/70"
          : "bg-destructive/15 text-destructive hover:bg-destructive/25"
      }`}
    >
      <Displayed className="w-4 h-4" />
    </button>
  );
}

export function IncomingCallBanner({
  callerProfile,
  kind,
  onAccept,
  onDecline,
}: {
  callerProfile: Profile;
  kind: string;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      className="mx-3 sm:mx-6 mt-3 flex items-center gap-3 rounded-xl border border-primary/40 bg-card px-4 py-3"
      style={{ boxShadow: "var(--shadow-glow)" }}
    >
      <img
        src={avatarFor(callerProfile)}
        alt=""
        className="w-10 h-10 rounded-full object-cover shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold truncate">{callerProfile.name}</p>
        <p className="text-xs text-muted-foreground">
          {kind === "video" ? "Chamada de vídeo recebida" : "Chamada de voz recebida"}
        </p>
      </div>
      <button
        onClick={onDecline}
        className="w-9 h-9 rounded-full grid place-items-center bg-destructive text-destructive-foreground hover:brightness-110 transition"
      >
        <PhoneOff className="w-4 h-4" />
      </button>
      <button
        onClick={onAccept}
        className="w-9 h-9 rounded-full grid place-items-center text-primary-foreground hover:brightness-110 transition"
        style={{ backgroundImage: "var(--gradient-dexy)" }}
      >
        <Phone className="w-4 h-4" />
      </button>
    </motion.div>
  );
}

function RingingDots() {
  return (
    <span className="inline-flex gap-0.5 ml-1">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="w-1 h-1 rounded-full bg-muted-foreground"
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18, ease: "easeInOut" }}
        />
      ))}
    </span>
  );
}

export function OutgoingCallBanner({
  otherProfile,
  onCancel,
}: {
  otherProfile: Profile;
  onCancel: () => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      className="mx-3 sm:mx-6 mt-3 flex items-center gap-3 rounded-xl border border-primary/40 bg-card px-4 py-3"
      style={{ boxShadow: "var(--shadow-glow)" }}
    >
      <div className="relative shrink-0 w-10 h-10 grid place-items-center">
        {/* A single ring that breathes in and out (repeatType "mirror") rather
            than an expanding-then-resetting ping — a hard reset from opacity 0
            back to its start value reads as a flicker, and this way the ring
            never grows past ~35% larger than the avatar, so it stays inside
            the card's own padding instead of poking out over its border. */}
        <motion.span
          className="absolute inset-0 rounded-full border-2 border-primary"
          initial={{ scale: 1, opacity: 0.5 }}
          animate={{ scale: 1.35, opacity: 0 }}
          transition={{ duration: 1.4, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" }}
        />
        <img
          src={avatarFor(otherProfile)}
          alt=""
          className="relative w-10 h-10 rounded-full object-cover"
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold truncate">Chamando {otherProfile.name}...</p>
        <p className="text-xs text-muted-foreground flex items-center">
          Esperando atender
          <RingingDots />
        </p>
      </div>
      <motion.button
        onClick={onCancel}
        whileTap={{ scale: 0.9 }}
        className="w-9 h-9 rounded-full grid place-items-center bg-destructive text-destructive-foreground hover:brightness-110 transition"
      >
        <PhoneOff className="w-4 h-4" />
      </motion.button>
    </motion.div>
  );
}

export function ActiveCallView({
  myProfile,
  otherProfile,
  participants,
  connecting,
  reconnecting,
  micEnabled,
  cameraEnabled,
  screenShareEnabled,
  onToggleMic,
  onToggleCamera,
  onToggleScreenShare,
  onStopScreenShare,
  onHangup,
  deafened,
  fillAvailableHeight,
}: {
  myProfile: Profile;
  otherProfile: Profile;
  participants: ParticipantInfo[];
  connecting: boolean;
  reconnecting?: boolean;
  micEnabled: boolean;
  cameraEnabled: boolean;
  screenShareEnabled: boolean;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: (quality?: ScreenShareQuality) => void;
  onStopScreenShare: () => void;
  onHangup: () => void;
  deafened?: boolean;
  // True while someone is screen-sharing: the card should consume whatever
  // vertical space the flex column above it actually has left (computed by
  // the browser, not guessed via vh) so the video shrinks to fit instead of
  // pushing controls off-screen or forcing a scrollbar.
  fillAvailableHeight?: boolean;
}) {
  const [screenShareQuality, setScreenShareQuality] = useState<ScreenShareQuality>("1080p");
  const profileFor = (identity: string) => (identity === myProfile.id ? myProfile : otherProfile);
  const sharingParticipant = participants.find((p) => p.screenShareTrack);
  const hasVideo = participants.some((p) => p.cameraTrack);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={`relative mx-3 sm:mx-6 mt-3 rounded-2xl border border-border bg-card/60 backdrop-blur-sm p-3 ${
        fillAvailableHeight ? "flex-1 min-h-0 flex flex-col" : ""
      }`}
    >
      {reconnecting && !connecting && (
        <div className="absolute inset-x-3 top-3 z-10 flex items-center justify-center gap-2 rounded-lg bg-background/90 backdrop-blur px-3 py-1.5 text-xs text-muted-foreground border border-border">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Reconectando...
        </div>
      )}
      <AnimatePresence mode="wait">
        {connecting ? (
          <div key="connecting" className="py-10 grid place-items-center">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : sharingParticipant ? (
          <ScreenShareStage
            key="sharing"
            sharer={sharingParticipant}
            participants={participants}
            profileFor={profileFor}
            deafened={deafened}
            onSwap={() => onToggleScreenShare(screenShareQuality)}
            onStop={onStopScreenShare}
          />
        ) : hasVideo ? (
          <div key="video" className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {participants.map((p) => (
              <ParticipantTile
                key={p.identity}
                p={p}
                fallbackProfile={profileFor(p.identity)}
                deafened={deafened}
              />
            ))}
          </div>
        ) : (
          <div
            key="voice"
            className="flex items-center justify-center flex-wrap gap-x-10 gap-y-6 py-10"
          >
            {participants.map((p) => (
              <motion.div
                key={p.identity}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className="flex flex-col items-center gap-2.5"
              >
                {!p.isLocal && <TrackAudio track={p.micTrack} muted={deafened} />}
                <div className="relative">
                  {p.isSpeaking && (
                    <span className="absolute -inset-1.5 rounded-full bg-primary/30 blur-md animate-pulse" />
                  )}
                  <SpeakingAwareAvatar
                    src={avatarFor(profileFor(p.identity))}
                    isSpeaking={p.isSpeaking}
                    className={`relative w-20 h-20 rounded-full object-cover ring-4 transition ${
                      p.isSpeaking ? "ring-primary" : "ring-emerald-500/80"
                    }`}
                  />
                  {p.micMuted && (
                    <span className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-secondary border-2 border-card grid place-items-center">
                      <MicOff className="w-3 h-3 text-destructive" />
                    </span>
                  )}
                </div>
                <span className="text-sm font-medium truncate max-w-24">{p.name}</span>
              </motion.div>
            ))}
          </div>
        )}
      </AnimatePresence>
      <div className="flex items-center justify-center flex-wrap gap-2 sm:gap-3 pt-3">
        <ControlButton
          active={micEnabled}
          onClick={onToggleMic}
          icon={Mic}
          offIcon={MicOff}
          label="Microfone"
        />
        <ControlButton
          active={cameraEnabled}
          onClick={onToggleCamera}
          icon={Video}
          offIcon={VideoOff}
          label="Câmera"
        />
        {!screenShareEnabled && (
          <ScreenShareQualityToggle value={screenShareQuality} onChange={setScreenShareQuality} />
        )}
        <ControlButton
          active={screenShareEnabled}
          onClick={() =>
            screenShareEnabled ? onStopScreenShare() : onToggleScreenShare(screenShareQuality)
          }
          icon={MonitorUp}
          offIcon={ScreenShareOff}
          label={screenShareEnabled ? "Parar de compartilhar" : "Compartilhar tela"}
        />
        <button
          onClick={onHangup}
          title="Encerrar"
          className="w-10 h-10 rounded-full grid place-items-center bg-destructive text-destructive-foreground hover:brightness-110 transition"
        >
          <PhoneOff className="w-4 h-4" />
        </button>
      </div>
    </motion.div>
  );
}

// Groups of consecutive call-log entries in the timeline are prefixed with
// this, matching the same visual language as the "Hoje"/"Ontem" date pills.
export function CallGroupDivider() {
  return (
    <div className="flex items-center gap-3 py-1 text-[11px] uppercase tracking-wider text-muted-foreground">
      <div className="flex-1 h-px bg-white/10" />
      <span>Chamadas</span>
      <div className="flex-1 h-px bg-white/10" />
    </div>
  );
}

export function CallLogEntry({
  call,
  myId,
  myProfile,
  otherProfile,
}: {
  call: DmCallRow;
  myId: string;
  myProfile: Profile;
  otherProfile: Profile;
}) {
  const iAmCaller = call.started_by === myId;
  const caller = iAmCaller ? myProfile : otherProfile;
  const answered = !!call.answered_at;
  const timestamp = new Date(call.ended_at ?? call.started_at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const durationMs = call.ended_at
    ? new Date(call.ended_at).getTime() - new Date(call.started_at).getTime()
    : 0;

  return (
    <div className="w-full flex items-center gap-3 rounded-xl border border-white/10 bg-card px-4 py-2.5 shadow-md">
      <div
        className={`w-8 h-8 rounded-full grid place-items-center shrink-0 ${
          answered ? "bg-primary/15 text-primary" : "bg-destructive/15 text-destructive"
        }`}
      >
        {answered ? <Phone className="w-4 h-4" /> : <PhoneMissed className="w-4 h-4" />}
      </div>
      <span className="flex-1 min-w-0 text-sm text-foreground truncate">
        {answered
          ? `${caller.name} iniciou uma chamada que durou ${formatCallDuration(durationMs)}`
          : iAmCaller
            ? "Chamada não atendida"
            : `Você perdeu uma chamada de ${caller.name}`}
      </span>
      <span className="text-xs text-muted-foreground shrink-0">{timestamp}</span>
    </div>
  );
}
