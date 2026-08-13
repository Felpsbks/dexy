// Etapa 6.3 — connection presence, separate from profiles.status.
//
// profiles.status only ever holds the user's manually chosen preference
// (online/idle/dnd/offline — see ProfilePopover's StatusMenu) and is never
// written to from here. Whether a user is *actually connected right now* is
// tracked entirely client-side via a single shared Supabase Realtime
// Presence channel: every connected client calls track() with the channel's
// presence key set to its own user_id, so presenceState() naturally groups
// every open tab/device of the same account under one key — an entry only
// disappears once the last connection for that user_id drops (tab close,
// crash, lost network, sleep, ...), without needing any DB write, heartbeat,
// or polling.
import { useEffect, useSyncExternalStore } from "react";
import { supabase } from "./supabase";

const CHANNEL_NAME = "presence:app";

let channel: ReturnType<typeof supabase.channel> | null = null;
let channelUserId: string | null = null;
let refCount = 0;
let onlineUserIds: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribeStore(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return onlineUserIds;
}

function recomputeFromState() {
  if (!channel) return;
  const state = channel.presenceState();
  const next = new Set<string>();
  for (const key of Object.keys(state)) {
    if ((state[key] ?? []).length > 0) next.add(key);
  }
  onlineUserIds = next;
  emit();
}

function teardownChannel() {
  if (channel) supabase.removeChannel(channel);
  channel = null;
  channelUserId = null;
  onlineUserIds = new Set();
  emit();
}

// Opens (or reuses) the single app-wide presence channel. Meant to be called
// once, from the top of the authenticated app shell — every other component
// only *reads* presence via useIsUserOnline/useOnlineUserIds, never opens a
// channel of its own, so there is only ever one presence socket regardless
// of how many components read from it. Ref-counted so it's still safe if
// more than one place ends up calling it (matches the "no duplicate
// subscriptions" discipline already used for the other realtime channels in
// queries.ts).
export function usePresenceConnection(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return;

    refCount++;
    if (channel && channelUserId !== userId) teardownChannel();

    if (!channel) {
      channelUserId = userId;
      // Optimistic: this connection counts itself online immediately, not
      // only once the track() round-trip confirms it — avoids a spurious
      // Offline flash for your own status right after a reload. The next
      // presence "sync" reconciles with the real state anyway, which will
      // already include this connection by then.
      onlineUserIds = new Set(onlineUserIds).add(userId);
      emit();

      const ch = supabase.channel(CHANNEL_NAME, { config: { presence: { key: userId } } });
      ch.on("presence", { event: "sync" }, recomputeFromState);
      ch.subscribe((status) => {
        if (status === "SUBSCRIBED") ch.track({ online_at: new Date().toISOString() });
      });
      channel = ch;
    }

    return () => {
      refCount = Math.max(0, refCount - 1);
      if (refCount === 0) teardownChannel();
    };
  }, [userId]);
}

// Whole online set — for screens that need to check several ids in one
// render (member lists, DM sidebar) without calling a hook per row.
export function useOnlineUserIds(): ReadonlySet<string> {
  return useSyncExternalStore(subscribeStore, getSnapshot, getSnapshot);
}

// Single-id convenience for screens that only ever look at one profile at a
// time (DM header, message row, profile popover).
export function useIsUserOnline(userId: string | undefined): boolean {
  const ids = useOnlineUserIds();
  return !!userId && ids.has(userId);
}
