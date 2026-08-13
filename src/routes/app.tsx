import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Hash,
  Volume2,
  MessageSquareText,
  Plus,
  Settings,
  Search,
  Bell,
  Send,
  Smile,
  Paperclip,
  Gift,
  Reply,
  Pencil,
  Trash2,
  MoreHorizontal,
  Users,
  UserRound,
  Inbox,
  Pin,
  ChevronDown,
  X,
  Mic,
  MicOff,
  Headphones,
  HeadphoneOff,
  Clapperboard,
  Loader2,
  MessageCircle,
  FileText,
  Download,
  UserPlus,
  UserX,
  LogOut,
  Check,
  Shield,
  ShieldCheck,
  Copy,
  Ban,
} from "lucide-react";
import { toast } from "sonner";
import { DexyLogo } from "@/components/DexyLogo";
import { StudioView } from "@/components/StudioView";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { DmProfilePanel } from "@/components/DmProfilePanel";
import { ProfileEditor } from "@/components/ProfileEditor";
import { LinkAccountDialog } from "@/components/LinkAccountDialog";
import { ReactionButton, ReactionList, ReactionPicker } from "@/components/MessageReactions";
import { ProfilePopoverProvider, useProfilePopover } from "@/components/ProfilePopover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useDmCall, type DmCallHook, type VoiceRoomHook } from "@/lib/livekit";
import {
  useCallSounds,
  useReconnectingSound,
  useScreenShareSound,
  useMuteToggleSound,
  setSoundEnabled,
} from "@/lib/callSounds";
import {
  avatarFor,
  formatFileSize,
  resolvePresenceStatus,
  statusColor,
  statusLabel,
  type UserStatus,
} from "@/lib/format";
import { useIsUserOnline, useOnlineUserIds, usePresenceConnection } from "@/lib/presence";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/auth";
import { markGuestSignedOut } from "@/lib/guestDevice";
import {
  useAddAttachment,
  useAssignRole,
  useAttachmentUrl,
  useChannels,
  useCreateChannel,
  useCreateInvite,
  useCreateRole,
  useCreateServer,
  useDeleteChannel,
  useDeleteMessage,
  useDeleteRole,
  useDeleteServer,
  useDmConversations,
  useEditMessage,
  useGetOrCreateDm,
  useKickMember,
  useLeaveServer,
  useMarkNotificationRead,
  useMembers,
  useMessages,
  useNotifications,
  usePermissions,
  useProfile,
  useReorderChannels,
  useRevokeInvite,
  useRolePermissions,
  useSearchMessages,
  useSendMessage,
  useServerInvites,
  useServerRoles,
  useServers,
  useSetRolePermission,
  useToggleReaction,
  useUpdateChannel,
  useUpdateRole,
  useUpdateServer,
  useUpdateProfile,
  useUploadAttachment,
  PERMISSION_CATALOG,
  type Attachment,
  type MemberWithProfile,
  type MessageWithAuthor,
  type Notification,
  type PermissionKey,
  type SearchResult,
  type ServerInvite,
  type ServerRole,
} from "@/lib/queries";
import type { Database } from "@/lib/database.types";

const VoiceRoomView = lazy(() =>
  import("@/components/VoiceRoomView").then((m) => ({ default: m.VoiceRoomView })),
);
const DmSidebar = lazy(() =>
  import("@/components/DirectMessages").then((m) => ({ default: m.DmSidebar })),
);
const DmChatView = lazy(() =>
  import("@/components/DirectMessages").then((m) => ({ default: m.DmChatView })),
);

export const Route = createFileRoute("/app")({
  // Optional deep-link target, e.g. /app?server=<id> after accepting an
  // invite. Just an id, not a redirect URL, so no path-shape validation is
  // needed the way /login's `redirect` needs — an unrecognized value simply
  // never matches anything in `servers` and the existing fallback selection
  // effect below takes over, so there's no unsafe value this could hold.
  validateSearch: (search: Record<string, unknown>): { server?: string } => ({
    server: typeof search.server === "string" ? search.server : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Dexy — Aplicação" },
      {
        name: "description",
        content: "Espaço de trabalho do Dexy — conversas, canais e comunidades.",
      },
    ],
  }),
  component: AppPage,
});

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Server = Database["public"]["Tables"]["servers"]["Row"];
type Channel = Database["public"]["Tables"]["channels"]["Row"];
type ChannelType = "text" | "voice" | "forum";

const channelIcon: Record<ChannelType, typeof Hash> = {
  text: Hash,
  voice: Volume2,
  forum: MessageSquareText,
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

type PanelView = "chat" | "profile" | "settings";
type PanelViewExt = PanelView | "studio";

function AppPage() {
  const router = useRouter();
  const session = useSession();
  const userId = session?.user.id;
  const { server: deepLinkServerId } = Route.useSearch();

  const { data: profile, isError: profileError } = useProfile(userId);
  // A session can outlive the account behind it -- most commonly an
  // expired/deleted guest account still open in a tab. useProfile()'s
  // .single() throws (never resolves data) when the row is gone, so without
  // this the app is stuck on LoadingScreen forever instead of recovering.
  useEffect(() => {
    if (profileError) {
      void supabase.auth.signOut().finally(() => router.navigate({ to: "/login" }));
    }
  }, [profileError, router]);
  const { data: servers = [] } = useServers();
  const [activeServer, setActiveServer] = useState<string | undefined>(undefined);
  const { data: channels = [] } = useChannels(activeServer);
  const reorderChannels = useReorderChannels();
  const [activeChannel, setActiveChannel] = useState<string | undefined>(undefined);
  const { data: members = [] } = useMembers(activeServer);
  const { data: serverRoles = [] } = useServerRoles(activeServer);
  const assignRole = useAssignRole();
  const { hasPermission } = usePermissions(activeServer, userId);
  const { messages, hasOlderMessages, loadingOlderMessages, loadOlderMessages } =
    useMessages(activeChannel);

  const sendMessage = useSendMessage(activeChannel, userId);
  const editMessage = useEditMessage(activeChannel);
  const deleteMessage = useDeleteMessage(activeChannel);
  const toggleReaction = useToggleReaction(activeChannel, userId);
  const updateProfile = useUpdateProfile(userId);
  const uploadAttachment = useUploadAttachment();
  const addAttachment = useAddAttachment();
  const { data: notifications = [] } = useNotifications(userId);
  const markNotificationRead = useMarkNotificationRead(userId);
  // Single app-wide Realtime Presence connection — the source of truth for
  // "is this account actually connected right now", independent of
  // profile.status (the manual online/idle/dnd/offline preference). See
  // src/lib/presence.ts.
  usePresenceConnection(userId);

  const [draft, setDraft] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [view, setView] = useState<PanelViewExt>("chat");
  const [membersOpen, setMembersOpen] = useState(true);
  const [dmProfileOpen, setDmProfileOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [railMode, setRailMode] = useState<"servers" | "dm">("dm");
  const [createServerOpen, setCreateServerOpen] = useState(false);
  const [linkAccountOpen, setLinkAccountOpen] = useState(false);
  // Prompt guests to link an account once per visit, right away -- the
  // bottom banner alone is easy to miss, and this is the moment they're
  // most likely to actually act on it.
  useEffect(() => {
    if (session?.user.is_anonymous) setLinkAccountOpen(true);
  }, [session?.user.is_anonymous]);
  const [editServerOpen, setEditServerOpen] = useState(false);
  const [deleteServerOpen, setDeleteServerOpen] = useState(false);
  const [createChannelOpen, setCreateChannelOpen] = useState(false);
  const [editChannelOpen, setEditChannelOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<Channel | undefined>(undefined);
  const [deleteChannelOpen, setDeleteChannelOpen] = useState(false);
  const [deletingChannel, setDeletingChannel] = useState<Channel | undefined>(undefined);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [kickMemberOpen, setKickMemberOpen] = useState(false);
  const [kickingMember, setKickingMember] = useState<MemberWithProfile | undefined>(undefined);
  const [leaveServerOpen, setLeaveServerOpen] = useState(false);
  const [rolesManagerOpen, setRolesManagerOpen] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | undefined>(undefined);
  const [activeDmProfile, setActiveDmProfile] = useState<Profile | undefined>(undefined);
  const [deafened, setDeafened] = useState(false);
  const [activeVoice, setActiveVoice] = useState<VoiceRoomHook | null>(null);

  // The call itself lives here, above any single conversation view, so it
  // survives switching conversations or leaving DM mode entirely — it used
  // to live inside DmChatView and hang up the moment that view unmounted.
  // While idle, it tracks whichever DM you're currently looking at (so the
  // call/video buttons and incoming-call detection work there); once a call
  // actually starts, it locks onto that conversation until the call ends,
  // ignoring further navigation.
  const [callConversationId, setCallConversationId] = useState<string | undefined>(undefined);
  const dmCall = useDmCall(callConversationId, userId);
  useCallSounds(dmCall.status);
  useReconnectingSound(dmCall.reconnecting);
  useScreenShareSound(dmCall.screenShareEnabled);
  useMuteToggleSound(dmCall.status !== "idle" && !dmCall.micEnabled);
  useMuteToggleSound(deafened);
  useEffect(() => {
    if (dmCall.status === "idle") setCallConversationId(activeConversationId);
  }, [activeConversationId, dmCall.status]);

  const { data: dmConversations = [] } = useDmConversations(userId);

  // Shared by every "Mensagem" action in the profile popover (message rows,
  // members panel, DM header) — same get-or-create-then-navigate flow
  // DmSidebar's own onOpenConversation already uses.
  const getOrCreateDm = useGetOrCreateDm();
  const openDmFromPopover = async (targetProfile: Profile) => {
    try {
      const conversationId = await getOrCreateDm.mutateAsync(targetProfile.id);
      setActiveConversationId(conversationId);
      setActiveDmProfile(targetProfile);
      setRailMode("dm");
      setView("chat");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível abrir a conversa.");
    }
  };

  const callOtherProfile = useMemo(() => {
    const conv = dmConversations.find((c) => c.id === dmCall.call?.conversation_id);
    if (!conv || !userId) return undefined;
    return conv.user_a === userId ? conv.userB : conv.userA;
  }, [dmConversations, dmCall.call?.conversation_id, userId]);

  // Opening "Mensagens diretas" with nothing picked yet lands on the most
  // recent conversation (dmConversations is already sorted newest-first)
  // instead of the empty "selecione um amigo" placeholder.
  useEffect(() => {
    if (railMode !== "dm" || activeConversationId || dmConversations.length === 0 || !userId)
      return;
    const mostRecent = dmConversations[0];
    setActiveConversationId(mostRecent.id);
    setActiveDmProfile(mostRecent.user_a === userId ? mostRecent.userB : mostRecent.userA);
  }, [railMode, activeConversationId, dmConversations, userId]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const channelIds = useMemo(() => channels.map((c) => c.id), [channels]);
  const { data: searchResults = [], isFetching: searching } = useSearchMessages(
    channelIds,
    searchQuery,
  );

  useEffect(() => {
    if (session === null) router.navigate({ to: "/" });
  }, [session, router]);

  // Also covers "the server that was active got deleted" — not just "none
  // picked yet" — so deleting the current server lands you on another
  // existing one instead of pointing at an id that no longer exists.
  useEffect(() => {
    if (servers.length === 0) return;
    if (!activeServer || !servers.some((s) => s.id === activeServer)) {
      setActiveServer(servers[0].id);
    }
  }, [servers, activeServer]);

  // Deep-link from /app?server=<id> (currently only reached right after
  // accepting an invite). Separate from the fallback effect above on
  // purpose: `servers` may still be refetching the newly-joined server when
  // this component first mounts (useAcceptInvite's onSuccess only just
  // invalidated the query), so the fallback effect above could already have
  // locked onto servers[0] before the real target shows up. This effect
  // keeps re-checking independently and corrects to the intended server the
  // moment it actually appears in `servers`, instead of only running once.
  useEffect(() => {
    if (!deepLinkServerId) return;
    if (servers.some((s) => s.id === deepLinkServerId) && activeServer !== deepLinkServerId) {
      setActiveServer(deepLinkServerId);
      setRailMode("servers");
    }
  }, [deepLinkServerId, servers, activeServer]);

  useEffect(() => {
    if (channels.length > 0 && !channels.some((c) => c.id === activeChannel)) {
      setActiveChannel(channels[0].id);
    }
  }, [channels, activeChannel]);

  // Comes online once per app session per user (e.g. the previous session
  // left you "offline" and you've now reopened the app) — keyed by userId,
  // not a boolean, so switching users without a full unmount is treated as
  // a new session instead of inheriting the previous user's "already
  // online" flag. Must NOT depend on profile.status, or it re-fires and
  // stomps a manual idle/dnd choice made mid-session right back to "online".
  const cameOnlineForUserRef = useRef<string | null>(null);
  useEffect(() => {
    if (userId && profile && cameOnlineForUserRef.current !== userId) {
      cameOnlineForUserRef.current = userId;
      if (profile.status !== "online") {
        updateProfile.mutate({ status: "online" });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, profile]);

  // "Sons" in Configurações → Notificações — one central gate in
  // callSounds.ts covers message/call/mute/screen-share sounds app-wide.
  useEffect(() => {
    setSoundEnabled(profile?.notify_sound ?? true);
  }, [profile?.notify_sound]);

  const normalizeCategory = (c: string) => c.trim().toLowerCase();

  // Grouped by a normalized key so category names that only differ by
  // casing/whitespace (e.g. "Geral" vs "geral") visually merge into one
  // group instead of silently splitting — a real display gap found during
  // the channel-reordering audit. The raw `category` value stored on each
  // channel is never rewritten by this; `label` is just whichever raw
  // spelling was seen first for that group — used for display, and as the
  // canonical value a channel dragged INTO that group adopts.
  const categorized = useMemo(() => {
    const map = new Map<string, { label: string; items: Channel[] }>();
    channels.forEach((c) => {
      const key = normalizeCategory(c.category);
      const entry = map.get(key);
      if (entry) {
        entry.items.push(c);
      } else {
        map.set(key, { label: c.category, items: [c] });
      }
    });
    return Array.from(map.entries());
  }, [channels]);

  const channelsById = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);

  // Suggestions for the category field in ChannelFormDialog — reuses
  // whatever categories already exist on this server instead of inventing a
  // separate category-management concept. One suggestion per normalized
  // group (its canonical label), not one per raw string variant.
  const existingCategories = useMemo(() => categorized.map(([, { label }]) => label), [categorized]);

  // --- Channel drag-and-drop reordering ---
  // `dragItems` is a live working copy (normalized category key -> ordered
  // channel ids) that only exists while a drag is in progress; null the
  // rest of the time, in which case rendering falls back to `categorized`
  // (the real query-driven order). Kept separate from `channels` instead of
  // mutated in place, since that's React Query cache data, not local state.
  const [dragItems, setDragItems] = useState<Record<string, string[]> | null>(null);
  const dragOriginRef = useRef<{ id: string; container: string } | null>(null);

  const displayCategorized = useMemo(() => {
    if (!dragItems) return categorized;
    const labelByKey = new Map(categorized.map(([key, { label }]) => [key, label]));
    return Object.entries(dragItems)
      .map(([key, ids]) => {
        const items = ids
          .map((id) => channelsById.get(id))
          .filter((c): c is Channel => !!c);
        return [key, { label: labelByKey.get(key) ?? key, items }] as const;
      })
      .filter(([, { items }]) => items.length > 0);
  }, [dragItems, categorized, channelsById]);

  function findDragContainer(items: Record<string, string[]>, id: string): string | undefined {
    if (id in items) return id;
    return Object.keys(items).find((key) => items[key].includes(id));
  }

  // Small distance threshold so a plain click (select/edit/delete) doesn't
  // get misread as a drag — only real pointer movement starts a sort.
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  function handleDragStart(event: DragStartEvent) {
    const seeded: Record<string, string[]> = {};
    categorized.forEach(([key, { items }]) => {
      seeded[key] = items.map((c) => c.id);
    });
    const activeId = String(event.active.id);
    const container = findDragContainer(seeded, activeId);
    dragOriginRef.current = container ? { id: activeId, container } : null;
    setDragItems(seeded);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    setDragItems((prev) => {
      if (!prev) return prev;
      const activeId = String(active.id);
      const overId = String(over.id);
      const activeContainer = findDragContainer(prev, activeId);
      const overContainer = findDragContainer(prev, overId);
      if (!activeContainer || !overContainer || activeContainer === overContainer) return prev;

      const activeItems = prev[activeContainer];
      const overItems = prev[overContainer];
      const overIndex = overItems.indexOf(overId);
      const newIndex = overIndex >= 0 ? overIndex : overItems.length;
      return {
        ...prev,
        [activeContainer]: activeItems.filter((id) => id !== activeId),
        [overContainer]: [...overItems.slice(0, newIndex), activeId, ...overItems.slice(newIndex)],
      };
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const finalItems = dragItems;
    const origin = dragOriginRef.current;
    setDragItems(null);
    dragOriginRef.current = null;
    if (!finalItems || !over || !origin || !activeServer) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    const container = findDragContainer(finalItems, activeId);
    let workingItems = finalItems;

    // Cross-container placement already happened live via handleDragOver;
    // what's left is finalizing a same-container reorder on drop.
    if (container) {
      const overContainer = findDragContainer(finalItems, overId);
      if (overContainer === container) {
        const items = finalItems[container];
        const oldIndex = items.indexOf(activeId);
        const newIndex = items.indexOf(overId);
        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          workingItems = { ...finalItems, [container]: arrayMove(items, oldIndex, newIndex) };
        }
      }
    }

    const finalContainer = findDragContainer(workingItems, activeId);
    const crossedCategory = !!finalContainer && finalContainer !== origin.container;
    const labelByKey = new Map(categorized.map(([key, { label }]) => [key, label]));

    // Always recompute the FULL, contiguous 0..N-1 sequence across every
    // category in its original (never-reordered-among-themselves) order —
    // this is what self-heals any pre-existing gaps/duplicates on every
    // drop, not just an incremental patch around the moved item.
    const recomputed: Channel[] = [];
    let position = 0;
    let changed = false;
    for (const [key] of categorized) {
      const ids = workingItems[key] ?? [];
      for (const id of ids) {
        const original = channelsById.get(id);
        if (!original) continue;
        const category =
          id === activeId && crossedCategory ? (labelByKey.get(key) ?? original.category) : original.category;
        if (original.position !== position || original.category !== category) changed = true;
        recomputed.push({ ...original, position, category });
        position++;
      }
    }

    if (!changed) return;
    reorderChannels.mutate({ serverId: activeServer, channels: recomputed });
  }

  function handleDragCancel() {
    setDragItems(null);
    dragOriginRef.current = null;
  }

  if (session === undefined) {
    return <LoadingScreen />;
  }
  if (!session) {
    return null;
  }
  if (!profile) {
    return <LoadingScreen />;
  }

  // Distinct from the LoadingScreen guard below: this is a genuinely empty,
  // permanent state (no server to ever load), not something still loading —
  // showing a spinner forever here would be exactly the bug excluding a
  // server was supposed to avoid. Not reachable in normal use today (every
  // account keeps its Dexy HQ membership, there's no "leave server" yet),
  // but excluir servidor makes it reachable in principle, so it needs a
  // real answer instead of an assumption.
  if (servers.length === 0) {
    return (
      <NoServersScreen
        onCreated={(server) => {
          setActiveServer(server.id);
          setRailMode("servers");
          setView("chat");
        }}
      />
    );
  }

  const channel = channels.find((c) => c.id === activeChannel);
  if (!activeServer || !channel) {
    return <LoadingScreen />;
  }

  const activeServerObj = servers.find((s) => s.id === activeServer);
  const isServerOwner = !!activeServerObj && activeServerObj.owner_id === userId;
  // Etapa 5.7 — each is `isServerOwner || hasPermission(...)`, never a
  // replacement, matching the exact rule the backend RLS has followed
  // since Etapa 5.2. hasPermission() itself never touches role_permissions
  // directly (it's a thin wrapper around the has_permission() RPC).
  const canManageChannels = isServerOwner || hasPermission("manage_channels");
  const canManageInvites = isServerOwner || hasPermission("manage_invites");
  const canManageRoles = isServerOwner || hasPermission("manage_roles");
  const canKickMembers = isServerOwner || hasPermission("kick_members");
  const canAssignRoles = isServerOwner || hasPermission("assign_roles");
  const canModerateMessages = isServerOwner || hasPermission("moderate_messages");

  const send = async () => {
    const text = draft.trim();
    if (!text && !pendingFile) return;
    setAttachError(null);
    try {
      const message = await sendMessage.mutateAsync(text);
      if (pendingFile && message) {
        const uploaded = await uploadAttachment.mutateAsync({
          channelId: channel.id,
          file: pendingFile,
        });
        await addAttachment.mutateAsync({ messageId: message.id, ...uploaded });
      }
      setDraft("");
      setPendingFile(null);
    } catch {
      setAttachError("Não foi possível enviar. Tente novamente.");
    }
  };

  const handlePickFile = (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      setAttachError("Arquivo muito grande (máx. 10MB).");
      return;
    }
    setAttachError(null);
    setPendingFile(file);
  };

  const handleNotificationClick = (n: Notification) => {
    markNotificationRead.mutate(n.id);
    if (n.type === "dm_message" && n.related_id) {
      // related_id is the conversation_id (notify_dm_message() trigger).
      // dmConversations is already scoped to conversations this user
      // participates in (RLS + the .or(user_a.eq/user_b.eq) filter in
      // useDmConversations), so a related_id the user isn't part of simply
      // won't be found here — same fallback as "not found yet", never an
      // arbitrary conversation. Same 4-call pattern as openDmFromPopover.
      const conv = dmConversations.find((c) => c.id === n.related_id);
      if (conv && userId) {
        setActiveConversationId(conv.id);
        setActiveDmProfile(conv.user_a === userId ? conv.userB : conv.userA);
      }
      setRailMode("dm");
      setView("chat");
    } else if (n.type === "friend_request" || n.type === "friend_request_accepted") {
      // "friend_request_accepted" isn't emitted yet -- that trigger is a
      // proposed, not-yet-applied migration (see Fase 2 report). Handled
      // here in advance so it behaves correctly the moment it lands.
      setRailMode("dm");
      setView("chat");
    }
    setNotificationsOpen(false);
  };

  const handleSearchSelect = (r: SearchResult) => {
    setActiveChannel(r.channel.id);
    setSearchQuery("");
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleReact = (mid: string, emoji: string) => {
    const msg = messages.find((m) => m.id === mid);
    const already = msg?.reactions.some((r) => r.user_id === userId && r.emoji === emoji) ?? false;
    toggleReaction.mutate({ messageId: mid, emoji, reacted: already });
  };

  const signOut = async () => {
    // Best-effort — actual presence is driven by the Realtime channel
    // dropping on disconnect, not by this flag, so a failed write here
    // must never block sign-out.
    if (userId) {
      try {
        await updateProfile.mutateAsync({ status: "offline" });
      } catch {
        // ignore — see comment above
      }
    }
    if (session?.user.is_anonymous) {
      markGuestSignedOut();
    }
    await supabase.auth.signOut();
    router.navigate({ to: "/" });
  };

  return (
    <ProfilePopoverProvider myId={userId} onEditProfile={() => setView("profile")} onMessage={openDmFromPopover} onSignOut={signOut}>
    {session?.user.is_anonymous && (
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-full bg-card border border-border shadow-(--shadow-glow) px-4 py-2 text-xs">
        <span className="text-muted-foreground">
          Você está em modo convidado — vincule um e-mail pra não perder sua conta.
        </span>
        <button
          onClick={() => setLinkAccountOpen(true)}
          className="font-semibold text-primary-foreground rounded-full px-3 py-1 transition hover:brightness-110"
          style={{ backgroundImage: "var(--gradient-dexy)" }}
        >
          Vincular
        </button>
      </div>
    )}
    <LinkAccountDialog open={linkAccountOpen} onOpenChange={setLinkAccountOpen} />
    <div
      data-app-theme={profile?.app_theme ?? "cyan"}
      className="h-dvh w-screen overflow-hidden bg-background text-foreground flex gap-4 p-5"
    >
      {/* Below md, rail + sidebar become one off-canvas drawer (fixed,
          slides in from the left with a backdrop) instead of just
          disappearing -- toggled by the same `mobileSidebar` state the
          hamburger button already drives. At md+ this collapses back to
          the exact current desktop layout: both permanently visible,
          in normal flow, unaffected by `mobileSidebar`. */}
      {mobileSidebar && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-black/50"
          onClick={() => setMobileSidebar(false)}
        />
      )}
      {/* Rail + channels/DM sidebar share one rounded block, no gap between them */}
      <div
        className={`flex bg-sidebar overflow-hidden transition-transform duration-200 ease-out fixed inset-y-0 left-0 z-40 w-[min(90vw,360px)] rounded-r-2xl md:static md:z-auto md:w-auto md:translate-x-0 md:rounded-[18px] ${
          mobileSidebar ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Server rail */}
        <aside className="flex w-[72px] shrink-0 flex-col items-center gap-2 py-3">
          <Link to="/" className="mb-2">
            <DexyLogo size={48} />
          </Link>
          <button
            onClick={() => {
              setRailMode("dm");
              setView("chat");
            }}
            className={`w-12 h-12 grid place-items-center transition-all ${
              railMode === "dm"
                ? "rounded-2xl text-primary-foreground shadow-(--shadow-glow)"
                : "rounded-3xl bg-card text-muted-foreground hover:rounded-2xl hover:bg-secondary"
            }`}
            style={railMode === "dm" ? { backgroundImage: "var(--gradient-dexy)" } : undefined}
            title="Mensagens diretas"
          >
            <MessageCircle className="w-5 h-5" />
          </button>
          <div className="w-8 h-px bg-border" />
          {servers.map((s: Server) => {
            const active = railMode === "servers" && s.id === activeServer;
            return (
              <button
                key={s.id}
                onClick={() => {
                  setActiveServer(s.id);
                  setRailMode("servers");
                }}
                className="group relative"
                title={s.name}
              >
                <span
                  className={`absolute -left-3 top-1/2 -translate-y-1/2 w-1 rounded-r-full bg-primary transition-all ${
                    active ? "h-8" : "h-0 group-hover:h-4"
                  }`}
                />
                <div
                  className={`w-12 h-12 grid place-items-center text-white font-bold bg-gradient-to-br ${
                    s.color ?? "from-[#00D8FF] to-[#8DFF2F]"
                  } transition-all ${
                    active
                      ? "rounded-2xl shadow-(--shadow-glow)"
                      : "rounded-3xl group-hover:rounded-2xl"
                  }`}
                >
                  {s.icon_initial ?? s.name.charAt(0).toUpperCase()}
                </div>
              </button>
            );
          })}
          <button
            onClick={() => {
              if (session?.user.is_anonymous) {
                toast.error("Contas convidadas não podem criar servidores. Vincule um e-mail pra desbloquear.");
                return;
              }
              setCreateServerOpen(true);
            }}
            title={session?.user.is_anonymous ? "Vincule um e-mail para criar um servidor" : "Criar servidor"}
            className="w-12 h-12 rounded-3xl hover:rounded-2xl grid place-items-center bg-card text-primary border border-border transition-all duration-200 hover:bg-primary/10 hover:shadow-(--shadow-glow)"
          >
            <Plus className="w-5 h-5" />
          </button>
          <div className="mt-auto flex flex-col gap-2">
            <button
              onClick={() => setView("settings")}
              className="w-12 h-12 rounded-2xl grid place-items-center bg-card hover:bg-secondary transition"
            >
              <Settings className="w-5 h-5 text-muted-foreground" />
            </button>
          </div>
        </aside>

        {/* Channels sidebar */}
        <aside className="flex flex-1 min-w-0 md:w-64 md:flex-none shrink-0 flex-col border-l border-border">
          {railMode === "dm" ? (
            <>
              <div className="h-14 px-4 flex items-center border-b border-border shadow-sm">
                <span className="font-semibold">Mensagens diretas</span>
              </div>
              <Suspense
                fallback={
                  <div className="flex-1 grid place-items-center">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                }
              >
                <DmSidebar
                  userId={userId!}
                  activeConversationId={activeConversationId}
                  activeCall={dmCall}
                  onOpenConversation={(conversationId, otherProfile) => {
                    setActiveConversationId(conversationId);
                    setActiveDmProfile(otherProfile);
                    setView("chat");
                    setMobileSidebar(false);
                    setDmProfileOpen(false);
                  }}
                />
              </Suspense>
            </>
          ) : (
            <>
              <div className="h-14 px-4 flex items-center justify-between border-b border-border shadow-sm">
                {/* Etapa 5.7 — unified dropdown, no longer a binary
                    owner/member ternary: a member can hold administrative
                    permissions (manage_invites, manage_roles) and still
                    needs "Sair do servidor" at the same time, which the old
                    either/or structure made impossible to express. Each
                    item is independently gated by its own condition; "Sair
                    do servidor" is the one item never shown to the owner
                    (unrelated to any of the 6 permissions — protected by
                    RLS since Etapa 3, this conditional only decides
                    whether to render it). Real protection for every item
                    here is always the backend (RLS or RPC), never this
                    conditional by itself. */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center gap-1.5 min-w-0 flex-1 rounded-lg px-2 py-1.5 -mx-2 hover:bg-secondary transition text-left">
                      <span className="font-semibold truncate">{activeServerObj?.name}</span>
                      <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="w-56 rounded-xl border-border bg-card p-1.5 shadow-lg"
                  >
                    {canManageInvites && (
                      <DropdownMenuItem
                        onClick={() => setInviteDialogOpen(true)}
                        className="rounded-lg px-2.5 py-2 text-sm cursor-pointer focus:bg-secondary"
                      >
                        <UserPlus className="w-4 h-4 mr-2 text-muted-foreground" />
                        Convidar pessoas
                      </DropdownMenuItem>
                    )}
                    {isServerOwner && (
                      <DropdownMenuItem
                        onClick={() => setEditServerOpen(true)}
                        className="rounded-lg px-2.5 py-2 text-sm cursor-pointer focus:bg-secondary"
                      >
                        <Pencil className="w-4 h-4 mr-2 text-muted-foreground" />
                        Editar servidor
                      </DropdownMenuItem>
                    )}
                    {canManageRoles && (
                      <DropdownMenuItem
                        onClick={() => setRolesManagerOpen(true)}
                        className="rounded-lg px-2.5 py-2 text-sm cursor-pointer focus:bg-secondary"
                      >
                        <Shield className="w-4 h-4 mr-2 text-muted-foreground" />
                        Gerenciar cargos
                      </DropdownMenuItem>
                    )}
                    {isServerOwner && (
                      <DropdownMenuItem
                        onClick={() => setDeleteServerOpen(true)}
                        className="rounded-lg px-2.5 py-2 text-sm cursor-pointer text-destructive focus:bg-destructive/10"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Excluir servidor
                      </DropdownMenuItem>
                    )}
                    {!isServerOwner && (
                      <DropdownMenuItem
                        onClick={() => setLeaveServerOpen(true)}
                        className="rounded-lg px-2.5 py-2 text-sm cursor-pointer text-destructive focus:bg-destructive/10"
                      >
                        <LogOut className="w-4 h-4 mr-2" />
                        Sair do servidor
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
                {canManageChannels && (
                  <div className="flex items-center justify-between px-2">
                    <span className="text-xs uppercase tracking-wider text-muted-foreground">Canais</span>
                    <button
                      onClick={() => setCreateChannelOpen(true)}
                      title="Criar canal"
                      className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                )}
                <DndContext
                  sensors={dndSensors}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDragEnd={handleDragEnd}
                  onDragCancel={handleDragCancel}
                >
                  {displayCategorized.map(([key, { label, items }]) => (
                    <CategoryGroup
                      key={key}
                      title={label}
                      list={items}
                      activeId={activeChannel}
                      canManage={canManageChannels}
                      onSelect={(id) => {
                        setActiveChannel(id);
                        setView("chat");
                        setMobileSidebar(false);
                      }}
                      onEdit={(c) => {
                        setEditingChannel(c);
                        setEditChannelOpen(true);
                      }}
                      onDelete={(c) => {
                        setDeletingChannel(c);
                        setDeleteChannelOpen(true);
                      }}
                    />
                  ))}
                </DndContext>
              </div>
            </>
          )}
          {/* Voice/status bar */}
          <div className="h-14 px-2 flex items-center gap-2 bg-sidebar border-t border-border">
            <OwnProfileBarButton profile={profile} />
            {(() => {
              const liveCall =
                dmCall.status !== "idle"
                  ? dmCall
                  : activeVoice?.status === "connected"
                    ? activeVoice
                    : null;
              const micOn = liveCall?.micEnabled ?? true;
              return (
                <button
                  onClick={() => liveCall?.toggleMic()}
                  disabled={!liveCall}
                  title={
                    !liveCall
                      ? "Sem chamada ativa"
                      : micOn
                        ? "Silenciar microfone"
                        : "Ativar microfone"
                  }
                  className={`p-2 rounded hover:bg-secondary transition disabled:opacity-30 disabled:hover:bg-transparent ${
                    liveCall && !micOn ? "text-destructive" : "text-muted-foreground"
                  }`}
                >
                  {liveCall && !micOn ? (
                    <MicOff className="w-4 h-4" />
                  ) : (
                    <Mic className="w-4 h-4" />
                  )}
                </button>
              );
            })()}
            <button
              onClick={() => setDeafened((v) => !v)}
              title={deafened ? "Reativar áudio" : "Ensurdecer"}
              className={`p-2 rounded hover:bg-secondary transition ${deafened ? "text-destructive" : "text-muted-foreground"}`}
            >
              {deafened ? <HeadphoneOff className="w-4 h-4" /> : <Headphones className="w-4 h-4" />}
            </button>
          </div>
        </aside>
      </div>

      {/* Main */}
      <main className="flex-1 flex min-h-0 gap-4">
        <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-card rounded-[18px] overflow-hidden">
          {/* Top bar */}
          <div className="h-14 px-4 flex items-center gap-3 border-b border-border bg-card/80 backdrop-blur">
            <button
              className="md:hidden p-2 rounded hover:bg-secondary"
              onClick={() => setMobileSidebar((v) => !v)}
            >
              {railMode === "dm" ? (
                <MessageCircle className="w-5 h-5 text-muted-foreground" />
              ) : (
                <ChannelIconInline type={channel.type as ChannelType} />
              )}
            </button>
            {railMode === "dm" ? (
              <span className="font-semibold text-muted-foreground">Mensagens diretas</span>
            ) : (
              <div className="flex items-center gap-2 min-w-0">
                <ChannelIconInline type={channel.type as ChannelType} />
                <span className="font-semibold truncate">{channel.name}</span>
                {channel.topic ? (
                  <>
                    <span className="hidden sm:block w-px h-5 bg-border mx-2" />
                    <span className="hidden sm:block text-sm text-muted-foreground truncate">
                      {channel.topic}
                    </span>
                  </>
                ) : null}
              </div>
            )}
            <div className="ml-auto flex items-center gap-1 text-muted-foreground">
              {railMode === "servers" && (
                <>
                  <IconBtn icon={Pin} />
                  <IconBtn icon={Inbox} />
                  <IconBtn icon={Clapperboard} onClick={() => setView("studio")} />
                  <div className="relative hidden sm:block">
                    <div className="flex items-center gap-2 ml-2 px-3 py-1.5 bg-secondary rounded-md text-sm">
                      <Search className="w-3.5 h-3.5" />
                      <input
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="bg-transparent outline-none placeholder:text-muted-foreground w-36"
                        placeholder="Buscar"
                      />
                    </div>
                    <AnimatePresence>
                      {searchQuery.trim().length >= 2 && (
                        <SearchResultsPanel
                          results={searchResults}
                          loading={searching}
                          onSelect={handleSearchSelect}
                          onClose={() => setSearchQuery("")}
                        />
                      )}
                    </AnimatePresence>
                  </div>
                  {/* Below sm the always-visible search box has nowhere to
                      go -- collapses to an icon that opens a full-width
                      overlay bar instead of just disappearing. */}
                  <IconBtn
                    icon={Search}
                    onClick={() => setMobileSearchOpen((v) => !v)}
                    className="sm:hidden"
                  />
                  <IconBtn icon={Users} onClick={() => setMembersOpen((v) => !v)} />
                </>
              )}
              {/* Notifications aren't server-specific (dm_message and
                  friend_request* types are about DM/friends, not servers),
                  so the bell is always visible here regardless of
                  railMode -- previously it only rendered inside the
                  servers-only block above, making it inaccessible from DM
                  mode. Same state/handlers as before, just no longer
                  gated. */}
              <div className="relative">
                <IconBtn icon={Bell} onClick={() => setNotificationsOpen((v) => !v)} />
                {unreadCount > 0 && (
                  <span className="absolute top-0.5 right-0.5 min-w-4 h-4 px-1 rounded-full bg-destructive text-white text-[10px] font-semibold grid place-items-center pointer-events-none">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
                <AnimatePresence>
                  {notificationsOpen && (
                    <NotificationsPanel
                      notifications={notifications}
                      onSelect={handleNotificationClick}
                      onClose={() => setNotificationsOpen(false)}
                    />
                  )}
                </AnimatePresence>
              </div>
              {railMode === "dm" && activeConversationId && (
                <IconBtn
                  icon={UserRound}
                  onClick={() => setDmProfileOpen((v) => !v)}
                  className="lg:hidden"
                />
              )}
            </div>
          </div>

          {mobileSearchOpen && (
            <div className="sm:hidden px-3 py-2 border-b border-border bg-card">
              <div className="flex items-center gap-2 px-3 py-2 bg-secondary rounded-md text-sm">
                <Search className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                <input
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1 min-w-0 bg-transparent outline-none placeholder:text-muted-foreground"
                  placeholder="Buscar"
                />
                <button
                  onClick={() => {
                    setMobileSearchOpen(false);
                    setSearchQuery("");
                  }}
                  className="shrink-0 text-muted-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="relative">
                <AnimatePresence>
                  {searchQuery.trim().length >= 2 && (
                    <SearchResultsPanel
                      results={searchResults}
                      loading={searching}
                      onSelect={(r) => {
                        handleSearchSelect(r);
                        setMobileSearchOpen(false);
                      }}
                      onClose={() => setSearchQuery("")}
                    />
                  )}
                </AnimatePresence>
              </div>
            </div>
          )}

          <div className="flex-1 flex min-h-0">
            <section className="flex-1 flex flex-col min-w-0 min-h-0">
              <AnimatePresence mode="wait">
                {view === "chat" && railMode === "dm" && (
                  <Suspense
                    fallback={
                      <div className="flex-1 grid place-items-center">
                        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                      </div>
                    }
                  >
                    {activeConversationId && activeDmProfile ? (
                      <DmChatView
                        key={`dm-${activeConversationId}`}
                        conversationId={activeConversationId}
                        otherProfile={activeDmProfile}
                        myProfile={profile}
                        dmCall={dmCall}
                        deafened={deafened}
                      />
                    ) : (
                      <div className="flex-1 grid place-items-center text-muted-foreground text-sm">
                        Selecione um amigo para conversar.
                      </div>
                    )}
                  </Suspense>
                )}
                {view === "chat" && railMode === "servers" && channel.type === "voice" && (
                  <Suspense
                    fallback={
                      <div className="flex-1 grid place-items-center">
                        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                      </div>
                    }
                  >
                    <VoiceRoomView
                      key={`voice-${channel.id}`}
                      channelId={channel.id}
                      channelName={channel.name}
                      members={members}
                      deafened={deafened}
                      onVoiceChange={setActiveVoice}
                    />
                  </Suspense>
                )}
                {view === "chat" && railMode === "servers" && channel.type !== "voice" && (
                  <motion.div
                    key="chat"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex-1 flex flex-col min-h-0"
                  >
                    <ChatArea
                      channelId={channel.id}
                      channelName={channel.name}
                      channelType={channel.type as ChannelType}
                      messages={messages}
                      hasOlderMessages={hasOlderMessages}
                      loadingOlderMessages={loadingOlderMessages}
                      loadOlderMessages={loadOlderMessages}
                      myId={userId}
                      canModerateMessages={canModerateMessages}
                      onReact={handleReact}
                      onEdit={(mid, content) => editMessage.mutate({ id: mid, content })}
                      onDelete={(mid) => deleteMessage.mutate(mid)}
                    />
                    <Composer
                      channelName={channel.name}
                      value={draft}
                      onChange={setDraft}
                      onSend={send}
                      sending={
                        sendMessage.isPending ||
                        uploadAttachment.isPending ||
                        addAttachment.isPending
                      }
                      pendingFile={pendingFile}
                      onPickFile={handlePickFile}
                      onRemoveFile={() => setPendingFile(null)}
                      error={attachError}
                    />
                  </motion.div>
                )}
                {view === "profile" && profile && userId && (
                  <ProfileEditor
                    key="profile"
                    profile={profile}
                    userId={userId}
                    onSave={(patch) => updateProfile.mutateAsync(patch)}
                    onSignOut={signOut}
                    onClose={() => setView("chat")}
                  />
                )}
                {view === "settings" && profile && (
                  <SettingsView
                    key="settings"
                    profile={profile}
                    onSave={(patch) => updateProfile.mutate(patch)}
                    onClose={() => setView("chat")}
                  />
                )}
                {view === "studio" && (
                  <StudioView
                    key="studio"
                    onClose={() => setView("chat")}
                    onApplyAvatar={(url) => updateProfile.mutate({ avatar_url: url })}
                  />
                )}
              </AnimatePresence>
            </section>
          </div>
        </div>

        {membersOpen && view === "chat" && railMode === "servers" && (
          <MembersPanel
            members={members}
            roles={serverRoles}
            ownerId={activeServerObj?.owner_id}
            canKickMembers={canKickMembers}
            canAssignRoles={canAssignRoles}
            myId={userId}
            onAssignRole={(member, roleId) => {
              if (!activeServer) return;
              assignRole.mutate({ serverId: activeServer, userId: member.user_id, roleId });
            }}
            onKick={(member) => {
              setKickingMember(member);
              setKickMemberOpen(true);
            }}
            onClose={() => setMembersOpen(false)}
          />
        )}
        {view === "chat" && railMode === "dm" && activeConversationId && activeDmProfile && (
          <DmProfilePanel
            profile={activeDmProfile}
            myId={userId}
            myProfile={profile}
            call={dmCall.call?.conversation_id === activeConversationId ? dmCall : null}
            deafened={deafened}
            onToggleDeafen={() => setDeafened((v) => !v)}
            mobileOpen={dmProfileOpen}
            onCloseMobile={() => setDmProfileOpen(false)}
          />
        )}
      </main>

      <ServerFormDialog
        mode="create"
        open={createServerOpen}
        onOpenChange={setCreateServerOpen}
        onCreated={(server) => {
          setActiveServer(server.id);
          setRailMode("servers");
          setView("chat");
        }}
      />
      <ServerFormDialog
        mode="edit"
        server={activeServerObj}
        open={editServerOpen}
        onOpenChange={setEditServerOpen}
        onUpdated={() => setEditServerOpen(false)}
      />
      <DeleteServerAlertDialog
        server={activeServerObj}
        open={deleteServerOpen}
        onOpenChange={setDeleteServerOpen}
        onDeleted={() => setDeleteServerOpen(false)}
      />
      <ChannelFormDialog
        mode="create"
        serverId={activeServer}
        existingCategories={existingCategories}
        open={createChannelOpen}
        onOpenChange={setCreateChannelOpen}
        onCreated={(channel) => {
          setActiveChannel(channel.id);
          setView("chat");
        }}
      />
      <ChannelFormDialog
        mode="edit"
        serverId={activeServer}
        channel={editingChannel}
        existingCategories={existingCategories}
        open={editChannelOpen}
        onOpenChange={setEditChannelOpen}
        onUpdated={() => setEditChannelOpen(false)}
      />
      <DeleteChannelAlertDialog
        channel={deletingChannel}
        canDelete={channels.length > 1}
        open={deleteChannelOpen}
        onOpenChange={setDeleteChannelOpen}
        onDeleted={() => setDeleteChannelOpen(false)}
      />
      <InviteFormDialog serverId={activeServer} open={inviteDialogOpen} onOpenChange={setInviteDialogOpen} />
      <KickMemberAlertDialog
        serverId={activeServer}
        member={kickingMember}
        open={kickMemberOpen}
        onOpenChange={setKickMemberOpen}
        onKicked={() => setKickMemberOpen(false)}
      />
      <LeaveServerAlertDialog
        server={activeServerObj}
        userId={userId}
        open={leaveServerOpen}
        onOpenChange={setLeaveServerOpen}
        onLeft={() => setLeaveServerOpen(false)}
      />
      <RolesManagerDialog
        serverId={activeServer}
        isOwner={isServerOwner}
        open={rolesManagerOpen}
        onOpenChange={setRolesManagerOpen}
      />
    </div>
    </ProfilePopoverProvider>
  );
}

// Split out from AppPage's own body so it can call useProfilePopover() — the
// hook only works inside a descendant of the ProfilePopoverProvider that
// AppPage itself renders, not in AppPage's own top-level scope.
function OwnProfileBarButton({ profile }: { profile: Profile }) {
  const { open } = useProfilePopover();
  const isOnline = useIsUserOnline(profile.id);
  const displayStatus = resolvePresenceStatus(profile.status as UserStatus, isOnline);
  return (
    <button
      data-profile-trigger
      onClick={(e) => open(profile, e.currentTarget)}
      className="flex items-center gap-2 min-w-0 flex-1 rounded-lg p-1 -m-1 hover:bg-secondary transition text-left"
    >
      <div className="relative shrink-0">
        <img src={avatarFor(profile)} alt="" className="w-8 h-8 rounded-full object-cover" />
        <span
          className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-sidebar ${statusColor[displayStatus]}`}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{profile.name}</div>
        <div className="text-xs text-muted-foreground truncate">{statusLabel[displayStatus]}</div>
      </div>
    </button>
  );
}

// Goes through create_server() exclusively (see useCreateServer) — no
// direct table insert, no second creation path. Keeps the mutation local to
// this component rather than lifting it into AppPage, same pattern as
// OwnProfileBarButton pulling its own hook instead of AppPage doing it on
// its behalf.
// Handles both creation and rename — same form, same validation, same
// visual shell either way. Create goes through create_server() (the
// SECURITY DEFINER RPC); edit goes through a direct table UPDATE (the
// audit confirmed that policy works correctly, no RPC needed there).
function ServerFormDialog({
  mode,
  server,
  open,
  onOpenChange,
  onCreated,
  onUpdated,
}: {
  mode: "create" | "edit";
  server?: Server;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (server: Server) => void;
  onUpdated?: (server: Server) => void;
}) {
  const createServer = useCreateServer();
  const updateServer = useUpdateServer();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pending = createServer.isPending || updateServer.isPending;

  // Re-seed the field from the current server name every time the dialog
  // opens in edit mode, so it doesn't show a stale value from a previous
  // open, and doesn't carry over into create mode's blank state.
  useEffect(() => {
    if (!open) return;
    setName(mode === "edit" ? (server?.name ?? "") : "");
    setError(null);
  }, [open, mode, server?.name]);

  const close = () => {
    onOpenChange(false);
    setError(null);
  };

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed || pending) return;
    setError(null);
    try {
      if (mode === "create") {
        const created = await createServer.mutateAsync(trimmed);
        onOpenChange(false);
        onCreated?.(created);
      } else if (server) {
        const updated = await updateServer.mutateAsync({ id: server.id, name: trimmed });
        onOpenChange(false);
        onUpdated?.(updated);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-sm rounded-2xl border-border bg-card p-6">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">
            {mode === "create" ? "Criar servidor" : "Editar servidor"}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Dê um nome ao seu servidor. Você poderá ajustar o resto depois."
              : "Altere o nome do servidor."}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-2">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSubmit();
            }}
            placeholder="Nome do servidor"
            maxLength={100}
            className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter className="mt-4">
          <button
            onClick={() => void handleSubmit()}
            disabled={!name.trim() || pending}
            className="inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40 transition hover:brightness-110"
            style={{ backgroundImage: "var(--gradient-dexy)" }}
          >
            {pending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {mode === "create" ? "Criar servidor" : "Salvar alterações"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteServerAlertDialog({
  server,
  open,
  onOpenChange,
  onDeleted,
}: {
  server?: Server;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const deleteServer = useDeleteServer();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const handleDelete = async () => {
    if (!server) return;
    setError(null);
    try {
      await deleteServer.mutateAsync(server.id);
      onOpenChange(false);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível excluir o servidor.");
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-sm rounded-2xl border-border bg-card p-6">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-lg font-bold">Excluir servidor</AlertDialogTitle>
          <AlertDialogDescription>
            Tem certeza que quer excluir{" "}
            <strong className="text-foreground">{server?.name}</strong>? Essa ação é permanente —
            todos os canais e mensagens desse servidor serão perdidos.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <AlertDialogFooter className="mt-2">
          <AlertDialogCancel className="rounded-full px-4 py-2 text-sm font-medium border border-border bg-transparent hover:bg-secondary transition">
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              // AlertDialogAction closes on click by default — prevented so
              // the dialog only closes after the mutation actually succeeds,
              // and stays open (with the error) if it fails.
              e.preventDefault();
              void handleDelete();
            }}
            disabled={deleteServer.isPending}
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold bg-destructive text-destructive-foreground hover:brightness-110 transition disabled:opacity-40"
          >
            {deleteServer.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Excluir servidor
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Same pattern as DeleteServerAlertDialog/KickMemberAlertDialog. Only
// reachable via the non-owner branch of the server dropdown — the owner's
// dropdown has no equivalent item at all (Etapa 3 product rule: owner can't
// leave yet, no ownership transfer). Real protection is the RLS policy
// ("members can leave, owner can remove others, owner cannot remove self"),
// not this dialog's own existence.
function LeaveServerAlertDialog({
  server,
  userId,
  open,
  onOpenChange,
  onLeft,
}: {
  server?: Server;
  userId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLeft: () => void;
}) {
  const leaveServer = useLeaveServer();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const handleLeave = async () => {
    if (!server || !userId) return;
    setError(null);
    try {
      await leaveServer.mutateAsync({ serverId: server.id, userId });
      onOpenChange(false);
      onLeft();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível sair deste servidor.");
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-sm rounded-2xl border-border bg-card p-6">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-lg font-bold">Sair do servidor</AlertDialogTitle>
          <AlertDialogDescription>
            Tem certeza que quer sair de <strong className="text-foreground">{server?.name}</strong>? Você vai
            precisar de um novo convite para entrar de novo.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <AlertDialogFooter className="mt-2">
          <AlertDialogCancel className="rounded-full px-4 py-2 text-sm font-medium border border-border bg-transparent hover:bg-secondary transition">
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void handleLeave();
            }}
            disabled={leaveServer.isPending}
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold bg-destructive text-destructive-foreground hover:brightness-110 transition disabled:opacity-40"
          >
            {leaveServer.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Sair do servidor
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const DEFAULT_ROLE_COLOR = "#5865f2";

// Single dialog covering create + list + inline edit, same shape as
// InviteFormDialog (create form on top, existing items below, one dialog
// instead of splitting create/manage into two). Etapa 4A: identity only —
// name, color, position — nothing here reads or writes any permission
// concept, and there is none to read (server_roles has no such column).
function RolesManagerDialog({
  serverId,
  isOwner,
  open,
  onOpenChange,
}: {
  serverId: string;
  isOwner: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createRole = useCreateRole();
  const updateRole = useUpdateRole();
  const { data: roles = [], isLoading } = useServerRoles(open ? serverId : undefined);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(DEFAULT_ROLE_COLOR);
  const [error, setError] = useState<string | null>(null);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState(DEFAULT_ROLE_COLOR);
  const [deletingRole, setDeletingRole] = useState<ServerRole | undefined>(undefined);
  const [deleteRoleOpen, setDeleteRoleOpen] = useState(false);
  const [permissionsRoleId, setPermissionsRoleId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNewName("");
    setNewColor(DEFAULT_ROLE_COLOR);
    setError(null);
    setEditingRoleId(null);
    setPermissionsRoleId(null);
  }, [open]);

  const handleCreate = async () => {
    const trimmed = newName.trim();
    if (!trimmed || createRole.isPending) return;
    setError(null);
    try {
      await createRole.mutateAsync({ serverId, name: trimmed, color: newColor });
      setNewName("");
      setNewColor(DEFAULT_ROLE_COLOR);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar o cargo.");
    }
  };

  const startEdit = (role: ServerRole) => {
    setEditingRoleId(role.id);
    setEditName(role.name);
    setEditColor(role.color ?? DEFAULT_ROLE_COLOR);
    setError(null);
  };

  const handleSaveEdit = async () => {
    const trimmed = editName.trim();
    if (!editingRoleId || !trimmed || updateRole.isPending) return;
    setError(null);
    try {
      await updateRole.mutateAsync({ id: editingRoleId, name: trimmed, color: editColor });
      setEditingRoleId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar o cargo.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl border-border bg-card p-6">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Cargos do servidor</DialogTitle>
          <DialogDescription>
            Crie e organize os cargos deste servidor. Use o ícone de escudo em cada cargo para escolher o que ele
            permite fazer.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 flex items-center gap-2">
          <input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            title="Cor do cargo"
            className="w-9 h-9 shrink-0 rounded-lg border border-border bg-secondary cursor-pointer"
          />
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreate();
            }}
            placeholder="Nome do cargo"
            maxLength={100}
            className="flex-1 min-w-0 bg-secondary border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <button
            onClick={() => void handleCreate()}
            disabled={!newName.trim() || createRole.isPending}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-40 transition hover:brightness-110"
            style={{ backgroundImage: "var(--gradient-dexy)" }}
          >
            {createRole.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Criar
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

        <div className="mt-4 pt-4 border-t border-border">
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Cargos existentes
          </h3>
          {isLoading ? (
            <div className="py-4 grid place-items-center">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : roles.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">Nenhum cargo criado ainda.</p>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {roles.map((role) => (
                <div key={role.id}>
                <div
                  className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
                >
                  {editingRoleId === role.id ? (
                    <>
                      <input
                        type="color"
                        value={editColor}
                        onChange={(e) => setEditColor(e.target.value)}
                        title="Cor do cargo"
                        className="w-8 h-8 shrink-0 rounded-lg border border-border bg-secondary cursor-pointer"
                      />
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void handleSaveEdit();
                          if (e.key === "Escape") setEditingRoleId(null);
                        }}
                        autoFocus
                        maxLength={100}
                        className="flex-1 min-w-0 bg-secondary border border-border rounded-lg px-2 py-1.5 text-sm outline-none focus:border-primary"
                      />
                      <button
                        onClick={() => void handleSaveEdit()}
                        disabled={!editName.trim() || updateRole.isPending}
                        title="Salvar"
                        className="p-1.5 rounded hover:bg-secondary text-primary transition disabled:opacity-40"
                      >
                        {updateRole.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Check className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={() => setEditingRoleId(null)}
                        title="Cancelar"
                        className="p-1.5 rounded hover:bg-secondary text-muted-foreground transition"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <span
                        className="w-4 h-4 rounded-full shrink-0"
                        style={{ backgroundColor: role.color ?? "#99a1af" }}
                      />
                      <span className="flex-1 min-w-0 text-sm truncate">{role.name}</span>
                      <span className="text-xs text-muted-foreground shrink-0">#{role.position}</span>
                      {isOwner && (
                        <button
                          onClick={() => setPermissionsRoleId(permissionsRoleId === role.id ? null : role.id)}
                          title="Permissões do cargo"
                          className={`p-1.5 rounded hover:bg-secondary transition ${
                            permissionsRoleId === role.id ? "text-primary" : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          <ShieldCheck className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => startEdit(role)}
                        title="Editar cargo"
                        className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          setDeletingRole(role);
                          setDeleteRoleOpen(true);
                        }}
                        title="Excluir cargo"
                        className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
                {permissionsRoleId === role.id && <RolePermissionsPanel role={role} />}
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>

      <DeleteRoleAlertDialog
        serverId={serverId}
        role={deletingRole}
        open={deleteRoleOpen}
        onOpenChange={setDeleteRoleOpen}
        onDeleted={() => setDeleteRoleOpen(false)}
      />
    </Dialog>
  );
}

// Etapa 5.5 — the management UI for role_permissions (Etapa 5.1). Only
// reachable from inside RolesManagerDialog, which is only ever opened by
// the owner (isServerOwner gate at the call site) — this doesn't add or
// change any authorization, it's a UI for a table whose RLS was already
// owner-only end to end before this existed. A permission with no row at
// all and a permission with a row but allow:false are both "off" here;
// toggling on always upserts allow:true, toggling off always deletes the
// row (see useSetRolePermission) — this UI never produces an explicit
// allow:false row.
function RolePermissionsPanel({ role }: { role: ServerRole }) {
  const { data: rolePermissions = [], isLoading } = useRolePermissions(role.id);
  const setPermission = useSetRolePermission();
  const granted = new Set(rolePermissions.filter((p) => p.allow).map((p) => p.permission));

  return (
    <div className="mt-1.5 rounded-lg border border-border bg-secondary/40 px-3 py-2.5 space-y-2">
      {isLoading ? (
        <div className="py-2 grid place-items-center">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        PERMISSION_CATALOG.map((perm) => {
          const checked = granted.has(perm.key);
          return (
            <label key={perm.key} className="flex items-center justify-between gap-3 text-sm cursor-pointer">
              <span className="text-foreground">{perm.label}</span>
              <Switch
                checked={checked}
                onCheckedChange={(next: boolean) =>
                  setPermission.mutate({ roleId: role.id, permission: perm.key as PermissionKey, allow: next })
                }
              />
            </label>
          );
        })
      )}
    </div>
  );
}

// Same pattern as DeleteChannelAlertDialog. role_id has `on delete set
// null` (init_schema.sql), so members holding this role are cleared by the
// database itself, not by any code here — the confirmation copy says so
// explicitly instead of implying the membership itself is at risk.
function DeleteRoleAlertDialog({
  serverId,
  role,
  open,
  onOpenChange,
  onDeleted,
}: {
  serverId: string;
  role?: ServerRole;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const deleteRole = useDeleteRole();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const handleDelete = async () => {
    if (!role) return;
    setError(null);
    try {
      await deleteRole.mutateAsync({ id: role.id, serverId });
      onOpenChange(false);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível excluir o cargo.");
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-sm rounded-2xl border-border bg-card p-6">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-lg font-bold">Excluir cargo</AlertDialogTitle>
          <AlertDialogDescription>
            Tem certeza que quer excluir <strong className="text-foreground">{role?.name}</strong>? Membros com
            esse cargo ficam sem cargo — ninguém é removido do servidor.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <AlertDialogFooter className="mt-2">
          <AlertDialogCancel className="rounded-full px-4 py-2 text-sm font-medium border border-border bg-transparent hover:bg-secondary transition">
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void handleDelete();
            }}
            disabled={deleteRole.isPending}
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold bg-destructive text-destructive-foreground hover:brightness-110 transition disabled:opacity-40"
          >
            {deleteRole.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Excluir cargo
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Same create/edit-aware pattern as ServerFormDialog. type is only
// switchable in create mode — see useUpdateChannel for why editing it isn't
// safe with the current VoiceRoomView/ChatArea wiring, so in edit mode the
// toggle is shown (for context) but disabled. position is never part of
// either payload here (create computes it internally, edit doesn't touch it
// at all), so editing never moves a channel in the list.
function ChannelFormDialog({
  mode,
  serverId,
  channel,
  existingCategories,
  open,
  onOpenChange,
  onCreated,
  onUpdated,
}: {
  mode: "create" | "edit";
  serverId: string;
  channel?: Channel;
  existingCategories: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (channel: Channel) => void;
  onUpdated?: (channel: Channel) => void;
}) {
  const createChannel = useCreateChannel();
  const updateChannel = useUpdateChannel();
  const [name, setName] = useState("");
  const [type, setType] = useState<"text" | "voice">("text");
  const [category, setCategory] = useState("Geral");
  const [topic, setTopic] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pending = createChannel.isPending || updateChannel.isPending;

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && channel) {
      setName(channel.name);
      setType(channel.type === "voice" ? "voice" : "text");
      setCategory(channel.category);
      setTopic(channel.topic ?? "");
    } else {
      setName("");
      setType("text");
      setCategory("Geral");
      setTopic("");
    }
    setError(null);
  }, [open, mode, channel]);

  const close = () => {
    onOpenChange(false);
    setError(null);
  };

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed || pending) return;
    setError(null);
    try {
      if (mode === "create") {
        const created = await createChannel.mutateAsync({ serverId, name: trimmed, type, category, topic });
        onOpenChange(false);
        onCreated?.(created);
      } else if (channel) {
        const updated = await updateChannel.mutateAsync({ id: channel.id, name: trimmed, category, topic });
        onOpenChange(false);
        onUpdated?.(updated);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-sm rounded-2xl border-border bg-card p-6">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">{mode === "create" ? "Criar canal" : "Editar canal"}</DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Adicione um canal de texto ou de voz a este servidor."
              : "Altere nome, categoria ou tópico do canal."}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-2 space-y-3">
          <div className="flex gap-2">
            <button
              type="button"
              disabled={mode === "edit"}
              onClick={() => setType("text")}
              className={`flex-1 flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition ${
                type === "text"
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-secondary"
              } ${mode === "edit" ? "opacity-60 cursor-not-allowed hover:bg-transparent" : ""}`}
            >
              <Hash className="w-4 h-4" />
              Texto
            </button>
            <button
              type="button"
              disabled={mode === "edit"}
              onClick={() => setType("voice")}
              className={`flex-1 flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition ${
                type === "voice"
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-secondary"
              } ${mode === "edit" ? "opacity-60 cursor-not-allowed hover:bg-transparent" : ""}`}
            >
              <Volume2 className="w-4 h-4" />
              Voz
            </button>
          </div>
          {mode === "edit" && (
            <p className="text-xs text-muted-foreground -mt-1">
              O tipo do canal não pode ser alterado depois de criado.
            </p>
          )}
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSubmit();
            }}
            placeholder="nome-do-canal"
            maxLength={100}
            className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            list="channel-category-suggestions"
            placeholder="Categoria"
            maxLength={100}
            className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
          <datalist id="channel-category-suggestions">
            {existingCategories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Tópico (opcional)"
            maxLength={200}
            className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter className="mt-4">
          <button
            onClick={() => void handleSubmit()}
            disabled={!name.trim() || pending}
            className="inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40 transition hover:brightness-110"
            style={{ backgroundImage: "var(--gradient-dexy)" }}
          >
            {pending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {mode === "create" ? "Criar canal" : "Salvar alterações"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Same visual pattern as DeleteServerAlertDialog. `canDelete` is computed by
// the caller from channels.length > 1 — there's no DB constraint against
// deleting a server's last channel (that would need a schema change, out of
// scope here), so this is the only place that rule is enforced. When it's
// false, the dialog still opens but explains why instead of silently doing
// nothing or hiding the trash icon (which would be less discoverable/more
// confusing than a clear explanation).
function DeleteChannelAlertDialog({
  channel,
  canDelete,
  open,
  onOpenChange,
  onDeleted,
}: {
  channel?: Channel;
  canDelete: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const deleteChannel = useDeleteChannel();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const handleDelete = async () => {
    if (!channel || !canDelete) return;
    setError(null);
    try {
      await deleteChannel.mutateAsync({ id: channel.id, serverId: channel.server_id });
      onOpenChange(false);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível excluir o canal.");
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-sm rounded-2xl border-border bg-card p-6">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-lg font-bold">Excluir canal</AlertDialogTitle>
          <AlertDialogDescription>
            {canDelete ? (
              <>
                Tem certeza que quer excluir <strong className="text-foreground">#{channel?.name}</strong>? Essa
                ação é permanente — todas as mensagens desse canal serão perdidas.
              </>
            ) : (
              <>
                <strong className="text-foreground">#{channel?.name}</strong> é o único canal deste servidor. Crie
                outro canal antes de excluir este.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <AlertDialogFooter className="mt-2">
          <AlertDialogCancel className="rounded-full px-4 py-2 text-sm font-medium border border-border bg-transparent hover:bg-secondary transition">
            {canDelete ? "Cancelar" : "Entendi"}
          </AlertDialogCancel>
          {canDelete && (
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              disabled={deleteChannel.isPending}
              className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold bg-destructive text-destructive-foreground hover:brightness-110 transition disabled:opacity-40"
            >
              {deleteChannel.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Excluir canal
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Same pattern as DeleteChannelAlertDialog/DeleteServerAlertDialog. Only
// reachable via MembersPanel's hover action, which itself only renders for
// isServerOwner and never for the viewer's own row — but useKickMember also
// refuses to target the caller's own membership regardless, so this isn't
// the only thing standing between a click and removing yourself.
function KickMemberAlertDialog({
  serverId,
  member,
  open,
  onOpenChange,
  onKicked,
}: {
  serverId?: string;
  member?: MemberWithProfile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onKicked: () => void;
}) {
  const kickMember = useKickMember();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const handleKick = async () => {
    if (!serverId || !member) return;
    setError(null);
    try {
      await kickMember.mutateAsync({ serverId, userId: member.user_id });
      onOpenChange(false);
      onKicked();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível remover este membro.");
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-sm rounded-2xl border-border bg-card p-6">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-lg font-bold">Expulsar membro</AlertDialogTitle>
          <AlertDialogDescription>
            Tem certeza que quer expulsar{" "}
            <strong className="text-foreground">{member?.profile.name}</strong> deste servidor? Essa pessoa vai
            perder o acesso imediatamente, mas pode entrar de novo com um novo convite.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <AlertDialogFooter className="mt-2">
          <AlertDialogCancel className="rounded-full px-4 py-2 text-sm font-medium border border-border bg-transparent hover:bg-secondary transition">
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void handleKick();
            }}
            disabled={kickMember.isPending}
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold bg-destructive text-destructive-foreground hover:brightness-110 transition disabled:opacity-40"
          >
            {kickMember.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Expulsar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const INVITE_EXPIRATION_OPTIONS = [
  { value: "never", label: "Nunca" },
  { value: "1h", label: "1 hora" },
  { value: "24h", label: "24 horas" },
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
] as const;

const INVITE_MAX_USES_OPTIONS = [
  { value: "unlimited", label: "Ilimitado" },
  { value: "1", label: "1 uso" },
  { value: "5", label: "5 usos" },
  { value: "10", label: "10 usos" },
  { value: "25", label: "25 usos" },
  { value: "50", label: "50 usos" },
  { value: "100", label: "100 usos" },
] as const;

// Converted client-side into the actual timestamp create_invite expects —
// the RPC's own parameter is a plain nullable timestamptz (Etapa 2), not an
// enum, so the "Nunca/1h/24h/7d/30d" choices are purely a UI concept.
function inviteExpiresAtFromOption(option: string): string | null {
  const hours: Record<string, number> = { "1h": 1, "24h": 24, "7d": 24 * 7, "30d": 24 * 30 };
  const h = hours[option];
  return h ? new Date(Date.now() + h * 60 * 60 * 1000).toISOString() : null;
}

function inviteMaxUsesFromOption(option: string): number | null {
  return option === "unlimited" ? null : Number(option);
}

type InviteStatus = "active" | "expired" | "revoked" | "exhausted";

// Purely a display computation — the RPC (accept_invite) independently
// re-validates all of this server-side on every acceptance attempt; this
// never gates anything, it only decides what badge/actions to render.
function inviteStatus(invite: ServerInvite): InviteStatus {
  if (invite.revoked_at) return "revoked";
  if (invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now()) return "expired";
  if (invite.max_uses !== null && invite.use_count >= invite.max_uses) return "exhausted";
  return "active";
}

const inviteStatusLabel: Record<InviteStatus, string> = {
  active: "Ativo",
  expired: "Expirado",
  revoked: "Revogado",
  exhausted: "Esgotado",
};

const inviteStatusClass: Record<InviteStatus, string> = {
  active: "text-primary bg-primary/10",
  expired: "text-muted-foreground bg-secondary",
  revoked: "text-destructive bg-destructive/10",
  exhausted: "text-muted-foreground bg-secondary",
};

// Single dialog covering both "create" and "manage" — mirrors how Discord's
// own Invite People modal keeps the freshly-generated link and the list of
// existing invites in one place, instead of splitting into two dialogs for
// one feature. Only reachable from the owner-gated dropdown item, but the
// real authorization is server_invites' RLS (Etapa 1) — every read/write
// here goes through useServerInvites/useCreateInvite/useRevokeInvite, which
// only ever touch server_invites via RLS-checked calls or the SECURITY
// DEFINER RPC, never a client-trusted assumption.
//
// "Copiar código" copies the raw invite code, not a full URL — there is no
// /invite/:code route yet (a later step), so presenting a link that 404s
// would be worse than showing the code plainly. Extending this to a full
// URL once that route exists is a one-line change here.
function InviteFormDialog({
  serverId,
  open,
  onOpenChange,
}: {
  serverId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createInvite = useCreateInvite();
  const revokeInvite = useRevokeInvite();
  const { data: invites = [], isLoading: invitesLoading } = useServerInvites(open ? serverId : undefined);
  const [expirationOption, setExpirationOption] = useState<string>("7d");
  const [maxUsesOption, setMaxUsesOption] = useState<string>("unlimited");
  const [error, setError] = useState<string | null>(null);
  const [justCreatedCode, setJustCreatedCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setExpirationOption("7d");
    setMaxUsesOption("unlimited");
    setError(null);
    setJustCreatedCode(null);
    setCopied(false);
  }, [open]);

  const handleCreate = async () => {
    if (createInvite.isPending) return;
    setError(null);
    try {
      const created = await createInvite.mutateAsync({
        serverId,
        expiresAt: inviteExpiresAtFromOption(expirationOption),
        maxUses: inviteMaxUsesFromOption(maxUsesOption),
      });
      setJustCreatedCode(created.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar o convite.");
    }
  };

  const copyCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    toast.success("Código copiado para a área de transferência.");
    setTimeout(() => setCopied(false), 1500);
  };

  const handleRevoke = async (invite: ServerInvite) => {
    try {
      await revokeInvite.mutateAsync({ id: invite.id, serverId });
    } catch {
      toast.error("Não foi possível revogar o convite.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl border-border bg-card p-6">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Convidar pessoas</DialogTitle>
          <DialogDescription>Gere um código de convite para este servidor.</DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-3">
          {justCreatedCode ? (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 flex items-center justify-between gap-2">
              <span className="font-mono text-sm truncate">{justCreatedCode}</span>
              <button
                onClick={() => void copyCode(justCreatedCode)}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:brightness-110"
                style={{ backgroundImage: "var(--gradient-dexy)" }}
              >
                <Copy className="w-3.5 h-3.5" />
                {copied ? "Copiado!" : "Copiar código"}
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Expiração</label>
                  <Select value={expirationOption} onValueChange={setExpirationOption}>
                    <SelectTrigger className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm h-auto">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-lg border-border bg-card">
                      {INVITE_EXPIRATION_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value} className="text-sm">
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Limite de usos</label>
                  <Select value={maxUsesOption} onValueChange={setMaxUsesOption}>
                    <SelectTrigger className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm h-auto">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-lg border-border bg-card">
                      {INVITE_MAX_USES_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value} className="text-sm">
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <button
                onClick={() => void handleCreate()}
                disabled={createInvite.isPending}
                className="w-full inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-40 transition hover:brightness-110"
                style={{ backgroundImage: "var(--gradient-dexy)" }}
              >
                {createInvite.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Gerar convite
              </button>
            </>
          )}

          {justCreatedCode && (
            <button
              onClick={() => setJustCreatedCode(null)}
              className="text-xs text-muted-foreground hover:text-foreground transition"
            >
              Criar outro convite
            </button>
          )}
        </div>

        <div className="mt-5 pt-4 border-t border-border">
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Convites ativos</h3>
          {invitesLoading ? (
            <div className="py-4 grid place-items-center">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : invites.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">Nenhum convite criado ainda.</p>
          ) : (
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {invites.map((invite) => {
                const status = inviteStatus(invite);
                return (
                  <div
                    key={invite.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm truncate">{invite.code}</span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${inviteStatusClass[status]}`}
                        >
                          {inviteStatusLabel[status]}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {invite.use_count}
                        {invite.max_uses !== null ? ` / ${invite.max_uses}` : ""} usos
                        {invite.expires_at
                          ? ` · expira ${new Date(invite.expires_at).toLocaleDateString()}`
                          : " · sem expiração"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => void copyCode(invite.code)}
                        title="Copiar código"
                        className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      {status === "active" && (
                        <button
                          onClick={() => void handleRevoke(invite)}
                          disabled={revokeInvite.isPending}
                          title="Revogar convite"
                          className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition disabled:opacity-40"
                        >
                          <Ban className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Defensive, not reachable in normal use today (every account keeps its
// Dexy HQ membership — there's no "leave server" yet) — but excluir
// servidor makes zero-servers reachable in principle, so this needs a real
// screen instead of the app hanging on LoadingScreen forever.
function NoServersScreen({ onCreated }: { onCreated: (server: Server) => void }) {
  const createServer = useCreateServer();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed || createServer.isPending) return;
    setError(null);
    try {
      const server = await createServer.mutateAsync(trimmed);
      onCreated(server);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar o servidor.");
    }
  };

  return (
    <div className="h-dvh w-screen grid place-items-center bg-background text-foreground px-4">
      <div className="flex flex-col items-center gap-4 text-center max-w-sm w-full">
        <DexyLogo size={40} />
        <div>
          <h2 className="text-lg font-bold">Nenhum servidor ainda</h2>
          <p className="text-sm text-muted-foreground mt-1">Crie um servidor pra começar.</p>
        </div>
        <div className="w-full">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreate();
            }}
            placeholder="Nome do servidor"
            maxLength={100}
            className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </div>
        <button
          onClick={() => void handleCreate()}
          disabled={!name.trim() || createServer.isPending}
          className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-40 transition hover:brightness-110"
          style={{ backgroundImage: "var(--gradient-dexy)" }}
        >
          {createServer.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Criar servidor
        </button>
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="h-dvh w-screen grid place-items-center bg-background text-foreground">
      <div className="flex flex-col items-center gap-3">
        <DexyLogo size={40} />
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    </div>
  );
}

function ChannelIconInline({ type }: { type: ChannelType }) {
  const Icon = channelIcon[type];
  return <Icon className="w-5 h-5 text-muted-foreground" />;
}

function IconBtn({
  icon: Icon,
  onClick,
  className = "",
}: {
  icon: typeof Bell;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button onClick={onClick} className={`p-2 rounded hover:bg-secondary transition ${className}`}>
      <Icon className="w-4 h-4" />
    </button>
  );
}

function SearchResultsPanel({
  results,
  loading,
  onSelect,
  onClose,
}: {
  results: SearchResult[];
  loading: boolean;
  onSelect: (r: SearchResult) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.15 }}
        className="absolute right-0 top-11 z-50 w-80 max-h-96 overflow-y-auto bg-card border border-border rounded-xl shadow-xl"
      >
        {loading ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Buscando...
          </div>
        ) : results.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            Nenhum resultado.
          </div>
        ) : (
          <div className="py-1">
            {results.map((r) => (
              <button
                key={r.id}
                onClick={() => onSelect(r)}
                className="w-full text-left px-4 py-2.5 hover:bg-secondary/50 transition"
              >
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Hash className="w-3 h-3" />
                  {r.channel.name}
                  <span className="mx-1">·</span>
                  {r.author.name}
                </div>
                <div className="text-sm truncate mt-0.5">{r.content}</div>
              </button>
            ))}
          </div>
        )}
      </motion.div>
    </>
  );
}

function CategoryGroup({
  title,
  list,
  activeId,
  canManage,
  onSelect,
  onEdit,
  onDelete,
}: {
  title: string;
  list: Channel[];
  activeId: string | undefined;
  canManage: boolean;
  onSelect: (id: string) => void;
  onEdit: (channel: Channel) => void;
  onDelete: (channel: Channel) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1 px-2 py-1 text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={`w-3 h-3 transition ${open ? "" : "-rotate-90"}`} />
        {title}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden mt-1 space-y-0.5"
          >
            <SortableContext items={list.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              {list.map((c) => (
                <SortableChannelRow
                  key={c.id}
                  channel={c}
                  active={c.id === activeId}
                  canManage={canManage}
                  onSelect={onSelect}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              ))}
            </SortableContext>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SortableChannelRow({
  channel,
  active,
  canManage,
  onSelect,
  onEdit,
  onDelete,
}: {
  channel: Channel;
  active: boolean;
  canManage: boolean;
  onSelect: (id: string) => void;
  onEdit: (channel: Channel) => void;
  onDelete: (channel: Channel) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: channel.id,
    disabled: !canManage,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  const Icon = channelIcon[channel.type as ChannelType];
  return (
    <div ref={setNodeRef} style={style} className="group relative flex items-center">
      <button
        onClick={() => onSelect(channel.id)}
        // The select button doubles as the drag handle (only for those who
        // can manage channels — useSortable is disabled otherwise) so
        // there's no separate grip icon to add; the sensor's activation
        // distance keeps a plain click from being misread as a drag.
        {...attributes}
        {...(canManage ? listeners : {})}
        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm transition ${
          active
            ? "bg-secondary text-foreground"
            : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
        } ${canManage ? "cursor-grab active:cursor-grabbing" : ""}`}
      >
        <Icon className="w-4 h-4 shrink-0" />
        <span className="truncate">{channel.name}</span>
      </button>
      {canManage && (
        <div className="absolute right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit(channel);
            }}
            title="Editar canal"
            className="p-1 rounded hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(channel);
            }}
            title="Excluir canal"
            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function ChatArea({
  channelId,
  channelName,
  channelType,
  messages,
  hasOlderMessages,
  loadingOlderMessages,
  loadOlderMessages,
  myId,
  canModerateMessages,
  onReact,
  onEdit,
  onDelete,
}: {
  channelId: string;
  channelName: string;
  channelType: ChannelType;
  messages: MessageWithAuthor[];
  hasOlderMessages: boolean;
  loadingOlderMessages: boolean;
  loadOlderMessages: () => void;
  myId: string | undefined;
  canModerateMessages: boolean;
  onReact: (mid: string, emoji: string) => void;
  onEdit: (mid: string, content: string) => void;
  onDelete: (mid: string) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const openedChannelRef = useRef<string | null>(null);
  // Set right before loadOlderMessages() is called so the effect below can
  // keep whatever the user was looking at pinned in place once the older
  // page's messages are prepended above it, instead of jumping around.
  const olderScrollAnchorRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (olderScrollAnchorRef.current) {
      const { scrollHeight: prevHeight, scrollTop: prevTop } = olderScrollAnchorRef.current;
      el.scrollTop = prevTop + (el.scrollHeight - prevHeight);
      olderScrollAnchorRef.current = null;
      return;
    }
    const justOpened = openedChannelRef.current !== channelId;
    if (justOpened) {
      openedChannelRef.current = channelId;
      stickToBottomRef.current = true;
    }
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [channelId, messages]);

  return (
    <div
      ref={scrollerRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
        if (el.scrollTop < 200 && hasOlderMessages && !loadingOlderMessages) {
          olderScrollAnchorRef.current = { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop };
          loadOlderMessages();
        }
      }}
      className="flex-1 overflow-y-auto px-2 sm:px-6 py-6 space-y-1"
    >
      {loadingOlderMessages && (
        <div className="flex justify-center py-2">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      )}
      {!hasOlderMessages && (
        <div className="pb-6 border-b border-border mb-4">
          <div
            className="w-16 h-16 rounded-3xl grid place-items-center text-primary-foreground mb-4"
            style={{ backgroundImage: "var(--gradient-dexy)" }}
          >
            {(() => {
              const Icon = channelIcon[channelType];
              return <Icon className="w-7 h-7" />;
            })()}
          </div>
          <h2 className="text-2xl font-bold">Bem-vindo a #{channelName}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Este é o início do canal. Seja gentil.
          </p>
        </div>
      )}
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const compact = !!prev && prev.author_id === m.author_id;
        return (
          <MessageRow
            key={m.id}
            message={m}
            author={m.author}
            compact={compact}
            isMine={m.author_id === myId}
            myId={myId}
            canModerateMessages={canModerateMessages}
            onReact={(e) => onReact(m.id, e)}
            onEdit={(c) => onEdit(m.id, c)}
            onDelete={() => onDelete(m.id)}
          />
        );
      })}
    </div>
  );
}

function MessageRow({
  message,
  author,
  compact,
  isMine,
  myId,
  canModerateMessages,
  onReact,
  onEdit,
  onDelete,
}: {
  message: MessageWithAuthor;
  author: Profile;
  compact: boolean;
  isMine: boolean;
  myId: string | undefined;
  canModerateMessages: boolean;
  onReact: (emoji: string) => void;
  onEdit: (content: string) => void;
  onDelete: () => void;
}) {
  const [hover, setHover] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(message.content);
  const timestamp = formatTime(message.created_at);
  const { open } = useProfilePopover();

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`group relative flex gap-3 px-3 py-1 rounded-lg hover:bg-secondary/40 ${compact ? "mt-0.5" : "mt-3"}`}
    >
      {compact ? (
        <div className="w-10 shrink-0 text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 text-right pr-1 pt-1">
          {timestamp}
        </div>
      ) : (
        <button data-profile-trigger onClick={(e) => open(author, e.currentTarget)} className="shrink-0">
          <img src={avatarFor(author)} alt="" className="w-10 h-10 rounded-full object-cover bg-card" />
        </button>
      )}
      <div className="min-w-0 flex-1">
        {!compact && (
          <div className="flex items-baseline gap-2">
            <button
              data-profile-trigger
              onClick={(e) => open(author, e.currentTarget)}
              className="font-semibold text-foreground hover:underline"
            >
              {author.name}
            </button>
            <span className="text-xs text-muted-foreground">{timestamp}</span>
          </div>
        )}
        {editing ? (
          <div className="mt-1">
            <input
              autoFocus
              value={editVal}
              onChange={(e) => setEditVal(e.target.value)}
              className="w-full bg-secondary rounded-md px-3 py-2 outline-none border border-border focus:border-primary"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onEdit(editVal);
                  setEditing(false);
                }
                if (e.key === "Escape") {
                  setEditing(false);
                  setEditVal(message.content);
                }
              }}
            />
            <div className="mt-1 text-[11px] text-muted-foreground">
              Enter para salvar · Esc para cancelar
            </div>
          </div>
        ) : (
          <div className="text-[15px] leading-relaxed break-words">
            {message.content}
            {message.edited_at && (
              <span className="text-[10px] text-muted-foreground ml-1">(editado)</span>
            )}
          </div>
        )}
        {message.attachments.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-2">
            {message.attachments.map((a) => (
              <AttachmentPreview key={a.id} attachment={a} />
            ))}
          </div>
        )}
        <ReactionList reactions={message.reactions} myId={myId} onToggle={onReact} />
      </div>

      <AnimatePresence>
        {hover && !editing && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute -top-3 right-4 flex items-center bg-card border border-border rounded-lg shadow-lg divide-x divide-border"
          >
            <ReactionPicker onSelect={onReact} align="end">
              <ReactionButton />
            </ReactionPicker>
            <ActionBtn icon={Reply} />
            {/* Editing stays author-only — moderate_messages was only ever
                scoped to deletion (Etapa 5.2), RLS still only lets the
                author UPDATE a message's content. Deletion is the one
                split: author always can, and now owner/moderate_messages
                holder can too, matching the RLS added in Etapa 5.2. */}
            {isMine && <ActionBtn icon={Pencil} onClick={() => setEditing(true)} />}
            {(isMine || canModerateMessages) && <ActionBtn icon={Trash2} onClick={onDelete} danger />}
            <ActionBtn icon={MoreHorizontal} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

function AttachmentPreview({ attachment }: { attachment: Attachment }) {
  const { data: url } = useAttachmentUrl(attachment.path);
  const isImage = attachment.type.startsWith("image/") || IMAGE_EXT.test(attachment.name);

  if (isImage) {
    return url ? (
      <a href={url} target="_blank" rel="noreferrer" className="block max-w-xs">
        <img
          src={url}
          alt={attachment.name}
          className="max-w-xs max-h-64 rounded-lg border border-border object-cover"
        />
      </a>
    ) : (
      <div className="w-40 h-28 rounded-lg bg-secondary border border-border grid place-items-center">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 bg-secondary border border-border rounded-lg px-3 py-2 hover:border-primary/50 transition max-w-xs"
    >
      <FileText className="w-4 h-4 text-primary shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-sm truncate">{attachment.name}</div>
        <div className="text-xs text-muted-foreground">{formatFileSize(attachment.size)}</div>
      </div>
      <Download className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
    </a>
  );
}

function ActionBtn({
  icon: Icon,
  onClick,
  danger,
}: {
  icon: typeof Bell;
  onClick?: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`p-2 hover:bg-secondary transition ${danger ? "text-destructive" : "text-muted-foreground hover:text-foreground"}`}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}

function Composer({
  channelName,
  value,
  onChange,
  onSend,
  sending,
  pendingFile,
  onPickFile,
  onRemoveFile,
  error,
}: {
  channelName: string;
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  pendingFile: File | null;
  onPickFile: (file: File) => void;
  onRemoveFile: () => void;
  error: string | null;
}) {
  const fileInputId = "composer-file-input";
  return (
    <div className="px-2 sm:px-6 pb-4 pt-1">
      {pendingFile && (
        <div className="mb-2 flex items-center gap-2 bg-secondary border border-border rounded-lg px-3 py-2 w-fit max-w-full">
          <FileText className="w-4 h-4 text-primary shrink-0" />
          <span className="text-sm truncate max-w-50">{pendingFile.name}</span>
          <span className="text-xs text-muted-foreground shrink-0">
            {formatFileSize(pendingFile.size)}
          </span>
          <button
            onClick={onRemoveFile}
            className="p-0.5 rounded hover:bg-background text-muted-foreground shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
      <div className="flex items-end gap-2 bg-secondary rounded-xl border border-border focus-within:border-primary transition px-3 py-2">
        <input
          id={fileInputId}
          type="file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onPickFile(file);
            e.target.value = "";
          }}
        />
        <label
          htmlFor={fileInputId}
          className="p-2.5 rounded-full hover:bg-background text-muted-foreground cursor-pointer shrink-0"
        >
          <Paperclip className="w-4 h-4" />
        </label>
        <textarea
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={`Enviar mensagem em #${channelName}`}
          className="flex-1 min-w-0 bg-transparent outline-none resize-none py-2.5 max-h-40"
        />
        <button className="p-2.5 rounded-full hover:bg-background text-muted-foreground shrink-0">
          <Gift className="w-4 h-4" />
        </button>
        <button className="p-2.5 rounded-full hover:bg-background text-muted-foreground shrink-0">
          <Smile className="w-4 h-4" />
        </button>
        <button
          onClick={onSend}
          disabled={(!value.trim() && !pendingFile) || sending}
          className="p-2.5 rounded-full text-primary-foreground disabled:opacity-40 transition shrink-0"
          style={{ backgroundImage: "var(--gradient-dexy)" }}
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

function MembersPanel({
  members,
  roles,
  ownerId,
  canKickMembers,
  canAssignRoles,
  myId,
  onAssignRole,
  onKick,
  onClose,
}: {
  members: MemberWithProfile[];
  roles: ServerRole[];
  ownerId: string | null | undefined;
  canKickMembers: boolean;
  canAssignRoles: boolean;
  myId: string | undefined;
  onAssignRole: (member: MemberWithProfile, roleId: string | null) => void;
  onKick: (member: MemberWithProfile) => void;
  onClose: () => void;
}) {
  const { open } = useProfilePopover();
  const onlineIds = useOnlineUserIds();
  const grouped = useMemo(() => {
    const g: Record<UserStatus, MemberWithProfile[]> = {
      online: [],
      idle: [],
      dnd: [],
      offline: [],
    };
    members.forEach((m) => {
      const displayStatus = resolvePresenceStatus(m.profile.status as UserStatus, onlineIds.has(m.user_id));
      g[displayStatus].push(m);
    });
    return g;
  }, [members, onlineIds]);
  const labels: [UserStatus, string][] = [
    ["online", "Online"],
    ["idle", "Ausente"],
    ["dnd", "Não perturbe"],
    ["offline", "Offline"],
  ];
  return (
    <>
      <div
        className="lg:hidden fixed inset-0 z-30 bg-black/50"
        onClick={onClose}
      />
      <aside className="fixed inset-y-0 right-0 z-40 w-[min(85vw,320px)] rounded-l-2xl animate-in slide-in-from-right-4 fade-in duration-200 lg:static lg:z-auto lg:w-64 lg:rounded-[18px] lg:animate-none shrink-0 flex flex-col bg-sidebar overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border lg:hidden">
          <span className="text-sm font-semibold">Membros</span>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-secondary text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {labels.map(([s, l]) => {
          const list = grouped[s];
          if (!list.length) return null;
          return (
            <div key={s}>
              <div className="text-xs uppercase tracking-wider text-muted-foreground px-2 mb-1">
                {l} — {list.length}
              </div>
              <div className="space-y-0.5">
                {list.map((m) => {
                  // Real authorization is the RLS policy on server_members
                  // (owner OR kick_members holder, never the target's own
                  // row, owner never a valid target) — this only decides
                  // whether to render the hover action at all. Excluding
                  // ownerId explicitly matters now: previously only the
                  // owner ever saw this button at all, so "not my own row"
                  // was the only guard needed — a kick_members holder who
                  // isn't the owner must also never see a button that would
                  // target the owner's row, since RLS would always reject it.
                  const canKick = canKickMembers && m.user_id !== myId && m.user_id !== ownerId;
                  return (
                    <div key={m.user_id} className="group relative flex items-center">
                      <button
                        data-profile-trigger
                        onClick={(e) => open(m.profile, e.currentTarget)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-secondary transition text-left"
                      >
                        <div className="relative shrink-0">
                          <img
                            src={avatarFor(m.profile)}
                            alt=""
                            className={`w-8 h-8 rounded-full object-cover ${s === "offline" ? "opacity-50" : ""}`}
                          />
                          <span
                            className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-card ${statusColor[s]}`}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className={`text-sm truncate ${s === "offline" ? "text-muted-foreground" : "text-foreground"}`}>
                            {m.profile.name}
                          </div>
                          {m.role && (
                            <div className="flex items-center gap-1 mt-0.5">
                              <span
                                className="w-1.5 h-1.5 rounded-full shrink-0"
                                style={{ backgroundColor: m.role.color ?? "#99a1af" }}
                              />
                              <span className="text-[11px] text-muted-foreground truncate">{m.role.name}</span>
                            </div>
                          )}
                        </div>
                      </button>
                      {canAssignRoles && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              onClick={(e) => e.stopPropagation()}
                              title="Definir cargo"
                              className={`absolute p-1.5 rounded opacity-0 group-hover:opacity-100 hover:bg-secondary text-muted-foreground hover:text-foreground transition ${canKick ? "right-8" : "right-1"}`}
                            >
                              <Shield className="w-3.5 h-3.5" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44 rounded-xl border-border bg-card p-1">
                            <DropdownMenuItem
                              onClick={() => onAssignRole(m, null)}
                              className="rounded-lg px-2.5 py-1.5 text-sm cursor-pointer focus:bg-secondary flex items-center justify-between"
                            >
                              Nenhum cargo
                              {!m.role_id && <Check className="w-3.5 h-3.5" />}
                            </DropdownMenuItem>
                            {roles.map((r) => (
                              <DropdownMenuItem
                                key={r.id}
                                onClick={() => onAssignRole(m, r.id)}
                                className="rounded-lg px-2.5 py-1.5 text-sm cursor-pointer focus:bg-secondary flex items-center justify-between gap-2"
                              >
                                <span className="flex items-center gap-2 min-w-0">
                                  <span
                                    className="w-2.5 h-2.5 rounded-full shrink-0"
                                    style={{ backgroundColor: r.color ?? "#99a1af" }}
                                  />
                                  <span className="truncate">{r.name}</span>
                                </span>
                                {m.role_id === r.id && <Check className="w-3.5 h-3.5 shrink-0" />}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                      {canKick && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onKick(m);
                          }}
                          title="Expulsar membro"
                          className="absolute right-1 p-1.5 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition"
                        >
                          <UserX className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      </aside>
    </>
  );
}

const NOTIF_ROWS: {
  key: "notify_mentions" | "notify_all_messages" | "notify_sound";
  label: string;
  desc: string;
}[] = [
  {
    key: "notify_mentions",
    label: "Menções",
    desc: "Notificar quando alguém mencionar você. (O Dexy ainda não tem @menções — isso só guarda sua preferência por enquanto.)",
  },
  {
    key: "notify_all_messages",
    label: "Todas as mensagens",
    desc: "Notificar em qualquer mensagem nova. (Ainda não existe esse tipo de notificação — isso só guarda sua preferência por enquanto.)",
  },
  { key: "notify_sound", label: "Sons", desc: "Tocar sons ao receber mensagens e em chamadas." },
];

function SettingsView({
  profile,
  onSave,
  onClose,
}: {
  profile: Profile;
  onSave: (
    patch: Partial<
      Pick<
        Profile,
        "app_theme" | "language" | "notify_mentions" | "notify_all_messages" | "notify_sound"
      >
    >,
  ) => void;
  onClose: () => void;
}) {
  const tabs = ["Aparência", "Tema", "Idioma", "Notificações", "Perfil"];
  const [tab, setTab] = useState(tabs[0]);
  const [density, setDensity] = useState<"cozy" | "compact">("cozy");

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex-1 flex overflow-hidden"
    >
      <div className="w-56 shrink-0 border-r border-border p-4 space-y-1">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs uppercase text-muted-foreground">Configurações</div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-secondary text-muted-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`w-full text-left px-3 py-2 rounded-md text-sm transition ${
              tab === t
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-secondary/50"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-8 max-w-2xl">
        <h2 className="text-2xl font-bold">{tab}</h2>
        <div className="mt-6 space-y-6">
          {tab === "Aparência" && (
            <SettingRow label="Densidade" desc="Ajusta o espaçamento entre mensagens.">
              <div className="flex gap-2">
                {(["cozy", "compact"] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setDensity(d)}
                    className={`px-4 py-2 rounded-lg text-sm border transition ${density === d ? "border-primary bg-primary/10" : "border-border bg-secondary text-muted-foreground"}`}
                  >
                    {d === "cozy" ? "Confortável" : "Compacto"}
                  </button>
                ))}
              </div>
            </SettingRow>
          )}
          {tab === "Tema" && (
            <SettingRow
              label="Tema de cor"
              desc="Muda a cor de destaque em todo o Dexy — aplica na hora."
            >
              <div className="grid grid-cols-3 gap-3">
                {(["dark", "cyan", "lime"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => onSave({ app_theme: t })}
                    className={`p-4 rounded-xl border text-left transition ${profile.app_theme === t ? "border-primary" : "border-border"}`}
                  >
                    <div
                      className={`h-16 rounded-lg mb-2 bg-gradient-to-br ${
                        t === "dark"
                          ? "from-zinc-300 to-zinc-500"
                          : t === "cyan"
                            ? "from-[#24D5C4] to-[#30E4D2]"
                            : "from-[#8DFF2F] to-[#C8FF2A]"
                      }`}
                    />
                    <div className="text-sm font-medium capitalize">{t}</div>
                  </button>
                ))}
              </div>
            </SettingRow>
          )}
          {tab === "Idioma" && (
            <SettingRow
              label="Idioma"
              desc="A tradução completa da interface ainda está em construção — por enquanto isso só guarda sua preferência."
            >
              <select
                value={profile.language}
                onChange={(e) => onSave({ language: e.target.value })}
                className="bg-secondary border border-border rounded-lg px-3 py-2 outline-none"
              >
                <option value="pt-BR">Português (Brasil)</option>
                <option value="en">English</option>
                <option value="es">Español</option>
              </select>
            </SettingRow>
          )}
          {tab === "Notificações" && (
            <div className="space-y-3">
              {NOTIF_ROWS.map(({ key, label, desc }) => (
                <label
                  key={key}
                  className="flex items-start justify-between gap-4 p-4 border border-border rounded-xl bg-card"
                >
                  <div>
                    <div className="font-medium">{label}</div>
                    <div className="text-sm text-muted-foreground">{desc}</div>
                  </div>
                  <button
                    onClick={() => onSave({ [key]: !profile[key] })}
                    className={`relative w-11 h-6 rounded-full transition shrink-0 ${profile[key] ? "bg-primary" : "bg-muted"}`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-background transition ${profile[key] ? "translate-x-5" : ""}`}
                    />
                  </button>
                </label>
              ))}
            </div>
          )}
          {tab === "Perfil" && (
            <div className="text-sm text-muted-foreground">
              Vá em{" "}
              <button onClick={onClose} className="underline text-foreground">
                Perfil
              </button>{" "}
              para editar suas informações.
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function SettingRow({
  label,
  desc,
  children,
}: {
  label: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="font-medium">{label}</div>
      <div className="text-sm text-muted-foreground mb-3">{desc}</div>
      {children}
    </div>
  );
}
