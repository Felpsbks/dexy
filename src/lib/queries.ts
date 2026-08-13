import { useEffect, useRef } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "./supabase";
import type { Database } from "./database.types";
import type { DmCallRow } from "./livekit";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Server = Database["public"]["Tables"]["servers"]["Row"];
type Channel = Database["public"]["Tables"]["channels"]["Row"];

export type Attachment = Database["public"]["Tables"]["message_attachments"]["Row"];
export type DmAttachment = Database["public"]["Tables"]["dm_message_attachments"]["Row"];

export type MessageWithAuthor = Database["public"]["Tables"]["messages"]["Row"] & {
  author: Profile;
  reactions: Database["public"]["Tables"]["message_reactions"]["Row"][];
  attachments: Attachment[];
};

// How many messages a single page loads — chat views fetch just the most
// recent page up front and pull in another page only when the user actually
// scrolls up into history, instead of loading a whole conversation's history
// (which only grows and re-fetches in full on every unrelated realtime event).
const MESSAGES_PAGE_SIZE = 40;

// Patches one message into whatever page of an infinite message query
// currently holds it (or, if it's not cached yet, appends it as a new
// message onto the most-recently-fetched page) — used so realtime updates
// (new message, edit, reaction, attachment) only ever cost a single-row
// fetch, never a refetch of every page the user has scrolled through.
function patchMessageInPages<T extends { id: string }>(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  message: T,
) {
  queryClient.setQueryData<InfiniteData<T[], string | null>>(queryKey, (data) => {
    if (!data) return data;
    let found = false;
    const pages = data.pages.map((page) => {
      const idx = page.findIndex((m) => m.id === message.id);
      if (idx === -1) return page;
      found = true;
      const next = page.slice();
      next[idx] = message;
      return next;
    });
    if (found) return { ...data, pages };
    if (pages.length === 0) return { ...data, pages: [[message]] };
    const withAppend = pages.slice();
    withAppend[withAppend.length - 1] = [...withAppend[withAppend.length - 1], message];
    return { ...data, pages: withAppend };
  });
}

function removeMessageFromPages<T extends { id: string }>(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  id: string,
) {
  queryClient.setQueryData<InfiniteData<T[], string | null>>(queryKey, (data) => {
    if (!data) return data;
    return { ...data, pages: data.pages.map((page) => page.filter((m) => m.id !== id)) };
  });
}

// Optimistic reaction toggling needs to reach into whichever page holds the
// message being reacted to — same page-aware update as the two helpers
// above, just scoped to one message's `reactions` array.
function updateMessageReactionsInPages<T extends { id: string; reactions: R[] }, R>(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  messageId: string,
  updateReactions: (reactions: R[]) => R[],
) {
  queryClient.setQueryData<InfiniteData<T[], string | null>>(queryKey, (data) => {
    if (!data) return data;
    return {
      ...data,
      pages: data.pages.map((page) =>
        page.map((m) =>
          m.id === messageId ? { ...m, reactions: updateReactions(m.reactions) } : m,
        ),
      ),
    };
  });
}

export type MemberWithProfile = Database["public"]["Tables"]["server_members"]["Row"] & {
  profile: Profile;
  role: ServerRole | null;
};

export function useProfile(userId: string | undefined) {
  return useQuery({
    queryKey: ["profile", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId!)
        .single();
      if (error) throw error;
      return data as Profile;
    },
    enabled: !!userId,
  });
}

export function useUpdateProfile(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      patch: Partial<
        Pick<
          Profile,
          | "name"
          | "bio"
          | "status"
          | "avatar_url"
          | "banner_url"
          | "banner_position"
          | "banner_overlay"
          | "banner_color"
          | "accent_color"
          | "app_theme"
          | "language"
          | "notify_mentions"
          | "notify_all_messages"
          | "notify_sound"
        >
      >,
    ) => {
      const { error } = await supabase.from("profiles").update(patch).eq("id", userId!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile", userId] });
      queryClient.invalidateQueries({ queryKey: ["members"] });
    },
  });
}

export type ProfileStats = {
  messages: number;
  reactions: number;
  friends: number;
  servers: number;
};

// Real counts (not placeholder numbers) for the profile preview's
// "estatísticas" row — each is a head-only count query (no rows fetched),
// so this stays cheap even for very active accounts.
export function useProfileStats(userId: string | undefined) {
  return useQuery({
    queryKey: ["profile-stats", userId],
    queryFn: async (): Promise<ProfileStats> => {
      const [messages, dmMessages, reactions, dmReactions, friends, servers] = await Promise.all([
        supabase
          .from("messages")
          .select("*", { count: "exact", head: true })
          .eq("author_id", userId!),
        supabase
          .from("dm_messages")
          .select("*", { count: "exact", head: true })
          .eq("author_id", userId!),
        supabase
          .from("message_reactions")
          .select("*", { count: "exact", head: true })
          .eq("user_id", userId!),
        supabase
          .from("dm_message_reactions")
          .select("*", { count: "exact", head: true })
          .eq("user_id", userId!),
        supabase
          .from("friendships")
          .select("*", { count: "exact", head: true })
          .eq("status", "accepted")
          .or(`user_id.eq.${userId},friend_id.eq.${userId}`),
        supabase
          .from("server_members")
          .select("*", { count: "exact", head: true })
          .eq("user_id", userId!),
      ]);
      return {
        messages: (messages.count ?? 0) + (dmMessages.count ?? 0),
        reactions: (reactions.count ?? 0) + (dmReactions.count ?? 0),
        friends: friends.count ?? 0,
        servers: servers.count ?? 0,
      };
    },
    enabled: !!userId,
  });
}

export function useServers() {
  const queryClient = useQueryClient();
  const queryKey = ["servers"];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase.from("servers").select("*").order("created_at");
      if (error) throw error;
      return data as Server[];
    },
  });

  // `servers` is already in the supabase_realtime publication (init_schema.sql)
  // and RLS-gated the same way as the REST select above (is_server_member),
  // so this can't leak servers the caller isn't a member of. Same
  // invalidate-on-any-event pattern as useFriendships/useNotifications.
  // useServers() is mounted exactly once (AppPage), so a single static
  // channel name is enough — no per-instance suffix needed.
  useEffect(() => {
    const channel = supabase
      .channel("servers-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "servers" }, () =>
        queryClient.invalidateQueries({ queryKey }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return query;
}

// Goes through create_server() exclusively — a SECURITY DEFINER RPC that
// creates the server, adds the caller as a member, and creates a default
// "geral" channel, all atomically. Not a direct table insert: owner_id is
// derived server-side from auth.uid() (the client can't set it), and this
// sidesteps a still-unexplained RLS issue that rejects direct INSERTs into
// `servers` even with a correct owner_id.
export function useCreateServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await supabase.rpc("create_server", { p_name: name });
      if (error) throw error;
      return data as Server;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["servers"] }),
  });
}

// Direct table UPDATE, unlike creation — the audit confirmed
// "owners can update their servers" (owner_id = auth.uid()) actually works
// correctly against the live database (tested with two real accounts), so
// there's no need to route this through a SECURITY DEFINER RPC like
// create_server. RLS itself is what stops a non-owner from renaming.
export function useUpdateServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("O nome do servidor é obrigatório.");
      if (trimmed.length > 100) throw new Error("Nome muito longo (máx. 100 caracteres).");
      const { data, error } = await supabase
        .from("servers")
        .update({ name: trimmed })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as Server;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["servers"] }),
  });
}

// Direct table DELETE, same reasoning as useUpdateServer — RLS
// ("owners can delete their servers") and the schema's own
// `on delete cascade` on server_members.server_id/channels.server_id were
// both verified empirically (two real accounts, confirmed cascade left no
// orphaned rows) before wiring this up.
export function useDeleteServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("servers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["servers"] }),
  });
}

export function useChannels(serverId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ["channels", serverId];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("channels")
        .select("*")
        .eq("server_id", serverId!)
        .order("position");
      if (error) throw error;
      return data as Channel[];
    },
    enabled: !!serverId,
  });

  // Same invalidate-on-any-event pattern as useServers/useFriendships/
  // useNotifications. `channels` is already in the supabase_realtime
  // publication and RLS-gated the same way as the REST select above
  // (is_server_member), both confirmed against the live database — audited
  // and empirically tested (INSERT/UPDATE/DELETE, owner vs non-owner)
  // before this was wired up. Channel name is scoped to serverId so
  // switching servers re-subscribes instead of leaking events from a
  // server no longer active.
  //
  // No `filter: server_id=eq.…` here on purpose: without REPLICA IDENTITY
  // FULL on `channels` (a schema change, out of scope for this task), a
  // DELETE payload's `old` record only contains the primary key — no
  // server_id — so a server_id filter silently never matches DELETE events
  // and they'd never reach this subscription (confirmed empirically).
  // Subscribing unfiltered still only delivers rows this user can SELECT
  // (RLS), and invalidating unconditionally just means an occasional extra
  // refetch of this exact query if another server's channel changes while
  // this one is open — never a request loop.
  useEffect(() => {
    if (!serverId) return;
    const channel = supabase
      .channel(`channels:${serverId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "channels" }, () =>
        queryClient.invalidateQueries({ queryKey }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);

  return query;
}

// Direct table INSERT, same reasoning as useUpdateServer/useDeleteServer:
// the "owners can manage channels" RLS policy (for all, using/with check
// is_server_owner(server_id)) was audited and empirically tested against
// the live database (INSERT/UPDATE/DELETE, owner vs non-owner) before this
// was wired up — no RPC needed here, RLS is the real authorization.
//
// position is computed from the server's current channels instead of a
// fixed 0: fetches the current max position for server_id and inserts at
// max+1, so new channels land at the end of the list instead of colliding
// with (or sorting before) whatever's already there. Not wrapped in a
// transaction/RPC — a rare concurrent double-create could in theory compute
// the same position twice, but there's no uniqueness constraint on it and
// no reordering feature yet for that to visibly break, so this is a
// deliberate simplification, not an oversight.
export function useCreateChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      serverId,
      name,
      type,
      category,
      topic,
    }: {
      serverId: string;
      name: string;
      type: "text" | "voice";
      category: string;
      topic?: string | null;
    }) => {
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error("O nome do canal é obrigatório.");
      if (trimmedName.length > 100) throw new Error("Nome muito longo (máx. 100 caracteres).");
      const trimmedCategory = category.trim() || "Geral";
      const trimmedTopic = topic?.trim() || null;

      const { data: existing, error: posError } = await supabase
        .from("channels")
        .select("position")
        .eq("server_id", serverId)
        .order("position", { ascending: false })
        .limit(1);
      if (posError) throw posError;
      const nextPosition = existing && existing.length > 0 ? existing[0].position + 1 : 0;

      const { data, error } = await supabase
        .from("channels")
        .insert({
          server_id: serverId,
          name: trimmedName,
          type,
          category: trimmedCategory,
          topic: trimmedTopic,
          position: nextPosition,
        })
        .select()
        .single();
      if (error) throw error;
      return data as Channel;
    },
    onSuccess: (data) => queryClient.invalidateQueries({ queryKey: ["channels", data.server_id] }),
  });
}

// Direct table UPDATE, same reasoning/precedent as useUpdateServer: the
// "owners can manage channels" RLS policy already covers UPDATE and was
// empirically tested (owner succeeds, non-owner gets 0 rows affected)
// before this was wired up — no RPC needed.
//
// Deliberately does NOT accept `type` or `position`: type-switching an
// existing channel (e.g. voice -> text while someone is mid-call, or
// text -> voice orphaning its message history from the UI) isn't safe with
// how VoiceRoomView/ChatArea are wired today, and position has no
// reordering UI yet for a changed value to mean anything — so neither is
// part of this mutation's payload, which keeps both untouched by
// construction rather than by convention.
export function useUpdateChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      name,
      category,
      topic,
    }: {
      id: string;
      name: string;
      category: string;
      topic?: string | null;
    }) => {
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error("O nome do canal é obrigatório.");
      if (trimmedName.length > 100) throw new Error("Nome muito longo (máx. 100 caracteres).");
      const trimmedCategory = category.trim() || "Geral";
      const trimmedTopic = topic?.trim() || null;

      const { data, error } = await supabase
        .from("channels")
        .update({ name: trimmedName, category: trimmedCategory, topic: trimmedTopic })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as Channel;
    },
    onSuccess: (data) => queryClient.invalidateQueries({ queryKey: ["channels", data.server_id] }),
  });
}

// Direct table DELETE, same reasoning/precedent as useDeleteServer: the
// "owners can manage channels" RLS policy already covers DELETE and was
// empirically tested (owner succeeds, non-owner gets 0 rows affected)
// before this was wired up — no RPC needed. The schema's own
// `on delete cascade` on messages.channel_id (and transitively
// message_reactions/message_attachments -> messages) handles cleanup,
// already confirmed empirically during the channels audit.
//
// "Don't delete the server's last channel" is enforced by the caller (the
// confirmation dialog only offers a real delete when channels.length > 1)
// — there's no DB constraint for it (out of scope: no schema changes), so
// this is a UI-level guard, not a security boundary.
export function useDeleteChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; serverId: string }) => {
      const { error } = await supabase.from("channels").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: ["channels", variables.serverId] }),
  });
}

// Reorders channels within a server (drag-and-drop). Per the reorder audit:
// `position` has no unique constraint and no reindexing anywhere else, so
// gaps and even duplicates can already exist — this mutation never applies
// an incremental delta. The caller always recomputes the FULL, contiguous
// 0..N-1 position sequence for every channel on the server before calling
// this, so every drop self-heals whatever inconsistent state came before it
// instead of assuming a clean starting point.
//
// Single .upsert() = one atomic multi-row statement, no RPC. PostgREST
// upsert is `insert ... on conflict (id) do update` under the hood, so even
// though every row here already exists and this is conceptually a batch
// UPDATE, the hypothetical insert branch still needs every NOT NULL column
// without a default (server_id/name/type) — that's why the payload carries
// more than just id/position/category, not because those columns are
// meant to change.
export function useReorderChannels() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ channels }: { serverId: string; channels: Channel[] }) => {
      const { error } = await supabase.from("channels").upsert(
        channels.map((c) => ({
          id: c.id,
          server_id: c.server_id,
          name: c.name,
          type: c.type,
          category: c.category,
          topic: c.topic,
          position: c.position,
        })),
        { onConflict: "id" },
      );
      if (error) throw error;
    },
    onMutate: async ({ serverId, channels }) => {
      const queryKey = ["channels", serverId];
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<Channel[]>(queryKey);
      queryClient.setQueryData<Channel[]>(
        queryKey,
        [...channels].sort((a, b) => a.position - b.position),
      );
      return { previous };
    },
    onError: (_err, { serverId }, context) => {
      const queryKey = ["channels", serverId];
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      // Restore isn't enough on its own here (unlike useToggleReaction's
      // rollback) — the optimistic order was computed from whatever the
      // client had cached, which is exactly the kind of drifted state this
      // feature is meant to self-heal, so a failed write also forces a
      // refetch of the real, current server-side order.
      queryClient.invalidateQueries({ queryKey });
      toast.error("Não foi possível reordenar os canais. Tente novamente.");
    },
  });
}

export function useMembers(serverId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ["members", serverId];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("server_members")
        .select("*, profile:profiles(*), role:server_roles(*)")
        .eq("server_id", serverId!);
      if (error) throw error;
      return data as unknown as MemberWithProfile[];
    },
    enabled: !!serverId,
  });

  // Same invalidate-on-any-event pattern as useServers/useChannels/
  // useFriendships/useNotifications. `server_members` is already in the
  // supabase_realtime publication (init_schema.sql) — confirmed before
  // writing this, no migration needed.
  //
  // Unlike channels (primary key is just `id`), server_members' primary
  // key is the composite (server_id, user_id) — replica identity default
  // includes every primary key column, so server_id is always present in
  // a DELETE payload's `old` record here. A server_id filter is safe (and
  // was empirically confirmed to fire on INSERT/UPDATE/DELETE alike),
  // unlike useChannels' subscription which had to go unfiltered because
  // its primary key doesn't include server_id.
  useEffect(() => {
    if (!serverId) return;
    const channel = supabase
      .channel(`members:${serverId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "server_members", filter: `server_id=eq.${serverId}` },
        () => queryClient.invalidateQueries({ queryKey }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);

  return query;
}

// Direct table DELETE, same precedent as useDeleteServer/useDeleteChannel:
// "users can leave or be removed by the owner" (init_schema.sql) already
// covers this — `is_server_owner(server_id)` lets the owner delete anyone's
// row, no RPC needed. No new policy, no migration.
//
// That same policy's other clause (`user_id = auth.uid()`) is what will
// eventually power "sair do servidor" — mechanically identical to a kick at
// the database level (both are just a DELETE on someone's row), so RLS
// alone can't tell "owner kicking someone else" apart from "owner
// accidentally kicking themselves". Kicking yourself isn't a security
// issue (self-delete is intentionally allowed), but it WOULD be a backdoor
// around the current "owner can't leave yet" product rule, so this hook
// refuses to target the caller's own membership — independent of the UI
// already not rendering that option.
export function useKickMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ serverId, userId }: { serverId: string; userId: string }) => {
      const currentUserId = (await supabase.auth.getUser()).data.user?.id;
      if (currentUserId && userId === currentUserId) {
        throw new Error("Não é possível remover a própria membership por aqui.");
      }
      const { error } = await supabase
        .from("server_members")
        .delete()
        .eq("server_id", serverId)
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: ["members", variables.serverId] }),
  });
}

// Direct table DELETE, same shape as useKickMember (self instead of a
// target). Real protection against the owner leaving is the RLS policy
// itself (Etapa 3 migration: "members can leave, owner can remove others,
// owner cannot remove self") — this hook doesn't duplicate that check,
// since the two required layers are the RLS (backend) and the UI never
// rendering the option for the owner (frontend), not a third copy of the
// same logic here.
//
// Invalidates ["servers"] (so the left server disappears from the caller's
// own list) and this server's ["members"]/["channels"] too — the existing
// auto-reselect effect in app.tsx (same one used for excluir servidor)
// already picks another server once "servers" refetches, and NoServersScreen
// already covers the zero-servers case — no new selection mechanism here.
export function useLeaveServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ serverId, userId }: { serverId: string; userId: string }) => {
      const { error } = await supabase
        .from("server_members")
        .delete()
        .eq("server_id", serverId)
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["servers"] });
      queryClient.invalidateQueries({ queryKey: ["members", variables.serverId] });
      queryClient.invalidateQueries({ queryKey: ["channels", variables.serverId] });
    },
  });
}

// --- Roles ---
// Etapa 4A: identity/organization only (name, color, position). No
// permission logic anywhere here — role_id has zero authorization
// consequence in this step, exactly as scoped.

export type ServerRole = Database["public"]["Tables"]["server_roles"]["Row"];

export function useServerRoles(serverId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ["server-roles", serverId];
  // AppPage and RolesManagerDialog both call this hook for the same
  // serverId at once — a bare `server-roles:${serverId}` channel name
  // collides between the two mounted instances (Supabase Realtime throws
  // "cannot add postgres_changes callbacks after subscribe()" on the
  // second .on() for an already-subscribed channel object of the same
  // name), which crashed the whole page the first time this was actually
  // exercised through the real UI. A per-mount id keeps every hook
  // instance on its own channel.
  const instanceId = useRef(crypto.randomUUID());

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("server_roles")
        .select("*")
        .eq("server_id", serverId!)
        .order("position", { ascending: false });
      if (error) throw error;
      return data as ServerRole[];
    },
    enabled: !!serverId,
  });

  // Same invalidate-on-any-event, unfiltered pattern as useChannels: no
  // REPLICA IDENTITY FULL on server_roles, so a DELETE payload's `old`
  // record only carries the primary key (id), never server_id — a
  // server_id filter would silently swallow DELETE events. Also
  // invalidates ["members", serverId] because useMembers embeds
  // role:server_roles(*) — a role rename/recolor doesn't touch
  // server_members at all, so without this, other tabs' member badges
  // would go stale until an unrelated members event.
  useEffect(() => {
    if (!serverId) return;
    const channel = supabase
      .channel(`server-roles:${serverId}:${instanceId.current}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "server_roles" }, () => {
        queryClient.invalidateQueries({ queryKey });
        queryClient.invalidateQueries({ queryKey: ["members", serverId] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);

  return query;
}

// Direct table INSERT — same precedent as useCreateChannel: "owners can
// manage server roles" (for all, is_server_owner(server_id)) was already
// empirically confirmed working (owner succeeds, non-owner rejected) in
// the Roles audit, no RPC needed. position is computed the same way as
// channel creation — max(existing) + 1, never a fixed 0.
export function useCreateRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      serverId,
      name,
      color,
    }: {
      serverId: string;
      name: string;
      color?: string | null;
    }) => {
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error("O nome do cargo é obrigatório.");
      if (trimmedName.length > 100) throw new Error("Nome muito longo (máx. 100 caracteres).");

      const { data: existing, error: posError } = await supabase
        .from("server_roles")
        .select("position")
        .eq("server_id", serverId)
        .order("position", { ascending: false })
        .limit(1);
      if (posError) throw posError;
      const nextPosition = existing && existing.length > 0 ? existing[0].position + 1 : 0;

      const { data, error } = await supabase
        .from("server_roles")
        .insert({ server_id: serverId, name: trimmedName, color: color ?? null, position: nextPosition })
        .select()
        .single();
      if (error) throw error;
      return data as ServerRole;
    },
    onSuccess: (data) => queryClient.invalidateQueries({ queryKey: ["server-roles", data.server_id] }),
  });
}

// Direct table UPDATE, same RLS precedent. Deliberately does not accept
// `position` — no reorder UI this step, so there's nothing meaningful to
// send.
export function useUpdateRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      name,
      color,
    }: {
      id: string;
      name: string;
      color?: string | null;
    }) => {
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error("O nome do cargo é obrigatório.");
      if (trimmedName.length > 100) throw new Error("Nome muito longo (máx. 100 caracteres).");
      const { data, error } = await supabase
        .from("server_roles")
        .update({ name: trimmedName, color: color ?? null })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as ServerRole;
    },
    onSuccess: (data) => queryClient.invalidateQueries({ queryKey: ["server-roles", data.server_id] }),
  });
}

// Direct table DELETE, same RLS precedent. server_members.role_id has
// `on delete set null`, so members holding this role are cleared
// automatically by the database — this also invalidates ["members",
// serverId] so the UI drops the badge without a manual patch, reusing the
// realtime/query-invalidation infrastructure already in place rather than
// adding a new one.
export function useDeleteRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; serverId: string }) => {
      const { error } = await supabase.from("server_roles").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["server-roles", variables.serverId] });
      queryClient.invalidateQueries({ queryKey: ["members", variables.serverId] });
    },
  });
}

// RPC-only — assign_role is SECURITY DEFINER and the only path that can
// change server_members.role_id (no UPDATE policy exists on that table for
// this column; see 20260810040000_assign_role_rpc.sql for why). Owner-only,
// validates the role belongs to serverId, roleId null clears the role.
export function useAssignRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      serverId,
      userId,
      roleId,
    }: {
      serverId: string;
      userId: string;
      roleId: string | null;
    }) => {
      const { data, error } = await supabase.rpc("assign_role", {
        p_server_id: serverId,
        p_user_id: userId,
        p_role_id: roleId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["members", variables.serverId] });
    },
  });
}

// --- Role permissions ---
// Etapa 5.5: the management layer for the 6-permission catalog
// (role_permissions, Etapa 5.1). Deliberately does NOT read has_permission()
// anywhere — RLS on role_permissions stays owner-only (a manage_roles
// holder can create/edit/delete roles but can never grant a role
// permissions, which would be a self-escalation path). This file only adds
// hooks; no RLS/RPC changes in this step.

export const PERMISSION_CATALOG = [
  { key: "manage_channels", label: "Gerenciar canais" },
  { key: "manage_invites", label: "Gerenciar convites" },
  { key: "kick_members", label: "Expulsar membros" },
  { key: "manage_roles", label: "Gerenciar cargos" },
  { key: "assign_roles", label: "Atribuir cargos" },
  { key: "moderate_messages", label: "Moderar mensagens" },
] as const;

export type PermissionKey = (typeof PERMISSION_CATALOG)[number]["key"];

export type RolePermission = Database["public"]["Tables"]["role_permissions"]["Row"];

export function useRolePermissions(roleId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ["role-permissions", roleId];
  // Same per-mount channel-name guard as useServerRoles — only one
  // RolePermissionsPanel is ever expanded at a time today, but nothing
  // structurally prevents two instances of this hook mounting for the same
  // roleId, and the failure mode (a crashed page) is bad enough to guard
  // against preemptively rather than wait for it to actually collide.
  const instanceId = useRef(crypto.randomUUID());

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase.from("role_permissions").select("*").eq("role_id", roleId!);
      if (error) throw error;
      return data as RolePermission[];
    },
    enabled: !!roleId,
  });

  // role_permissions' primary key IS (role_id, permission) — unlike
  // channels/server_roles, a DELETE payload's `old` record reliably
  // includes role_id (replica identity default covers every PK column), so
  // filtering by role_id is safe here for INSERT/UPDATE/DELETE alike.
  useEffect(() => {
    if (!roleId) return;
    const channel = supabase
      .channel(`role-permissions:${roleId}:${instanceId.current}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "role_permissions", filter: `role_id=eq.${roleId}` },
        () => queryClient.invalidateQueries({ queryKey }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleId]);

  return query;
}

// Toggling a permission off DELETEs the row instead of upserting
// allow:false. Both mean "denied" (tested exhaustively in Etapas 5.1/5.2),
// but a toggle UI only ever needs "granted" rows to exist — keeping
// role_permissions containing only granted entries matches how the
// checkbox state is read back (`some(p => p.permission === key)`) and
// avoids accumulating explicit-false rows that this UI never produces.
export function useSetRolePermission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      roleId,
      permission,
      allow,
    }: {
      roleId: string;
      permission: PermissionKey;
      allow: boolean;
    }) => {
      if (allow) {
        const { error } = await supabase
          .from("role_permissions")
          .upsert({ role_id: roleId, permission, allow: true }, { onConflict: "role_id,permission" });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("role_permissions")
          .delete()
          .eq("role_id", roleId)
          .eq("permission", permission);
        if (error) throw error;
      }
    },
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: ["role-permissions", variables.roleId] }),
  });
}

// Etapa 5.7 — the consumption side of the permission system. Deliberately
// calls has_permission() (SECURITY DEFINER RPC) for each catalog entry
// instead of ever selecting from role_permissions directly: a regular
// member has no RLS visibility into that table at all (owner-only, by
// design, since Etapa 5.1 — this stays that way), so a client-side
// permission check built on reading role_permissions would silently return
// nothing for every non-owner. Every call site is expected to combine this
// with isServerOwner explicitly (`isServerOwner || hasPermission(key)`) —
// this hook never folds the owner shortcut in itself, matching the same
// "never replace, always OR" rule the backend has followed since Etapa 5.2.
export function usePermissions(serverId: string | undefined, userId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ["permissions", serverId, userId];
  const instanceId = useRef(crypto.randomUUID());

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const entries = await Promise.all(
        PERMISSION_CATALOG.map(async ({ key }) => {
          const { data, error } = await supabase.rpc("has_permission", {
            p_server_id: serverId!,
            p_permission: key,
          });
          if (error) throw error;
          return [key, data === true] as const;
        }),
      );
      return Object.fromEntries(entries) as Record<PermissionKey, boolean>;
    },
    enabled: !!serverId && !!userId,
    // Fallback for the one case nothing else covers: the owner edits the
    // CURRENT role's permission set (not a reassignment) — role_permissions
    // itself is invisible to this user, so there's no accessible realtime
    // signal for that specific change. 20s keeps this from ever going stale
    // for long, without polling aggressively.
    refetchInterval: 20_000,
  });

  // Covers the other case immediately instead of waiting on the poll: the
  // owner reassigns (or clears) this user's role. server_members is a
  // table members already have full read access to (unlike
  // role_permissions), so subscribing to changes on their own row is not a
  // new access grant — it's the same realtime infrastructure useMembers
  // already relies on, just filtered to a single user.
  useEffect(() => {
    if (!serverId || !userId) return;
    const channel = supabase
      .channel(`permissions-refresh:${serverId}:${userId}:${instanceId.current}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "server_members", filter: `user_id=eq.${userId}` },
        () => queryClient.invalidateQueries({ queryKey }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, userId]);

  const hasPermission = (key: PermissionKey) => query.data?.[key] === true;

  return { hasPermission, isLoading: query.isLoading };
}

// --- Invites ---

export type ServerInvite = Database["public"]["Tables"]["server_invites"]["Row"];

// RPC-only, same reasoning as create_server: create_invite is SECURITY
// DEFINER (validates server ownership, generates the code, and inserts
// server-side), so there is no direct-table-INSERT variant of this hook —
// server_invites' RLS is owner-only by design, but going through the RPC
// means this doesn't even rely on that policy being reliable for INSERT
// (the historical servers-table INSERT bug is exactly why create_server
// itself is RPC-only too).
//
// Invalidates ["server-invites", serverId] — no useServerInvites() query
// exists yet (that's the invite-management UI, a later step), but wiring
// the invalidation now means it'll work correctly the moment that hook is
// added, instead of being another thing to remember later.
export function useCreateInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      serverId,
      expiresAt,
      maxUses,
    }: {
      serverId: string;
      expiresAt?: string | null;
      maxUses?: number | null;
    }) => {
      const { data, error } = await supabase.rpc("create_invite", {
        p_server_id: serverId,
        p_expires_at: expiresAt ?? null,
        p_max_uses: maxUses ?? null,
      });
      if (error) throw error;
      return data as ServerInvite;
    },
    onSuccess: (invite) =>
      queryClient.invalidateQueries({ queryKey: ["server-invites", invite.server_id] }),
  });
}

// RPC-only — accept_invite is SECURITY DEFINER and is the ONLY path that
// inserts into server_members; this hook has no direct .from("server_members")
// fallback and must never grow one (that table's public INSERT policy was
// intentionally removed and stays removed). p_code is the sole input: there
// is no user_id parameter to pass because the RPC derives the acceptor
// exclusively from auth.uid() on the server side.
//
// accept_invite is `returns table(...)`, which PostgREST/supabase-js always
// serializes as an array (unlike create_server's single-row composite
// return) even though this RPC only ever produces one row — data[0] is the
// real result.
export function useAcceptInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) => {
      const { data, error } = await supabase.rpc("accept_invite", { p_code: code });
      if (error) throw error;
      const result = data?.[0];
      if (!result) throw new Error("accept_invite returned no result");
      return result;
    },
    onSuccess: (result) => {
      // The accepting account's own server list needs the newly joined
      // server; members/channels of that server are invalidated too so
      // they're fresh whenever this tab actually opens it (a no-op refetch
      // if neither was ever fetched here yet).
      queryClient.invalidateQueries({ queryKey: ["servers"] });
      queryClient.invalidateQueries({ queryKey: ["members", result.server_id] });
      queryClient.invalidateQueries({ queryKey: ["channels", result.server_id] });
    },
  });
}

// Plain read — server_invites' RLS (Etapa 1) already restricts SELECT to
// the server owner, so this simply returns nothing useful for anyone else;
// no client-side filtering needed on top of that. Uses the ServerInvite
// type (same shape as a table row) instead of adding a Tables.server_invites
// entry to database.types.ts, since one isn't needed for anything else yet.
export function useServerInvites(serverId: string | undefined) {
  return useQuery({
    queryKey: ["server-invites", serverId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("server_invites")
        .select("*")
        .eq("server_id", serverId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ServerInvite[];
    },
    enabled: !!serverId,
  });
}

// Direct table UPDATE (soft-revoke via revoked_at), same reasoning as
// useUpdateServer/useUpdateChannel: server_invites' owner-only RLS already
// covers this, no RPC needed.
export function useRevokeInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; serverId: string }) => {
      const { data, error } = await supabase
        .from("server_invites")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as ServerInvite;
    },
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: ["server-invites", variables.serverId] }),
  });
}

// Hard delete, same RLS precedent as useRevokeInvite. Not wired to any UI
// yet in this step (the invite management screen only exposes "revogar"),
// kept alongside it since both were asked for at the hook layer.
export function useDeleteInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; serverId: string }) => {
      const { error } = await supabase.from("server_invites").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: ["server-invites", variables.serverId] }),
  });
}

export type InvitePreview = {
  name: string | null;
  icon_initial: string | null;
  color: string | null;
  status: "valid" | "expired" | "revoked" | "exhausted" | "not_found";
  already_member: boolean;
};

// Read-only — calls preview_invite (Etapa 5.1) exclusively, never
// .from("server_invites")/.from("servers"). That RPC is SECURITY DEFINER
// and granted to anon specifically so this works for a logged-out visitor
// too; a direct table query here would just fail for them (server_invites
// has no public SELECT policy, servers is member-only) and would also
// duplicate logic (status computation, already_member) that already lives
// server-side. preview_invite returns `returns table(...)`, so PostgREST
// always serializes it as an array (same as accept_invite) — data?.[0] is
// the real single row.
export function usePreviewInvite(code: string | undefined) {
  return useQuery({
    queryKey: ["invite-preview", code],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("preview_invite", { p_code: code! });
      if (error) throw error;
      return data?.[0] as InvitePreview;
    },
    enabled: Boolean(code),
  });
}

const MESSAGE_SELECT =
  "*, author:profiles(*), reactions:message_reactions(*), attachments:message_attachments(*)";

export function useMessages(channelId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ["messages", channelId];

  const query = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam }: { pageParam: string | null }) => {
      let q = supabase
        .from("messages")
        .select(MESSAGE_SELECT)
        .eq("channel_id", channelId!)
        .order("created_at", { ascending: false })
        .limit(MESSAGES_PAGE_SIZE);
      if (pageParam) q = q.lt("created_at", pageParam);
      const { data, error } = await q;
      if (error) throw error;
      return (data as unknown as MessageWithAuthor[]).reverse();
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) =>
      lastPage.length === MESSAGES_PAGE_SIZE ? lastPage[0].created_at : undefined,
    enabled: !!channelId,
  });

  useEffect(() => {
    if (!channelId) return;

    // One single-row fetch per realtime event, patched directly into
    // whichever page already holds it (or appended as new) — never a
    // refetch of every page the user has scrolled through.
    const refetchAndPatch = async (id: string) => {
      const { data } = await supabase
        .from("messages")
        .select(MESSAGE_SELECT)
        .eq("id", id)
        .maybeSingle();
      if (data) patchMessageInPages(queryClient, queryKey, data as unknown as MessageWithAuthor);
    };

    const channel = supabase
      .channel(`messages:${channelId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => refetchAndPatch(payload.new.id as string),
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => refetchAndPatch(payload.new.id as string),
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "messages",
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => removeMessageFromPages(queryClient, queryKey, payload.old.id as string),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "message_reactions" },
        (payload) => refetchAndPatch(payload.new.message_id as string),
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "message_reactions" },
        (payload) => refetchAndPatch(payload.old.message_id as string),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "message_attachments" },
        (payload) => refetchAndPatch(payload.new.message_id as string),
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "message_attachments" },
        (payload) => refetchAndPatch(payload.old.message_id as string),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  return {
    messages: query.data ? query.data.pages.flat() : [],
    isLoading: query.isLoading,
    hasOlderMessages: !!query.hasNextPage,
    loadingOlderMessages: query.isFetchingNextPage,
    loadOlderMessages: query.fetchNextPage,
  };
}

// Sends don't invalidate/refetch — the INSERT lands back through this same
// client's own realtime subscription (see useMessages above) and gets
// patched into the cache from there, so there's no separate round trip.
export function useSendMessage(channelId: string | undefined, authorId: string | undefined) {
  return useMutation({
    mutationFn: async (content: string) => {
      const { data, error } = await supabase
        .from("messages")
        .insert({ channel_id: channelId!, author_id: authorId!, content })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
  });
}

export function useEditMessage(channelId: string | undefined) {
  return useMutation({
    mutationFn: async ({ id, content }: { id: string; content: string }) => {
      const { error } = await supabase
        .from("messages")
        .update({ content, edited_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
  });
}

export function useDeleteMessage(channelId: string | undefined) {
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("messages").delete().eq("id", id);
      if (error) throw error;
    },
  });
}

function optimisticReactionRow(messageId: string, userId: string, emoji: string) {
  return {
    id: `optimistic-${crypto.randomUUID()}`,
    message_id: messageId,
    user_id: userId,
    emoji,
    created_at: new Date().toISOString(),
  };
}

export function useToggleReaction(channelId: string | undefined, userId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ["messages", channelId];

  return useMutation({
    mutationFn: async ({
      messageId,
      emoji,
      reacted,
    }: {
      messageId: string;
      emoji: string;
      reacted: boolean;
    }) => {
      if (reacted) {
        const { error } = await supabase
          .from("message_reactions")
          .delete()
          .eq("message_id", messageId)
          .eq("user_id", userId!)
          .eq("emoji", emoji);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("message_reactions")
          .insert({ message_id: messageId, user_id: userId!, emoji });
        if (error) throw error;
      }
    },
    onMutate: async ({ messageId, emoji, reacted }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous =
        queryClient.getQueryData<InfiniteData<MessageWithAuthor[], string | null>>(queryKey);
      updateMessageReactionsInPages<MessageWithAuthor, MessageWithAuthor["reactions"][number]>(
        queryClient,
        queryKey,
        messageId,
        (reactions) =>
          reacted
            ? reactions.filter((r) => !(r.user_id === userId && r.emoji === emoji))
            : [...reactions, optimisticReactionRow(messageId, userId!, emoji)],
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      toast.error("Não foi possível atualizar a reação. Tente novamente.");
    },
    // No onSettled invalidate — the DB write's own realtime echo (see
    // useMessages) patches the confirmed row in, and on success the
    // optimistic state above already matches it.
  });
}

export function invalidateServers(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: ["servers"] });
}

// --- Friends ---

export type FriendshipWithProfiles = Database["public"]["Tables"]["friendships"]["Row"] & {
  requester: Profile;
  recipient: Profile;
};

export function useFriendships(userId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ["friendships", userId];
  // Mounted in multiple places at once (sidebar + app shell) for the same
  // userId — same reasoning as useDmReadState below: Supabase reuses
  // realtime channel objects by topic name, so each instance needs its own
  // topic or a second .on() throws (channel already subscribed).
  const instanceId = useRef(crypto.randomUUID()).current;

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("friendships")
        .select(
          "*, requester:profiles!friendships_user_id_fkey(*), recipient:profiles!friendships_friend_id_fkey(*)",
        )
        .or(`user_id.eq.${userId},friend_id.eq.${userId}`);
      if (error) throw error;
      return data as unknown as FriendshipWithProfiles[];
    },
    enabled: !!userId,
  });

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`friendships:${userId}:${instanceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "friendships" }, () =>
        queryClient.invalidateQueries({ queryKey }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return query;
}

export function useSendFriendRequest(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (handle: string) => {
      // Typing "@handle" (mention-style, like Twitter/Discord) is a natural
      // instinct even though stored handles never include the "@" -- strip
      // it so both forms find the same profile.
      const cleanHandle = handle.trim().replace(/^@/, "");
      const { data: target, error: lookupError } = await supabase
        .from("profiles")
        .select("id")
        .ilike("handle", cleanHandle)
        .single();
      if (lookupError || !target) throw new Error("Usuário não encontrado.");
      if (target.id === userId) throw new Error("Você não pode adicionar a si mesmo.");
      const { error } = await supabase
        .from("friendships")
        .insert({ user_id: userId!, friend_id: target.id });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["friendships", userId] }),
  });
}

export function useRespondFriendRequest(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      otherUserId,
      action,
    }: {
      otherUserId: string;
      action: "accept" | "remove";
    }) => {
      if (action === "accept") {
        const { error } = await supabase
          .from("friendships")
          .update({ status: "accepted" })
          .eq("user_id", otherUserId)
          .eq("friend_id", userId!);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("friendships")
          .delete()
          .or(
            `and(user_id.eq.${userId},friend_id.eq.${otherUserId}),and(user_id.eq.${otherUserId},friend_id.eq.${userId})`,
          );
        if (error) throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["friendships", userId] }),
  });
}

export function useBlockFriendship(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (otherUserId: string) => {
      const { error } = await supabase
        .from("friendships")
        .update({ status: "blocked" })
        .or(
          `and(user_id.eq.${userId},friend_id.eq.${otherUserId}),and(user_id.eq.${otherUserId},friend_id.eq.${userId})`,
        );
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["friendships", userId] }),
  });
}

// --- Direct messages ---

type DmLastMessage = Pick<
  Database["public"]["Tables"]["dm_messages"]["Row"],
  "id" | "content" | "author_id" | "created_at"
>;

export type DmConversationWithProfiles = Database["public"]["Tables"]["dm_conversations"]["Row"] & {
  userA: Profile;
  userB: Profile;
  lastMessage: DmLastMessage | null;
};

export function useDmConversations(userId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ["dm-conversations", userId];
  // Same reasoning as useFriendships above — now mounted in both the app
  // shell (to resolve the active call's other participant) and the sidebar.
  const instanceId = useRef(crypto.randomUUID()).current;

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dm_conversations")
        .select(
          "*, userA:profiles!dm_conversations_user_a_fkey(*), userB:profiles!dm_conversations_user_b_fkey(*), last_message:dm_messages(id, content, author_id, created_at)",
        )
        .or(`user_a.eq.${userId},user_b.eq.${userId}`)
        .order("created_at", { foreignTable: "dm_messages", ascending: false })
        .limit(1, { foreignTable: "dm_messages" });
      if (error) throw error;
      const rows = (
        data as unknown as (DmConversationWithProfiles & { last_message: DmLastMessage[] })[]
      ).map((row) => ({ ...row, lastMessage: row.last_message?.[0] ?? null }));
      rows.sort((a, b) => {
        const aTime = a.lastMessage?.created_at ?? a.created_at;
        const bTime = b.lastMessage?.created_at ?? b.created_at;
        return new Date(bTime).getTime() - new Date(aTime).getTime();
      });
      return rows as DmConversationWithProfiles[];
    },
    enabled: !!userId,
  });

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`dm-conversations:${userId}:${instanceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "dm_conversations" }, () =>
        queryClient.invalidateQueries({ queryKey }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "dm_messages" }, () =>
        queryClient.invalidateQueries({ queryKey }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return query;
}

export type DmReadState = Database["public"]["Tables"]["dm_read_state"]["Row"];

export function useDmReadState(userId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ["dm-read-state", userId];
  // This hook is mounted in multiple places at once (sidebar + chat view) for the
  // same userId — Supabase reuses realtime channel objects by topic name, so each
  // instance needs its own topic or the second `.on()` call throws (channel already
  // subscribed by the first instance).
  const instanceId = useRef(crypto.randomUUID()).current;

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dm_read_state")
        .select("*")
        .eq("user_id", userId!);
      if (error) throw error;
      return data as DmReadState[];
    },
    enabled: !!userId,
  });

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`dm-read-state:${userId}:${instanceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "dm_read_state", filter: `user_id=eq.${userId}` },
        () => queryClient.invalidateQueries({ queryKey }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return query;
}

// The other participant's read receipt for a conversation — used to show
// "read" checkmarks on messages I sent. Requires the dm_read_state select
// policy to allow participants (not just the row owner) to see it.
export function useOtherDmReadState(
  conversationId: string | undefined,
  otherUserId: string | undefined,
) {
  const queryClient = useQueryClient();
  const queryKey = ["dm-read-state-other", conversationId, otherUserId];
  const instanceId = useRef(crypto.randomUUID()).current;

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dm_read_state")
        .select("*")
        .eq("conversation_id", conversationId!)
        .eq("user_id", otherUserId!)
        .maybeSingle();
      if (error) throw error;
      return data as DmReadState | null;
    },
    enabled: !!conversationId && !!otherUserId,
  });

  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`dm-read-state-other:${conversationId}:${instanceId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "dm_read_state",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => queryClient.invalidateQueries({ queryKey }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, otherUserId]);

  return query;
}

export function useMarkDmRead(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (conversationId: string) => {
      const { error } = await supabase.from("dm_read_state").upsert(
        {
          conversation_id: conversationId,
          user_id: userId!,
          last_read_at: new Date().toISOString(),
        },
        { onConflict: "conversation_id,user_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dm-read-state", userId] }),
  });
}

export function useDmCalls(conversationId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ["dm-calls-log", conversationId];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dm_calls")
        .select("*")
        .eq("conversation_id", conversationId!)
        .order("started_at");
      if (error) throw error;
      return data as DmCallRow[];
    },
    enabled: !!conversationId,
  });

  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`dm-calls-log:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "dm_calls",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => queryClient.invalidateQueries({ queryKey }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  return query;
}

export function useGetOrCreateDm() {
  return useMutation({
    mutationFn: async (otherUserId: string) => {
      const { data, error } = await supabase.rpc("get_or_create_dm", {
        other_user_id: otherUserId,
      });
      if (error) throw error;
      return data as string;
    },
  });
}

export type DmMessageWithAuthor = Database["public"]["Tables"]["dm_messages"]["Row"] & {
  author: Profile;
  reactions: Database["public"]["Tables"]["dm_message_reactions"]["Row"][];
  attachments: DmAttachment[];
};

const DM_MESSAGE_SELECT =
  "*, author:profiles(*), reactions:dm_message_reactions(*), attachments:dm_message_attachments(*)";

export function useDmMessages(conversationId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ["dm-messages", conversationId];

  const query = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam }: { pageParam: string | null }) => {
      let q = supabase
        .from("dm_messages")
        .select(DM_MESSAGE_SELECT)
        .eq("conversation_id", conversationId!)
        .order("created_at", { ascending: false })
        .limit(MESSAGES_PAGE_SIZE);
      if (pageParam) q = q.lt("created_at", pageParam);
      const { data, error } = await q;
      if (error) throw error;
      return (data as unknown as DmMessageWithAuthor[]).reverse();
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) =>
      lastPage.length === MESSAGES_PAGE_SIZE ? lastPage[0].created_at : undefined,
    enabled: !!conversationId,
  });

  useEffect(() => {
    if (!conversationId) return;

    const refetchAndPatch = async (id: string) => {
      const { data } = await supabase
        .from("dm_messages")
        .select(DM_MESSAGE_SELECT)
        .eq("id", id)
        .maybeSingle();
      if (data) patchMessageInPages(queryClient, queryKey, data as unknown as DmMessageWithAuthor);
    };

    const channel = supabase
      .channel(`dm-messages:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "dm_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => refetchAndPatch(payload.new.id as string),
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "dm_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => refetchAndPatch(payload.new.id as string),
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "dm_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => removeMessageFromPages(queryClient, queryKey, payload.old.id as string),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "dm_message_reactions" },
        (payload) => refetchAndPatch(payload.new.dm_message_id as string),
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "dm_message_reactions" },
        (payload) => refetchAndPatch(payload.old.dm_message_id as string),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "dm_message_attachments" },
        (payload) => refetchAndPatch(payload.new.dm_message_id as string),
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "dm_message_attachments" },
        (payload) => refetchAndPatch(payload.old.dm_message_id as string),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  return {
    messages: query.data ? query.data.pages.flat() : [],
    isLoading: query.isLoading,
    hasOlderMessages: !!query.hasNextPage,
    loadingOlderMessages: query.isFetchingNextPage,
    loadOlderMessages: query.fetchNextPage,
  };
}

export function useSendDmMessage(conversationId: string | undefined, authorId: string | undefined) {
  return useMutation({
    mutationFn: async (content: string) => {
      const { data, error } = await supabase
        .from("dm_messages")
        .insert({ conversation_id: conversationId!, author_id: authorId!, content })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
  });
}

export function useEditDmMessage(conversationId: string | undefined) {
  return useMutation({
    mutationFn: async ({ id, content }: { id: string; content: string }) => {
      const { error } = await supabase
        .from("dm_messages")
        .update({ content, edited_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
  });
}

export function useDeleteDmMessage(conversationId: string | undefined) {
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("dm_messages").delete().eq("id", id);
      if (error) throw error;
    },
  });
}

function optimisticDmReactionRow(dmMessageId: string, userId: string, emoji: string) {
  return {
    id: `optimistic-${crypto.randomUUID()}`,
    dm_message_id: dmMessageId,
    user_id: userId,
    emoji,
    created_at: new Date().toISOString(),
  };
}

export function useToggleDmReaction(
  conversationId: string | undefined,
  userId: string | undefined,
) {
  const queryClient = useQueryClient();
  const queryKey = ["dm-messages", conversationId];

  return useMutation({
    mutationFn: async ({
      messageId,
      emoji,
      reacted,
    }: {
      messageId: string;
      emoji: string;
      reacted: boolean;
    }) => {
      if (reacted) {
        const { error } = await supabase
          .from("dm_message_reactions")
          .delete()
          .eq("dm_message_id", messageId)
          .eq("user_id", userId!)
          .eq("emoji", emoji);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("dm_message_reactions")
          .insert({ dm_message_id: messageId, user_id: userId!, emoji });
        if (error) throw error;
      }
    },
    onMutate: async ({ messageId, emoji, reacted }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous =
        queryClient.getQueryData<InfiniteData<DmMessageWithAuthor[], string | null>>(queryKey);
      updateMessageReactionsInPages<DmMessageWithAuthor, DmMessageWithAuthor["reactions"][number]>(
        queryClient,
        queryKey,
        messageId,
        (reactions) =>
          reacted
            ? reactions.filter((r) => !(r.user_id === userId && r.emoji === emoji))
            : [...reactions, optimisticDmReactionRow(messageId, userId!, emoji)],
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      toast.error("Não foi possível atualizar a reação. Tente novamente.");
    },
    // No onSettled invalidate — see useToggleReaction's identical comment.
  });
}

// --- Profile media (avatar / banner uploads to Storage) ---

function profileMediaBucket(kind: "avatar" | "banner") {
  return kind === "avatar" ? "avatars" : "profile-banners";
}

function profileMediaPath(userId: string, file: File) {
  const ext = file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase();
  return `${userId}/${crypto.randomUUID()}.${ext}`;
}

export async function uploadProfileImage(
  userId: string,
  file: File,
  kind: "avatar" | "banner",
): Promise<string> {
  const bucket = profileMediaBucket(kind);
  const path = profileMediaPath(userId, file);
  const { error } = await supabase.storage.from(bucket).upload(path, file);
  if (error) throw error;
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

// Best-effort cleanup of the file a photo is replacing/removing — an
// orphaned object in Storage costs disk space, not correctness, so failures
// here are swallowed rather than blocking the profile save.
export async function deleteProfileImage(
  kind: "avatar" | "banner",
  url: string | null | undefined,
) {
  if (!url) return;
  const bucket = profileMediaBucket(kind);
  const marker = `/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return;
  const path = url.slice(idx + marker.length);
  try {
    await supabase.storage.from(bucket).remove([path]);
  } catch {
    // ignore
  }
}

// --- Attachments ---

export function useUploadAttachment() {
  return useMutation({
    mutationFn: async ({ channelId, file }: { channelId: string; file: File }) => {
      const path = `${channelId}/${crypto.randomUUID()}-${file.name}`;
      const { error } = await supabase.storage.from("attachments").upload(path, file);
      if (error) throw error;
      return {
        path,
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
      };
    },
  });
}

// No onSuccess invalidate — the insert's own realtime echo (see useMessages)
// patches the message's attachments in once the row lands.
export function useAddAttachment() {
  return useMutation({
    mutationFn: async (params: {
      messageId: string;
      path: string;
      name: string;
      type: string;
      size: number;
    }) => {
      const { error } = await supabase.from("message_attachments").insert({
        message_id: params.messageId,
        path: params.path,
        name: params.name,
        type: params.type,
        size: params.size,
      });
      if (error) throw error;
    },
  });
}

export function useAttachmentUrl(path: string) {
  return useQuery({
    queryKey: ["attachment-url", path],
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from("attachments")
        .createSignedUrl(path, 3600);
      if (error) throw error;
      return data.signedUrl;
    },
    staleTime: 55 * 60 * 1000,
  });
}

// Same shape as the channel attachment trio above, just pointed at the
// separate 'dm-attachments' bucket/table (kept separate rather than shared
// so storage RLS can check channel membership vs. DM participation off a
// single, unambiguous path convention per bucket).
export function useUploadDmAttachment() {
  return useMutation({
    mutationFn: async ({ conversationId, file }: { conversationId: string; file: File }) => {
      const path = `${conversationId}/${crypto.randomUUID()}-${file.name}`;
      const { error } = await supabase.storage.from("dm-attachments").upload(path, file);
      if (error) throw error;
      return {
        path,
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
      };
    },
  });
}

// No onSuccess invalidate — the insert's own realtime echo (see
// useDmMessages) patches the message's attachments in once the row lands.
export function useAddDmAttachment() {
  return useMutation({
    mutationFn: async (params: {
      dmMessageId: string;
      path: string;
      name: string;
      type: string;
      size: number;
    }) => {
      const { error } = await supabase.from("dm_message_attachments").insert({
        dm_message_id: params.dmMessageId,
        path: params.path,
        name: params.name,
        type: params.type,
        size: params.size,
      });
      if (error) throw error;
    },
  });
}

export function useDmAttachmentUrl(path: string) {
  return useQuery({
    queryKey: ["dm-attachment-url", path],
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from("dm-attachments")
        .createSignedUrl(path, 3600);
      if (error) throw error;
      return data.signedUrl;
    },
    staleTime: 55 * 60 * 1000,
  });
}

// --- Notifications ---

export type Notification = Database["public"]["Tables"]["notifications"]["Row"];

export function useNotifications(userId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ["notifications", userId];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", userId!)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data as Notification[];
    },
    enabled: !!userId,
  });

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => queryClient.invalidateQueries({ queryKey }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return query;
}

export function useMarkNotificationRead(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("notifications").update({ read: true }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications", userId] }),
  });
}

// --- Search ---

export type SearchResult = Database["public"]["Tables"]["messages"]["Row"] & {
  channel: Pick<Channel, "id" | "name">;
  author: Profile;
};

export function useSearchMessages(channelIds: string[], query: string) {
  return useQuery({
    queryKey: ["search-messages", channelIds, query],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("*, channel:channels(id, name), author:profiles(*)")
        .in("channel_id", channelIds)
        .ilike("content", `%${query}%`)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as unknown as SearchResult[];
    },
    enabled: channelIds.length > 0 && query.trim().length >= 2,
  });
}
