import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Ban,
  Check,
  CheckCheck,
  Download,
  FileText,
  Loader2,
  Monitor,
  Paperclip,
  Pencil,
  Phone,
  Search,
  Send,
  Trash2,
  UserPlus,
  Video,
  X,
} from "lucide-react";
import {
  useAddDmAttachment,
  useDeleteDmMessage,
  useDmAttachmentUrl,
  useDmCalls,
  useDmConversations,
  useDmMessages,
  useDmReadState,
  useEditDmMessage,
  useFriendships,
  useGetOrCreateDm,
  useMarkDmRead,
  useOtherDmReadState,
  useRespondFriendRequest,
  useSendDmMessage,
  useSendFriendRequest,
  useToggleDmReaction,
  useUploadDmAttachment,
  type DmAttachment,
  type DmMessageWithAuthor,
  type FriendshipWithProfiles,
} from "@/lib/queries";
import { ReactionButton, ReactionList, ReactionPicker } from "@/components/MessageReactions";
import { useProfilePopover } from "@/components/ProfilePopover";
import { useCallElapsedMs, formatCallTimer, type DmCallRow, type DmCallHook } from "@/lib/livekit";
import {
  useIncomingMessageSound,
  playMessageSentSound,
} from "@/lib/callSounds";
import {
  IncomingCallBanner,
  OutgoingCallBanner,
  ActiveCallView,
  CallLogEntry,
  CallGroupDivider,
} from "@/components/DmCall";
import type { Database } from "@/lib/database.types";
import {
  avatarFor,
  formatFileSize,
  formatRelativeTime,
  resolvePresenceStatus,
  statusColor,
  statusLabel,
  statusRing,
  type UserStatus,
} from "@/lib/format";
import { useIsUserOnline, useOnlineUserIds } from "@/lib/presence";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export function DmSidebar({
  userId,
  activeConversationId,
  activeCall,
  onOpenConversation,
}: {
  userId: string;
  activeConversationId: string | undefined;
  activeCall?: DmCallHook | null;
  onOpenConversation: (conversationId: string, otherProfile: Profile) => void;
}) {
  const { data: friendships = [] } = useFriendships(userId);
  const { data: conversations = [] } = useDmConversations(userId);
  const { data: readState = [] } = useDmReadState(userId);
  const onlineIds = useOnlineUserIds();
  const activeCallConvId =
    activeCall && (activeCall.status === "active" || activeCall.status === "connecting")
      ? activeCall.call?.conversation_id
      : undefined;
  const activeCallElapsedMs = useCallElapsedMs(activeCall?.call?.answered_at);
  const sendRequest = useSendFriendRequest(userId);
  const respond = useRespondFriendRequest(userId);
  const getOrCreateDm = useGetOrCreateDm();

  const [handleInput, setHandleInput] = useState("");
  const [sendResult, setSendResult] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"conversas" | "amigos">("conversas");

  const otherProfileOf = (f: FriendshipWithProfiles) => (f.user_id === userId ? f.recipient : f.requester);
  const incoming = friendships.filter((f) => f.friend_id === userId && f.status === "pending");
  const accepted = friendships.filter((f) => f.status === "accepted");

  const readMap = useMemo(() => new Map(readState.map((r) => [r.conversation_id, r.last_read_at])), [readState]);
  const isUnread = (c: (typeof conversations)[number]) => {
    if (!c.lastMessage || c.lastMessage.author_id === userId) return false;
    const lastRead = readMap.get(c.id);
    return !lastRead || new Date(c.lastMessage.created_at) > new Date(lastRead);
  };

  const q = query.trim().toLowerCase();
  const filteredAccepted = q ? accepted.filter((f) => otherProfileOf(f).name.toLowerCase().includes(q)) : accepted;
  const filteredConversations = q
    ? conversations.filter((c) => (c.user_a === userId ? c.userB : c.userA).name.toLowerCase().includes(q))
    : conversations;

  const handleAddFriend = async (e: FormEvent) => {
    e.preventDefault();
    setSendResult(null);
    const handle = handleInput.trim();
    if (!handle) return;
    try {
      const outcome = await sendRequest.mutateAsync(handle);
      setHandleInput("");
      setSendResult({
        kind: "success",
        text: outcome === "auto_accepted" ? "Convite aceito ✓" : "Convite enviado ✓",
      });
    } catch (err) {
      setSendResult({
        kind: "error",
        text: err instanceof Error ? err.message : "Não foi possível concluir o envio agora. Tente novamente em instantes.",
      });
    }
  };

  useEffect(() => {
    if (!sendResult) return;
    const t = setTimeout(() => setSendResult(null), 4000);
    return () => clearTimeout(t);
  }, [sendResult]);

  const openWithFriend = async (friendProfile: Profile) => {
    const conversationId = await getOrCreateDm.mutateAsync(friendProfile.id);
    onOpenConversation(conversationId, friendProfile);
  };

  return (
    <div className="flex-1 overflow-y-auto py-3 px-2 space-y-3">
      <div className="px-2">
        <div className="flex items-center gap-2 bg-secondary border border-transparent focus-within:border-primary/50 rounded-lg px-2.5 py-1.5 transition">
          <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Encontre ou comece uma conversa"
            className="flex-1 min-w-0 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
          />
        </div>
      </div>

      <div className="flex items-center gap-1 px-2 border-b border-border">
        {(["conversas", "amigos"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`relative px-3 py-2 text-sm font-medium transition ${
              activeTab === tab ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab === "conversas" ? "Conversas" : "Amigos"}
            {tab === "amigos" && incoming.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold">
                {incoming.length}
              </span>
            )}
            {activeTab === tab && (
              <motion.div
                layoutId="dm-sidebar-tab-underline"
                className="absolute -bottom-px left-2 right-2 h-0.5 rounded-full"
                style={{ backgroundImage: "var(--gradient-dexy)" }}
                transition={{ duration: 0.2, ease: "easeInOut" }}
              />
            )}
          </button>
        ))}
      </div>

      {activeTab === "amigos" ? (
        <div className="space-y-4">
          <form onSubmit={handleAddFriend} className="px-2 space-y-1.5">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Adicionar amigo</div>
            <div className="flex gap-1.5">
              <div className="relative flex-1 min-w-0">
                <span className="absolute inset-y-0 left-2 flex items-center text-sm text-muted-foreground pointer-events-none">
                  @
                </span>
                <input
                  value={handleInput}
                  onChange={(e) => setHandleInput(e.target.value.replace(/^@/, ""))}
                  placeholder="handle do usuário"
                  className="w-full bg-secondary border border-border rounded-md pl-5 pr-2 py-1.5 text-sm outline-none focus:border-primary"
                />
              </div>
              <button
                type="submit"
                disabled={sendRequest.isPending || !handleInput.trim()}
                className="px-3 rounded-md text-primary-foreground disabled:opacity-40 transition"
                style={{ backgroundImage: "var(--gradient-dexy)" }}
              >
                <UserPlus className="w-4 h-4" />
              </button>
            </div>
            {sendResult && (
              <p
                className={`flex items-center gap-1 text-xs ${sendResult.kind === "success" ? "text-primary" : "text-destructive"}`}
              >
                {sendResult.kind === "success" ? (
                  <Check className="w-3 h-3 shrink-0" />
                ) : (
                  <X className="w-3 h-3 shrink-0" />
                )}
                {sendResult.text}
              </p>
            )}
          </form>

          {incoming.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground px-2 mb-1">
                Pedidos pendentes — {incoming.length}
              </div>
              <div className="space-y-2">
                {incoming.map((f) => {
                  const other = otherProfileOf(f);
                  return (
                    <div
                      key={other.id}
                      className="flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-secondary/50 transition duration-200"
                    >
                      <img src={avatarFor(other)} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{other.name}</div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          Convite recebido dessa pessoa — aceitar convite
                        </div>
                      </div>
                      <button
                        onClick={() => respond.mutate({ otherUserId: other.id, action: "accept" })}
                        className="p-1 rounded hover:bg-secondary text-primary"
                        title="Aceitar"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => respond.mutate({ otherUserId: other.id, action: "remove" })}
                        className="p-1 rounded hover:bg-secondary text-destructive"
                        title="Recusar"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground px-2 mb-1">
              Amigos — {accepted.length}
            </div>
            <div className="space-y-2">
              {filteredAccepted.map((f) => {
                const other = otherProfileOf(f);
                const status = resolvePresenceStatus(other.status as UserStatus, onlineIds.has(other.id));
                return (
                  <button
                    key={other.id}
                    onClick={() => openWithFriend(other)}
                    className="group w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-secondary/50 hover:-translate-y-0.5 text-left transition duration-200"
                  >
                    <div className="relative shrink-0">
                      <img
                        src={avatarFor(other)}
                        alt=""
                        className={`w-8 h-8 rounded-full object-cover ${statusRing[status]}`}
                      />
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card ${statusColor[status]}`}
                      />
                    </div>
                    <span className="text-sm truncate">{other.name}</span>
                  </button>
                );
              })}
              {accepted.length === 0 && <p className="text-xs text-muted-foreground px-2">Nenhum amigo ainda.</p>}
            </div>
          </div>
        </div>
      ) : (
        <div>
          <div className="space-y-3">
            {filteredConversations.map((c) => {
              const other = c.user_a === userId ? c.userB : c.userA;
              const active = c.id === activeConversationId;
              const unread = isUnread(c);
              const status = resolvePresenceStatus(other.status as UserStatus, onlineIds.has(other.id));
              const preview = c.lastMessage
                ? `${c.lastMessage.author_id === userId ? "Você: " : ""}${c.lastMessage.content}`
                : "Nenhuma mensagem ainda.";
              const timestamp = formatRelativeTime(c.lastMessage?.created_at ?? c.created_at);
              const inCall = c.id === activeCallConvId;
              return (
                <button
                  key={c.id}
                  onClick={() => onOpenConversation(c.id, other)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition duration-200 ${
                    active ? "text-foreground" : "hover:bg-secondary/50 hover:-translate-y-0.5 text-foreground"
                  }`}
                  style={
                    active
                      ? { backgroundImage: "linear-gradient(90deg, oklch(0.787 0.134 184.5 / 0.18), oklch(0.787 0.134 184.5 / 0.06))" }
                      : undefined
                  }
                >
                  <div className="relative shrink-0">
                    <img
                      src={avatarFor(other)}
                      alt=""
                      className={`w-10 h-10 rounded-full object-cover ${statusRing[status]}`}
                    />
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card ${statusColor[status]}`}
                    />
                    {inCall && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary text-primary-foreground grid place-items-center">
                        <Monitor className="w-2.5 h-2.5" />
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm truncate flex-1 ${unread ? "font-semibold" : "font-medium"}`}>
                        {other.name}
                      </span>
                      <span className="text-[11px] text-muted-foreground shrink-0">{timestamp}</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {inCall ? (
                        <span className="text-xs truncate flex-1 text-primary font-medium flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" />
                          Em chamada • {formatCallTimer(activeCallElapsedMs)}
                        </span>
                      ) : (
                        <span className={`text-xs truncate flex-1 ${unread ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                          {preview}
                        </span>
                      )}
                      {unread && !inCall && (
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundImage: "var(--gradient-dexy)" }}
                        />
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
            {conversations.length === 0 && (
              <p className="text-xs text-muted-foreground px-2">Nenhuma conversa ainda.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function DmChatView({
  conversationId,
  otherProfile,
  myProfile,
  dmCall,
  deafened,
}: {
  conversationId: string;
  otherProfile: Profile;
  myProfile: Profile;
  dmCall: DmCallHook;
  deafened?: boolean;
}) {
  const myId = myProfile.id;
  const { open: openProfilePopover } = useProfilePopover();
  const otherIsOnline = useIsUserOnline(otherProfile.id);
  const otherDisplayStatus = resolvePresenceStatus(otherProfile.status as UserStatus, otherIsOnline);
  const { messages, hasOlderMessages, loadingOlderMessages, loadOlderMessages } = useDmMessages(conversationId);
  const { data: calls = [] } = useDmCalls(conversationId);
  const { data: readState = [] } = useDmReadState(myId);
  const { data: otherReadState } = useOtherDmReadState(conversationId, otherProfile.id);
  const otherReadAt = otherReadState?.last_read_at ?? null;
  const sendMessage = useSendDmMessage(conversationId, myId);
  const editMessage = useEditDmMessage(conversationId);
  const deleteMessage = useDeleteDmMessage(conversationId);
  const toggleReaction = useToggleDmReaction(conversationId, myId);
  const markRead = useMarkDmRead(myId);
  const uploadAttachment = useUploadDmAttachment();
  const addAttachment = useAddDmAttachment();
  // Same useFriendships(myId) query DmSidebar already loads — React Query
  // dedupes by key, so this doesn't add a second network request. The RLS
  // policies (dm_messages/dm_calls/dm_message_attachments INSERT) are the
  // real authority here; this only drives what the UI shows/disables.
  const { data: friendships = [] } = useFriendships(myId);
  const friendshipRow = friendships.find(
    (f) =>
      (f.user_id === myId && f.friend_id === otherProfile.id) ||
      (f.user_id === otherProfile.id && f.friend_id === myId),
  );
  const isBlocked = friendshipRow?.status === "blocked";
  // `dmCall` is owned by the app shell now (not this view) so the call stays
  // connected when you navigate to a different conversation — it only shows
  // here inline when it actually belongs to the conversation being viewed.
  const callHere = dmCall.status !== "idle" && dmCall.call?.conversation_id === conversationId;
  const callBusyElsewhere = dmCall.status !== "idle" && dmCall.call?.conversation_id !== conversationId;
  useIncomingMessageSound(messages[messages.length - 1], conversationId, myId);
  const [draft, setDraft] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const readCutoffRef = useRef<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const openedConversationRef = useRef<string | null>(null);
  // Set right before loadOlderMessages() is called, so the scroll-restore
  // effect below can keep whatever the user was looking at pinned in place
  // once the older page's messages are prepended above it.
  const olderScrollAnchorRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);

  useEffect(() => {
    const existing = readState.find((r) => r.conversation_id === conversationId);
    readCutoffRef.current = existing?.last_read_at ?? null;
    setBannerDismissed(false);
    const t = setTimeout(() => markRead.mutate(conversationId), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);


  const unreadMessages = readCutoffRef.current
    ? messages.filter((m) => m.author_id !== myId && new Date(m.created_at) > new Date(readCutoffRef.current!))
    : [];

  const send = async () => {
    const text = draft.trim();
    if ((!text && !pendingFile) || isBlocked) return;
    setAttachError(null);
    try {
      const message = await sendMessage.mutateAsync(text);
      if (pendingFile && message) {
        const uploaded = await uploadAttachment.mutateAsync({ conversationId, file: pendingFile });
        await addAttachment.mutateAsync({ dmMessageId: message.id, ...uploaded });
      }
      setDraft("");
      setPendingFile(null);
      playMessageSentSound();
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

  const handleReact = (messageId: string, emoji: string) => {
    const msg = messages.find((m) => m.id === messageId);
    const already = msg?.reactions.some((r) => r.user_id === myId && r.emoji === emoji) ?? false;
    toggleReaction.mutate({ messageId, emoji, reacted: already });
  };

  const timeline = useMemo(() => {
    type RawItem =
      | { type: "message"; ts: number; message: DmMessageWithAuthor }
      | { type: "call"; ts: number; call: DmCallRow };

    const raw: RawItem[] = [
      ...messages.map((m) => ({ type: "message" as const, ts: new Date(m.created_at).getTime(), message: m })),
      ...calls
        .filter((c) => c.status === "ended" || c.status === "declined" || c.status === "missed")
        .map((c) => ({ type: "call" as const, ts: new Date(c.ended_at ?? c.started_at).getTime(), call: c })),
    ];
    raw.sort((a, b) => a.ts - b.ts);

    const nodes: React.ReactNode[] = [];
    let lastDateKey: string | null = null;
    let prevMessageAuthor: string | null = null;
    let i = 0;

    while (i < raw.length) {
      const item = raw[i];
      const dateKey = new Date(item.ts).toDateString();
      if (dateKey !== lastDateKey) {
        nodes.push(<DateDivider key={`date-${dateKey}`} dateKey={dateKey} />);
        lastDateKey = dateKey;
        prevMessageAuthor = null;
      }

      if (item.type === "message") {
        const compact = prevMessageAuthor === item.message.author_id;
        const isMine = item.message.author_id === myId;
        const isLastMine = isMine && !raw.slice(i + 1).some((r) => r.type === "message" && r.message.author_id === myId);
        nodes.push(
          <DmMessageRow
            key={`m-${item.message.id}`}
            message={item.message}
            compact={compact}
            isMine={isMine}
            myId={myId}
            read={isLastMine ? !!otherReadAt && new Date(otherReadAt) >= new Date(item.message.created_at) : undefined}
            onReact={(emoji) => handleReact(item.message.id, emoji)}
            onEdit={(content) => editMessage.mutate({ id: item.message.id, content })}
            onDelete={() => deleteMessage.mutate(item.message.id)}
          />,
        );
        prevMessageAuthor = item.message.author_id;
        i += 1;
        continue;
      }

      // Group every run of consecutive call entries (same day) under one divider.
      const runCalls: DmCallRow[] = [];
      while (i < raw.length && raw[i].type === "call" && new Date(raw[i].ts).toDateString() === dateKey) {
        runCalls.push((raw[i] as { type: "call"; call: DmCallRow }).call);
        i += 1;
      }
      prevMessageAuthor = null;
      nodes.push(
        <div key={`callgroup-${runCalls[0].id}`} className="max-w-[65%] mx-auto space-y-3 my-3">
          <CallGroupDivider />
          {runCalls.map((c) => (
            <CallLogEntry key={c.id} call={c} myId={myId} myProfile={myProfile} otherProfile={otherProfile} />
          ))}
        </div>,
      );
    }

    return nodes;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, calls, myId, myProfile, otherProfile, editMessage, deleteMessage, otherReadAt, toggleReaction]);

  // Every conversation opens scrolled to its most recent message, not the
  // start — and stays pinned to the bottom as new messages come in unless
  // the user has scrolled up to read history. Loading an older page is the
  // one case that should never jump to the bottom: it prepends content
  // above whatever the user was already looking at, so instead it restores
  // the exact same content under the viewport (see the scroll-height math
  // below) rather than falling into either of the other two branches.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (olderScrollAnchorRef.current) {
      const { scrollHeight: prevHeight, scrollTop: prevTop } = olderScrollAnchorRef.current;
      el.scrollTop = prevTop + (el.scrollHeight - prevHeight);
      olderScrollAnchorRef.current = null;
      return;
    }
    const justOpened = openedConversationRef.current !== conversationId;
    if (justOpened) {
      openedConversationRef.current = conversationId;
      stickToBottomRef.current = true;
    }
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [conversationId, timeline]);

  const inCall = callHere && (dmCall.status === "active" || dmCall.status === "connecting");
  const callElapsedMs = useCallElapsedMs(callHere ? dmCall.call?.answered_at : null);
  const screenShareActive = callHere && dmCall.participants.some((p) => p.screenShareTrack);

  return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="h-16 px-4 sm:px-6 flex items-center gap-3 border-b border-border shadow-sm shrink-0">
          <button
            data-profile-trigger
            onClick={(e) => openProfilePopover(otherProfile, e.currentTarget)}
            className="flex items-center gap-3 min-w-0 rounded-lg p-1 -m-1 hover:bg-secondary/50 transition text-left"
          >
            <div className="relative shrink-0">
              <img
                src={avatarFor(otherProfile)}
                alt=""
                className={`w-9 h-9 rounded-full object-cover ${statusRing[otherDisplayStatus]}`}
              />
              <span
                className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card ${statusColor[otherDisplayStatus]}`}
              />
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-lg leading-tight truncate">{otherProfile.name}</div>
              {inCall ? (
                <div className="text-xs text-primary leading-tight flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                  {dmCall.status === "connecting" ? "Conectando…" : `Em chamada • ${formatCallTimer(callElapsedMs)}`}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground leading-tight">
                  {statusLabel[otherDisplayStatus]}
                </div>
              )}
            </div>
          </button>
          <div className="ml-auto flex items-center gap-1 text-muted-foreground">
            <button
              onClick={() => dmCall.start("audio")}
              disabled={dmCall.status !== "idle" || isBlocked}
              className="p-2 rounded hover:bg-secondary transition disabled:opacity-30"
              title={isBlocked ? "Bloqueado" : "Chamada de voz"}
            >
              <Phone className="w-4 h-4" />
            </button>
            <button
              onClick={() => dmCall.start("video")}
              disabled={dmCall.status !== "idle" || isBlocked}
              className="p-2 rounded hover:bg-secondary transition disabled:opacity-30"
              title={isBlocked ? "Bloqueado" : "Chamada de vídeo"}
            >
              <Video className="w-4 h-4" />
            </button>
          </div>
        </div>

        {dmCall.error && (
          <div className="mx-3 sm:mx-6 mt-3 px-4 py-2 rounded-lg border border-destructive/40 bg-destructive/10 text-sm text-destructive">
            {dmCall.error}
          </div>
        )}

        <AnimatePresence>
          {dmCall.status === "incoming" && dmCall.call && callHere && (
            <IncomingCallBanner
              callerProfile={otherProfile}
              kind={dmCall.call.kind}
              onAccept={dmCall.accept}
              onDecline={dmCall.decline}
            />
          )}
          {dmCall.status === "outgoing" && callHere && <OutgoingCallBanner otherProfile={otherProfile} onCancel={dmCall.hangup} />}
          {(dmCall.status === "connecting" || dmCall.status === "active") && callHere && (
            <ActiveCallView
              myProfile={myProfile}
              otherProfile={otherProfile}
              participants={dmCall.participants}
              connecting={dmCall.status === "connecting"}
              reconnecting={dmCall.reconnecting}
              micEnabled={dmCall.micEnabled}
              cameraEnabled={dmCall.cameraEnabled}
              screenShareEnabled={dmCall.screenShareEnabled}
              onToggleMic={dmCall.toggleMic}
              onToggleCamera={dmCall.toggleCamera}
              onToggleScreenShare={dmCall.toggleScreenShare}
              onStopScreenShare={dmCall.stopScreenShare}
              onHangup={dmCall.hangup}
              deafened={deafened}
              fillAvailableHeight={screenShareActive}
            />
          )}
        </AnimatePresence>

        {/* While sharing, the call view takes over the whole remaining
            column (video sized to whatever's actually left, never causing
            page scroll) instead of squeezing above a visible message list —
            matches how Discord's own screen-share view works. */}
        {!screenShareActive && (
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
          className={`flex-1 overflow-y-auto dm-starfield transition-[filter] duration-500 ${
            inCall ? "brightness-55 saturate-85" : ""
          }`}
        >
          <div className="px-4 sm:px-8 py-6">
            <div className="space-y-2">
              {loadingOlderMessages && (
                <div className="flex justify-center py-2">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              )}
              {!bannerDismissed && unreadMessages.length > 0 && (
                <div
                  className="sticky top-0 z-10 -mx-4 sm:-mx-8 mb-3 px-4 sm:px-8 py-2 flex items-center justify-between text-sm border-b border-primary/30 backdrop-blur"
                  style={{
                    backgroundImage: "linear-gradient(90deg, oklch(0.787 0.134 184.5 / 0.16), oklch(0.83 0.139 184.4 / 0.16))",
                  }}
                >
                  <span>
                    {unreadMessages.length} mensagen{unreadMessages.length === 1 ? "" : "s"} nova
                    {unreadMessages.length === 1 ? "" : "s"}
                  </span>
                  <button onClick={() => setBannerDismissed(true)} className="font-semibold text-primary hover:underline">
                    Marcar como lida
                  </button>
                </div>
              )}
              {timeline}
            </div>
          </div>
        </div>
        )}

        {!screenShareActive && (
        <div className="px-4 sm:px-8 pb-5 pt-1">
          {isBlocked && (
            <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
              <Ban className="w-3.5 h-3.5 shrink-0" />
              Vocês não podem trocar mensagens ou chamadas — um dos dois bloqueou o outro. O histórico continua visível.
            </div>
          )}
          {pendingFile && (
            <div className="mb-2 flex items-center gap-2 bg-secondary border border-border rounded-lg px-3 py-2 w-fit max-w-full">
              <FileText className="w-4 h-4 text-primary shrink-0" />
              <span className="text-sm truncate max-w-50">{pendingFile.name}</span>
              <span className="text-xs text-muted-foreground shrink-0">{formatFileSize(pendingFile.size)}</span>
              <button
                onClick={() => setPendingFile(null)}
                className="p-0.5 rounded hover:bg-background text-muted-foreground shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {attachError && <p className="mb-2 text-xs text-destructive">{attachError}</p>}
          <div className="flex items-end gap-2 bg-secondary rounded-2xl border border-border focus-within:border-primary transition duration-200 px-4 py-2.5 has-disabled:opacity-50">
            <input
              id="dm-composer-file-input"
              type="file"
              className="hidden"
              disabled={isBlocked}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handlePickFile(file);
                e.target.value = "";
              }}
            />
            <label
              htmlFor="dm-composer-file-input"
              className={`p-2.5 rounded-full text-muted-foreground transition shrink-0 ${isBlocked ? "opacity-30 pointer-events-none" : "hover:bg-background cursor-pointer"}`}
            >
              <Paperclip className="w-4 h-4" />
            </label>
            <textarea
              rows={1}
              value={draft}
              disabled={isBlocked}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={isBlocked ? "Bloqueado" : `Enviar mensagem para ${otherProfile.name}`}
              className="flex-1 bg-transparent outline-none resize-none py-2 max-h-40 disabled:opacity-50"
            />
            <button
              onClick={send}
              disabled={(!draft.trim() && !pendingFile) || sendMessage.isPending || uploadAttachment.isPending || isBlocked}
              className="w-10 h-10 rounded-full grid place-items-center text-primary-foreground disabled:opacity-40 transition duration-200 hover:brightness-110 hover:scale-105 shadow-[var(--shadow-glow)]"
              style={{ backgroundImage: "var(--gradient-dexy)" }}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
        )}
      </div>
  );
}

function DateDivider({ dateKey }: { dateKey: string }) {
  const label = useMemo(() => {
    const date = new Date(dateKey);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return "Hoje";
    if (date.toDateString() === yesterday.toDateString()) return "Ontem";
    return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  }, [dateKey]);

  return (
    <div className="flex items-center gap-3 py-2 text-xs text-muted-foreground">
      <div className="flex-1 h-px bg-white/10" />
      <span>{label}</span>
      <div className="flex-1 h-px bg-white/10" />
    </div>
  );
}

function DmMessageRow({
  message,
  compact,
  isMine,
  myId,
  read,
  onReact,
  onEdit,
  onDelete,
}: {
  message: DmMessageWithAuthor;
  compact: boolean;
  isMine: boolean;
  myId: string | undefined;
  read?: boolean;
  onReact: (emoji: string) => void;
  onEdit: (content: string) => void;
  onDelete: () => void;
}) {
  const [hover, setHover] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(message.content);
  const timestamp = new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const { open } = useProfilePopover();
  const authorIsOnline = useIsUserOnline(message.author.id);
  const authorDisplayStatus = resolvePresenceStatus(message.author.status as UserStatus, authorIsOnline);

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`group relative flex gap-3 px-3 py-1 rounded-lg hover:bg-secondary/40 ${compact ? "mt-0.5" : "mt-3"} ${
        isMine ? "flex-row-reverse" : ""
      }`}
    >
      {compact ? (
        <div className="w-10 shrink-0" />
      ) : (
        <button data-profile-trigger onClick={(e) => open(message.author, e.currentTarget)} className="shrink-0">
          <img
            src={avatarFor(message.author)}
            alt=""
            className={`w-10 h-10 rounded-full object-cover bg-card ${statusRing[authorDisplayStatus]}`}
          />
        </button>
      )}
      <div className={`min-w-0 flex-1 flex flex-col ${isMine ? "items-end" : "items-start"}`}>
        {editing ? (
          <div className="mt-1 w-full">
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
            <div className="mt-1 text-[11px] text-muted-foreground">Enter para salvar · Esc para cancelar</div>
          </div>
        ) : (
          <div
            className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed break-words shadow-sm ${
              isMine ? "border border-primary/15" : "bg-secondary/70"
            }`}
            style={isMine ? { backgroundImage: "linear-gradient(135deg, oklch(0.787 0.134 184.5 / 0.16), oklch(0.83 0.139 184.4 / 0.1))" } : undefined}
          >
            {!compact && (
              <button
                data-profile-trigger
                onClick={(e) => open(message.author, e.currentTarget)}
                className="font-semibold text-foreground mb-0.5 hover:underline block"
              >
                {message.author.name}
              </button>
            )}
            <div>
              {message.content}
              {message.edited_at && <span className="text-[10px] text-muted-foreground ml-1">(editado)</span>}
            </div>
            {message.attachments.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-2">
                {message.attachments.map((a) => (
                  <DmAttachmentPreview key={a.id} attachment={a} />
                ))}
              </div>
            )}
            <div className="flex items-center justify-end gap-1 mt-1 -mb-0.5">
              <span className="text-[10px] text-muted-foreground/70">{timestamp}</span>
              {isMine && read !== undefined && (
                read ? (
                  <CheckCheck className="w-3.5 h-3.5 text-primary" />
                ) : (
                  <Check className="w-3.5 h-3.5 text-muted-foreground/70" />
                )
              )}
            </div>
          </div>
        )}
        <ReactionList reactions={message.reactions} myId={myId} onToggle={onReact} />
      </div>

      {hover && !editing && (
        <div
          className={`absolute -top-3 ${isMine ? "left-4" : "right-4"} flex items-center bg-card border border-border rounded-lg shadow-lg divide-x divide-border`}
        >
          <ReactionPicker onSelect={onReact} align={isMine ? "start" : "end"}>
            <ReactionButton />
          </ReactionPicker>
          {isMine && (
            <>
              <button
                onClick={() => setEditing(true)}
                className="p-2 hover:bg-secondary text-muted-foreground hover:text-foreground transition"
              >
                <Pencil className="w-4 h-4" />
              </button>
              <button onClick={onDelete} className="p-2 hover:bg-secondary text-destructive transition">
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const DM_IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

function DmAttachmentPreview({ attachment }: { attachment: DmAttachment }) {
  const { data: url } = useDmAttachmentUrl(attachment.path);
  const isImage = attachment.type.startsWith("image/") || DM_IMAGE_EXT.test(attachment.name);

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
