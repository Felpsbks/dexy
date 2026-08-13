import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Calendar,
  Copy,
  Ban,
  Check,
  X,
  Radio,
  MonitorUp,
  ScreenShareOff,
  HeadphoneOff,
  Headphones,
  PhoneOff,
  MicOff,
} from "lucide-react";
import {
  avatarFor,
  formatMemberSince,
  resolvePresenceStatus,
  statusColor,
  statusLabel,
  statusRing,
  type UserStatus,
} from "@/lib/format";
import { useIsUserOnline } from "@/lib/presence";
import { useBlockFriendship } from "@/lib/queries";
import { formatCallTimer, useCallElapsedMs, type DmCallHook } from "@/lib/livekit";
import { SpeakingAwareAvatar } from "@/components/SpeakingAwareAvatar";
import type { Database } from "@/lib/database.types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export function DmProfilePanel({
  profile,
  myId,
  myProfile,
  call,
  deafened,
  onToggleDeafen,
  onClose,
}: {
  profile: Profile;
  myId?: string;
  myProfile?: Profile;
  call?: DmCallHook | null;
  deafened?: boolean;
  onToggleDeafen?: () => void;
  onClose?: () => void;
}) {
  const isOnline = useIsUserOnline(profile.id);
  const status = resolvePresenceStatus(profile.status as UserStatus, isOnline);
  const blockFriendship = useBlockFriendship(myId);
  const [copied, setCopied] = useState(false);

  const copyProfileLink = async () => {
    await navigator.clipboard.writeText(`@${profile.handle}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleBlock = () => {
    if (!myId) return;
    if (
      !window.confirm(`Bloquear ${profile.name}? Isso remove dos amigos e impede novas conversas.`)
    )
      return;
    blockFriendship.mutate(profile.id);
  };

  const inCall = !!call && (call.status === "active" || call.status === "connecting");
  const callElapsedMs = useCallElapsedMs(call?.call?.answered_at);

  if (inCall && call) {
    return (
      <CallSidePanel
        profile={profile}
        myProfile={myProfile}
        call={call}
        elapsedMs={callElapsedMs}
        deafened={!!deafened}
        onToggleDeafen={onToggleDeafen}
      />
    );
  }

  return (
    <motion.aside
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ duration: 0.2, ease: "easeInOut" }}
      className="hidden lg:flex w-72 shrink-0 flex-col bg-sidebar rounded-[18px] overflow-y-auto"
    >
      <div className="relative">
        <div
          className="h-24 w-full"
          style={{
            backgroundImage: profile.banner_url
              ? `linear-gradient(135deg, oklch(0.787 0.134 184.5 / 0.55), oklch(0.83 0.139 184.4 / 0.4)), url(${profile.banner_url})`
              : "var(--gradient-dexy)",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-1.5 rounded-full bg-background/70 backdrop-blur hover:bg-background transition"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <div className="absolute -bottom-10 left-5">
          <div className="relative">
            <img
              src={avatarFor(profile)}
              alt=""
              className={`w-20 h-20 rounded-full border-4 border-card object-cover bg-card ${statusRing[status]}`}
            />
            <span
              className={`absolute bottom-1 right-1 w-4 h-4 rounded-full border-2 border-card ${statusColor[status]}`}
            />
          </div>
        </div>
      </div>

      <div className="pt-12 px-5 pb-6 space-y-4">
        <div>
          <h3 className="text-lg font-bold truncate">{profile.name}</h3>
          <p className="text-sm text-muted-foreground truncate">@{profile.handle}</p>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <span className={`w-2 h-2 rounded-full ${statusColor[status]}`} />
          <span className="text-muted-foreground">{statusLabel[status]}</span>
        </div>

        {profile.bio && (
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
              Sobre mim
            </div>
            <p className="text-sm leading-relaxed break-words">{profile.bio}</p>
          </div>
        )}

        <div className="h-px bg-linear-to-r from-transparent via-border to-transparent" />

        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
            Membro desde
          </div>
          <p className="text-sm flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
            {formatMemberSince(profile.created_at)}
          </p>
        </div>

        <div className="h-px bg-linear-to-r from-transparent via-border to-transparent" />

        <div className="space-y-1.5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
            Ações rápidas
          </div>
          <button
            onClick={copyProfileLink}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm bg-white/5 hover:bg-white/10 hover:-translate-y-0.5 transition duration-200"
          >
            {copied ? (
              <Check className="w-4 h-4 text-primary" />
            ) : (
              <Copy className="w-4 h-4 text-muted-foreground" />
            )}
            {copied ? "Copiado!" : "Copiar link do perfil"}
          </button>
          {myId && (
            <button
              onClick={handleBlock}
              disabled={blockFriendship.isPending}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-destructive bg-destructive/5 hover:bg-destructive/10 hover:-translate-y-0.5 transition duration-200 disabled:opacity-50"
            >
              <Ban className="w-4 h-4" />
              Bloquear
            </button>
          )}
        </div>
      </div>
    </motion.aside>
  );
}

// The right panel while a call is active — swapped in for the normal profile
// panel. "Convidar pessoas" from the reference mockup isn't here: DMs are
// strictly 1:1 in this app (no group conversations), so there's no one to
// invite into an existing call — adding that button would be UI with nothing
// real behind it.
function CallSidePanel({
  profile,
  myProfile,
  call,
  elapsedMs,
  deafened,
  onToggleDeafen,
}: {
  profile: Profile;
  myProfile?: Profile;
  call: DmCallHook;
  elapsedMs: number;
  deafened: boolean;
  onToggleDeafen?: () => void;
}) {
  const profileFor = (identity: string) =>
    (identity === myProfile?.id ? myProfile : profile) ?? profile;
  // Whoever you're on a call with is, by definition, currently connected —
  // no need to resolve against presence here (unlike the idle profile
  // panel above, which can show someone who isn't in a call at all).

  return (
    <motion.aside
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ duration: 0.2, ease: "easeInOut" }}
      className="hidden lg:flex w-72 shrink-0 flex-col bg-sidebar rounded-[18px] overflow-y-auto"
    >
      <div
        className="h-16 px-5 flex items-center gap-2 text-sm font-semibold shrink-0"
        style={{ backgroundImage: "var(--gradient-dexy)", color: "oklch(0.12 0.02 220)" }}
      >
        <Radio className="w-4 h-4" />
        Em chamada
      </div>

      <div className="px-5 pt-4">
        <div className="flex items-center gap-3">
          <img
            src={avatarFor(profile)}
            alt=""
            className={`w-12 h-12 rounded-full object-cover ${statusRing[profile.status as UserStatus]}`}
          />
          <div className="min-w-0">
            <div className="font-bold truncate">{profile.name}</div>
            <div className="text-xs text-primary flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              {call.status === "connecting" ? "Conectando…" : formatCallTimer(elapsedMs)}
            </div>
          </div>
        </div>
      </div>

      <div className="h-px bg-linear-to-r from-transparent via-border to-transparent my-4 mx-5" />

      <div className="px-5">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
          Participantes — {call.participants.length}
        </div>
        <div className="space-y-1">
          <AnimatePresence initial={false}>
            {call.participants.map((p) => {
              const pProfile = profileFor(p.identity);
              return (
                <motion.div
                  key={p.identity}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className={`flex items-center gap-2.5 px-2 py-1.5 rounded-lg transition ${
                    p.isSpeaking ? "bg-primary/10" : ""
                  }`}
                >
                  <div className="relative shrink-0">
                    <SpeakingAwareAvatar
                      src={avatarFor(pProfile)}
                      isSpeaking={p.isSpeaking}
                      className={`w-8 h-8 rounded-full object-cover transition ${
                        p.isSpeaking
                          ? "ring-2 ring-primary shadow-(--shadow-glow)"
                          : "ring-2 ring-transparent"
                      }`}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{p.name}</div>
                    <div className="text-[11px] text-muted-foreground">Online</div>
                  </div>
                  {p.micMuted && <MicOff className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>

      <div className="h-px bg-linear-to-r from-transparent via-border to-transparent my-4 mx-5" />

      <div className="px-5 pb-6 space-y-1.5">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
          Ações na chamada
        </div>
        <button
          onClick={() => (call.screenShareEnabled ? call.stopScreenShare() : call.toggleScreenShare())}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm bg-white/5 hover:bg-white/10 hover:-translate-y-0.5 transition duration-200"
        >
          {call.screenShareEnabled ? (
            <ScreenShareOff className="w-4 h-4 text-muted-foreground" />
          ) : (
            <MonitorUp className="w-4 h-4 text-muted-foreground" />
          )}
          {call.screenShareEnabled ? "Parar de compartilhar" : "Compartilhar tela"}
        </button>
        {onToggleDeafen && (
          <button
            onClick={onToggleDeafen}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm hover:-translate-y-0.5 transition duration-200 ${
              deafened
                ? "text-destructive bg-destructive/10 hover:bg-destructive/15"
                : "bg-white/5 hover:bg-white/10"
            }`}
          >
            {deafened ? (
              <HeadphoneOff className="w-4 h-4" />
            ) : (
              <Headphones className="w-4 h-4 text-muted-foreground" />
            )}
            {deafened ? "Reativar áudio" : "Silenciar todos"}
          </button>
        )}
        <button
          onClick={call.hangup}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-destructive bg-destructive/10 hover:bg-destructive/15 hover:-translate-y-0.5 transition duration-200"
        >
          <PhoneOff className="w-4 h-4" />
          Sair da chamada
        </button>
      </div>
    </motion.aside>
  );
}
