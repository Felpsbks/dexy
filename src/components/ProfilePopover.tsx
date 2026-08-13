import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  Ban,
  Calendar,
  Check,
  ChevronRight,
  Clock,
  Copy,
  LogOut,
  MessageCircle,
  Pencil,
  UserCheck,
  UserPlus,
  UserX,
  X,
} from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
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
import { resolveBannerBackground, OBJECT_POSITION, type BannerPosition } from "@/lib/profileMedia";
import {
  useBlockFriendship,
  useFriendships,
  useGetOrCreateDm,
  useProfileStats,
  useRespondFriendRequest,
  useSendFriendRequest,
  useUpdateProfile,
} from "@/lib/queries";
import type { Database } from "@/lib/database.types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

type PopoverTarget = { profile: Profile; anchor: Element };

const ProfilePopoverContext = createContext<{
  open: (profile: Profile, anchor: Element) => void;
} | null>(null);

// One place to click an avatar/name from anywhere in the app: open(profile,
// el) either shows that user's card anchored to `el`, replaces whatever
// card is currently open, or — if it's the same user again — closes it.
export function useProfilePopover() {
  const ctx = useContext(ProfilePopoverContext);
  if (!ctx) throw new Error("useProfilePopover must be used within a ProfilePopoverProvider");
  return ctx;
}

export function ProfilePopoverProvider({
  children,
  myId,
  onEditProfile,
  onMessage,
  onSignOut,
}: {
  children: ReactNode;
  myId: string | undefined;
  onEditProfile: () => void;
  onMessage: (profile: Profile) => void;
  onSignOut?: () => void;
}) {
  const [target, setTarget] = useState<PopoverTarget | null>(null);
  const anchorRef = useRef<Element | null>(null);

  const open = useCallback((profile: Profile, anchor: Element) => {
    setTarget((prev) => {
      if (prev && prev.profile.id === profile.id) {
        anchorRef.current = null;
        return null;
      }
      anchorRef.current = anchor;
      return { profile, anchor };
    });
  }, []);

  const close = useCallback(() => {
    anchorRef.current = null;
    setTarget(null);
  }, []);

  return (
    <ProfilePopoverContext.Provider value={{ open }}>
      {children}
      {/* Single shared popover instance for the whole app — every avatar/name
          click just calls open(profile, element) above instead of owning its
          own <Popover>, so only one card can ever be on screen and clicking
          a different user swaps it instead of stacking a second one. */}
      <Popover open={!!target} onOpenChange={(o) => !o && close()}>
        <PopoverAnchor virtualRef={anchorRef} />
        {target && (
          <PopoverContent
            align="start"
            sideOffset={8}
            collisionPadding={12}
            className="w-80 p-0 overflow-hidden rounded-2xl border-border/80 flex flex-col"
            style={{ maxHeight: "var(--radix-popover-content-available-height)" }}
            // Clicking a *different* profile trigger while a card is already
            // open is, by Radix's default behavior, an "outside" pointerdown
            // that dismisses this card first — the new trigger's own onClick
            // then never fires on that same click (needs a second click).
            // Every trigger carries data-profile-trigger, so we can tell
            // Radix to skip its own dismiss handling for those specifically
            // and let the trigger's onClick (open()) be the single source of
            // truth — it already knows how to both switch and toggle-close.
            onInteractOutside={(e) => {
              if ((e.target as HTMLElement | null)?.closest("[data-profile-trigger]")) {
                e.preventDefault();
              }
            }}
          >
            {/* Radix picks whichever side (top/bottom) has more room and
                flips automatically, but a card this tall still won't always
                fit when anchored near the middle of a short viewport — this
                scrolls internally instead of spilling past the screen edge. */}
            <div className="overflow-y-auto">
              <ProfilePopoverCard
                profile={target.profile}
                myId={myId}
                onEditProfile={() => {
                  close();
                  onEditProfile();
                }}
                onMessage={() => {
                  close();
                  onMessage(target.profile);
                }}
                onSignOut={onSignOut ? () => {
                  close();
                  onSignOut();
                } : undefined}
              />
            </div>
          </PopoverContent>
        )}
      </Popover>
    </ProfilePopoverContext.Provider>
  );
}

const STATUS_OPTIONS: { value: UserStatus; dot: string }[] = [
  { value: "online", dot: "🟢" },
  { value: "idle", dot: "🟡" },
  { value: "dnd", dot: "🔴" },
  { value: "offline", dot: "⚫" },
];

function ProfilePopoverCard({
  profile,
  myId,
  onEditProfile,
  onMessage,
  onSignOut,
}: {
  profile: Profile;
  myId: string | undefined;
  onEditProfile: () => void;
  onMessage: () => void;
  onSignOut?: () => void;
}) {
  const isSelf = !!myId && profile.id === myId;
  // manualStatus is the raw persisted preference (what the StatusMenu below
  // lets you pick and must show as currently checked); displayStatus folds
  // in real connection presence and is what the avatar ring/dot renders —
  // for isSelf these are always the same value, since viewing your own card
  // means you're connected.
  const manualStatus = profile.status as UserStatus;
  const isOnline = useIsUserOnline(profile.id);
  const displayStatus = resolvePresenceStatus(manualStatus, isOnline);
  const { data: stats } = useProfileStats(profile.id);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyId = async () => {
    await navigator.clipboard.writeText(profile.id);
    setCopied(true);
    toast.success("ID copiado para a área de transferência.");
    setTimeout(() => setCopied(false), 1500);
  };

  const banner = resolveBannerBackground(profile.banner_url, profile.banner_color);
  const hasBanner = !!banner.backgroundImage || !!banner.backgroundColor;
  const overlay = profile.banner_overlay ?? 0;
  const position = (profile.banner_position as BannerPosition) || "center";

  return (
    <div className="bg-card">
      <div
        className="relative h-20"
        style={{
          ...banner,
          backgroundSize: "cover",
          backgroundPosition: OBJECT_POSITION[position],
        }}
      >
        {!hasBanner && <div className="absolute inset-0" style={{ backgroundImage: "var(--gradient-dexy)" }} />}
        {overlay > 0 && <div className="absolute inset-0 bg-black" style={{ opacity: overlay / 100 }} />}
      </div>

      <div className="px-4 pb-4">
        <div className="relative -mt-9 mb-2">
          <div className="relative inline-block">
            <img
              src={avatarFor(profile)}
              alt=""
              className={`w-18 h-18 rounded-full border-4 border-card object-cover bg-card ${statusRing[displayStatus]}`}
            />
            <span
              className={`absolute bottom-1 right-1 w-4 h-4 rounded-full border-2 border-card ${statusColor[displayStatus]}`}
            />
          </div>
        </div>

        <h3 className="text-base font-bold truncate">{profile.name}</h3>
        <p className="text-sm text-muted-foreground truncate">@{profile.handle}</p>

        {profile.bio && (
          <p className="mt-2.5 text-sm leading-relaxed wrap-break-word whitespace-pre-wrap">{profile.bio}</p>
        )}

        <div className="mt-3 grid grid-cols-4 gap-1 rounded-xl bg-secondary/40 py-2">
          {(
            [
              ["Mensagens", stats?.messages],
              ["Reações", stats?.reactions],
              ["Amigos", stats?.friends],
              ["Grupos", stats?.servers],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="text-center">
              <div className="text-sm font-bold tabular-nums">{value ?? "–"}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        <div className="mt-2.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Calendar className="w-3.5 h-3.5" />
          Membro desde {formatMemberSince(profile.created_at)}
        </div>

        <div className="h-px bg-linear-to-r from-transparent via-border to-transparent my-3" />

        <div className="space-y-1">
          {isSelf ? (
            <>
              <ActionRow icon={Pencil} label="Editar perfil" onClick={onEditProfile} />
              <div className="relative">
                <ActionRow
                  icon={() => <span className="text-sm leading-none w-4 text-center">{STATUS_OPTIONS.find((s) => s.value === manualStatus)?.dot}</span>}
                  label="Status"
                  trailing={
                    <span className="flex items-center gap-1 text-muted-foreground">
                      {statusLabel[manualStatus]}
                      <ChevronRight className="w-3.5 h-3.5" />
                    </span>
                  }
                  onClick={() => setStatusMenuOpen((v) => !v)}
                />
                {statusMenuOpen && myId && (
                  <StatusMenu userId={myId} current={manualStatus} onDone={() => setStatusMenuOpen(false)} />
                )}
              </div>
              {onSignOut && (
                <>
                  <div className="my-1.5 border-t border-border/60" />
                  <ActionRow icon={LogOut} label="Sair" onClick={onSignOut} destructive />
                </>
              )}
            </>
          ) : (
            <>
              <ActionRow icon={MessageCircle} label="Mensagem" onClick={onMessage} />
              {myId && <FriendActionRow myId={myId} otherProfile={profile} />}
            </>
          )}
        </div>

        {/* The UUID is a technical/API-level identifier, not the public
            identity (that's name + @handle above) -- kept available for the
            rare case someone actually needs it (support requests, bug
            reports), but deliberately understated instead of sitting next
            to "Mensagem"/"Adicionar amigo" as if it were equally relevant. */}
        <button
          onClick={copyId}
          className="mt-2 text-[11px] text-muted-foreground/70 hover:text-muted-foreground transition flex items-center gap-1"
        >
          {copied ? <Check className="w-3 h-3 text-primary" /> : <Copy className="w-3 h-3" />}
          {copied ? "ID técnico copiado" : "ID técnico · Copiar"}
        </button>
      </div>
    </div>
  );
}

// Compact inline replacement for the status row while it's open — same
// pattern as the darkness/theme pickers in ProfileEditor (a small panel that
// takes over the row's spot instead of a separate floating menu, so it can't
// get clipped by the popover's own edges).
function StatusMenu({
  userId,
  current,
  onDone,
}: {
  userId: string;
  current: UserStatus;
  onDone: () => void;
}) {
  const updateProfile = useUpdateProfile(userId);
  return (
    <div className="mt-1 mb-1 rounded-xl border border-border overflow-hidden">
      {STATUS_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => {
            if (opt.value !== current) updateProfile.mutate({ status: opt.value });
            onDone();
          }}
          className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition ${
            opt.value === current ? "bg-primary/10 text-foreground" : "hover:bg-secondary text-muted-foreground hover:text-foreground"
          }`}
        >
          <span className="text-sm leading-none">{opt.dot}</span>
          <span>{statusLabel[opt.value]}</span>
          {opt.value === current && <Check className="w-3.5 h-3.5 ml-auto text-primary" />}
        </button>
      ))}
    </div>
  );
}

// Derives the real relationship from the same friendships table/hooks used
// everywhere else in the app (sidebar add-friend form, pending-requests
// list) — no separate friendship system, just a different view onto it.
function FriendActionRow({ myId, otherProfile }: { myId: string; otherProfile: Profile }) {
  const { data: friendships = [] } = useFriendships(myId);
  const sendRequest = useSendFriendRequest(myId);
  const respond = useRespondFriendRequest(myId);
  const blockFriendship = useBlockFriendship(myId);

  const row = friendships.find(
    (f) => (f.user_id === myId && f.friend_id === otherProfile.id) || (f.user_id === otherProfile.id && f.friend_id === myId),
  );

  if (row?.status === "blocked") {
    return <ActionRow icon={Ban} label="Bloqueado" onClick={() => {}} disabled destructive />;
  }
  if (row?.status === "accepted") {
    return (
      <>
        <ActionRow icon={UserCheck} label="Amigos" onClick={() => {}} disabled tone="success" />
        <ActionRow
          icon={UserX}
          label="Bloquear"
          onClick={() => blockFriendship.mutate(otherProfile.id)}
          destructive
        />
      </>
    );
  }
  if (row?.status === "pending" && row.user_id === myId) {
    return <ActionRow icon={Clock} label="Convite enviado" onClick={() => {}} disabled tone="warning" />;
  }
  if (row?.status === "pending" && row.user_id === otherProfile.id) {
    return (
      <>
        <div className="px-3 pt-1 pb-0.5 text-[11px] text-muted-foreground">Convite recebido</div>
        <ActionRow
          icon={UserCheck}
          label="Aceitar"
          tone="success"
          onClick={() => respond.mutate({ otherUserId: otherProfile.id, action: "accept" })}
          pending={respond.isPending}
        />
        <ActionRow
          icon={X}
          label="Recusar"
          destructive
          onClick={() => respond.mutate({ otherUserId: otherProfile.id, action: "remove" })}
          pending={respond.isPending}
        />
      </>
    );
  }
  const handleAddFriend = async () => {
    try {
      const outcome = await sendRequest.mutateAsync(otherProfile.handle);
      toast.success(outcome === "auto_accepted" ? "Convite aceito ✓" : "Convite enviado ✓");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível concluir o envio agora. Tente novamente em instantes.");
    }
  };

  return (
    <>
      <ActionRow
        icon={UserPlus}
        label="Adicionar amigo"
        tone="info"
        onClick={handleAddFriend}
        pending={sendRequest.isPending}
      />
      <ActionRow
        icon={UserX}
        label="Bloquear"
        onClick={() => blockFriendship.mutate(otherProfile.id)}
        destructive
      />
    </>
  );
}

// Semantic status color, separate from the brand accent -- lets a relationship
// state (waiting / actionable / confirmed / blocked) read at a glance instead
// of every row looking equally neutral. "destructive" is kept as a boolean
// alias for the common sign-out/block/reject case.
const TONE_CLASSES = {
  default: { row: "bg-white/5 hover:bg-white/10 hover:-translate-y-0.5", icon: "text-muted-foreground" },
  info: { row: "bg-sky-400/5 hover:bg-sky-400/10 hover:-translate-y-0.5", icon: "text-sky-400" },
  warning: { row: "bg-amber-500/5 hover:bg-amber-500/10 hover:-translate-y-0.5", icon: "text-amber-500" },
  success: { row: "bg-primary/5 hover:bg-primary/10 hover:-translate-y-0.5", icon: "text-primary" },
  destructive: { row: "text-destructive bg-destructive/5 hover:bg-destructive/10 hover:-translate-y-0.5", icon: "" },
} as const;

function ActionRow({
  icon: Icon,
  label,
  onClick,
  trailing,
  destructive,
  tone = "default",
  disabled,
  pending,
  done,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  trailing?: ReactNode;
  destructive?: boolean;
  tone?: keyof typeof TONE_CLASSES;
  disabled?: boolean;
  pending?: boolean;
  done?: boolean;
}) {
  const resolvedTone = destructive ? "destructive" : tone;
  const { row, icon } = TONE_CLASSES[resolvedTone];
  return (
    <button
      onClick={onClick}
      disabled={disabled || pending}
      className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm transition duration-200 disabled:opacity-60 disabled:cursor-default ${row} ${
        resolvedTone === "destructive" ? "text-destructive" : ""
      }`}
    >
      {done ? <Check className="w-4 h-4 text-primary" /> : <Icon className={`w-4 h-4 ${icon}`} />}
      <span className="flex-1 text-left">{label}</span>
      {trailing}
    </button>
  );
}
