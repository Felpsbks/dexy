export type UserStatus = "online" | "idle" | "dnd" | "offline";

export const statusColor: Record<UserStatus, string> = {
  online: "bg-emerald-500",
  idle: "bg-amber-400",
  dnd: "bg-rose-500",
  offline: "bg-zinc-500",
};

export const statusRing: Record<UserStatus, string> = {
  online: "ring-2 ring-emerald-500/70",
  idle: "ring-2 ring-amber-400/70",
  dnd: "ring-2 ring-rose-500/70",
  offline: "ring-2 ring-zinc-500/40",
};

export const statusLabel: Record<UserStatus, string> = {
  online: "Online",
  idle: "Ausente",
  dnd: "Não perturbe",
  offline: "Offline",
};

// profiles.status is only the user's manually chosen preference — the
// status actually shown always folds in real connection presence too: a
// disconnected user reads as Offline no matter what preference they last
// saved. There is no invisible/appear-offline mode: a connected user whose
// cached manual value is still "offline" (new account default, or a stale
// copy of another user's profile — profiles isn't live-subscribed) reads as
// Online instead, since presence is ground truth for the connected/
// disconnected boundary.
export function resolvePresenceStatus(manualStatus: UserStatus, isOnline: boolean): UserStatus {
  if (!isOnline) return "offline";
  return manualStatus === "offline" ? "online" : manualStatus;
}

export function avatarFor(profile: { id: string; avatar_url: string | null }) {
  return profile.avatar_url || `https://api.dicebear.com/9.x/glass/svg?seed=${profile.id}`;
}

export function formatMemberSince(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

// "10:19" for today, "Ontem" for yesterday, "07/08" otherwise — used in the
// DM sidebar row's timestamp, matching the compact style of a chat-list preview.
export function formatRelativeTime(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (date.toDateString() === yesterday.toDateString()) return "Ontem";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
