import { useState, type FormEvent } from "react";
import { Check, Pencil, Send, Trash2, UserPlus, X } from "lucide-react";
import {
  useDeleteDmMessage,
  useDmConversations,
  useDmMessages,
  useEditDmMessage,
  useFriendships,
  useGetOrCreateDm,
  useRespondFriendRequest,
  useSendDmMessage,
  useSendFriendRequest,
  type DmMessageWithAuthor,
  type FriendshipWithProfiles,
} from "@/lib/queries";
import type { Database } from "@/lib/database.types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

function avatarFor(profile: Pick<Profile, "id" | "avatar_url">) {
  return profile.avatar_url || `https://api.dicebear.com/9.x/glass/svg?seed=${profile.id}`;
}

export function DmSidebar({
  userId,
  activeConversationId,
  onOpenConversation,
}: {
  userId: string;
  activeConversationId: string | undefined;
  onOpenConversation: (conversationId: string, otherProfile: Profile) => void;
}) {
  const { data: friendships = [] } = useFriendships(userId);
  const { data: conversations = [] } = useDmConversations(userId);
  const sendRequest = useSendFriendRequest(userId);
  const respond = useRespondFriendRequest(userId);
  const getOrCreateDm = useGetOrCreateDm();

  const [handleInput, setHandleInput] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);

  const otherProfileOf = (f: FriendshipWithProfiles) => (f.user_id === userId ? f.recipient : f.requester);
  const incoming = friendships.filter((f) => f.friend_id === userId && f.status === "pending");
  const accepted = friendships.filter((f) => f.status === "accepted");

  const handleAddFriend = async (e: FormEvent) => {
    e.preventDefault();
    setSendError(null);
    const handle = handleInput.trim();
    if (!handle) return;
    try {
      await sendRequest.mutateAsync(handle);
      setHandleInput("");
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Não foi possível enviar.");
    }
  };

  const openWithFriend = async (friendProfile: Profile) => {
    const conversationId = await getOrCreateDm.mutateAsync(friendProfile.id);
    onOpenConversation(conversationId, friendProfile);
  };

  return (
    <div className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
      <form onSubmit={handleAddFriend} className="px-2 space-y-1.5">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Adicionar amigo</div>
        <div className="flex gap-1.5">
          <input
            value={handleInput}
            onChange={(e) => setHandleInput(e.target.value)}
            placeholder="handle do usuário"
            className="flex-1 min-w-0 bg-secondary border border-border rounded-md px-2 py-1.5 text-sm outline-none focus:border-primary"
          />
          <button
            type="submit"
            disabled={sendRequest.isPending || !handleInput.trim()}
            className="px-3 rounded-md text-primary-foreground disabled:opacity-40 transition"
            style={{ backgroundImage: "var(--gradient-dexy)" }}
          >
            <UserPlus className="w-4 h-4" />
          </button>
        </div>
        {sendError && <p className="text-xs text-destructive">{sendError}</p>}
      </form>

      {incoming.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground px-2 mb-1">
            Pedidos pendentes — {incoming.length}
          </div>
          <div className="space-y-0.5">
            {incoming.map((f) => {
              const other = otherProfileOf(f);
              return (
                <div
                  key={other.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-secondary/50"
                >
                  <img src={avatarFor(other)} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                  <span className="text-sm truncate flex-1">{other.name}</span>
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
        <div className="space-y-0.5">
          {accepted.map((f) => {
            const other = otherProfileOf(f);
            return (
              <button
                key={other.id}
                onClick={() => openWithFriend(other)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-secondary/50 text-left transition"
              >
                <img src={avatarFor(other)} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                <span className="text-sm truncate">{other.name}</span>
              </button>
            );
          })}
          {accepted.length === 0 && <p className="text-xs text-muted-foreground px-2">Nenhum amigo ainda.</p>}
        </div>
      </div>

      {conversations.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground px-2 mb-1">Conversas</div>
          <div className="space-y-0.5">
            {conversations.map((c) => {
              const other = c.user_a === userId ? c.userB : c.userA;
              const active = c.id === activeConversationId;
              return (
                <button
                  key={c.id}
                  onClick={() => onOpenConversation(c.id, other)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition ${
                    active ? "bg-secondary text-foreground" : "hover:bg-secondary/50 text-muted-foreground"
                  }`}
                >
                  <img src={avatarFor(other)} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                  <span className="text-sm truncate">{other.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function DmChatView({
  conversationId,
  otherProfile,
  myId,
}: {
  conversationId: string;
  otherProfile: Profile;
  myId: string;
}) {
  const { data: messages = [] } = useDmMessages(conversationId);
  const sendMessage = useSendDmMessage(conversationId, myId);
  const editMessage = useEditDmMessage(conversationId);
  const deleteMessage = useDeleteDmMessage(conversationId);
  const [draft, setDraft] = useState("");

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    sendMessage.mutate(text);
    setDraft("");
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-1">
        <div className="pb-6 border-b border-border mb-4 flex items-center gap-3">
          <img src={avatarFor(otherProfile)} alt="" className="w-14 h-14 rounded-full object-cover" />
          <div>
            <h2 className="text-xl font-bold">{otherProfile.name}</h2>
            <p className="text-sm text-muted-foreground">@{otherProfile.handle}</p>
          </div>
        </div>
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const compact = !!prev && prev.author_id === m.author_id;
          return (
            <DmMessageRow
              key={m.id}
              message={m}
              compact={compact}
              isMine={m.author_id === myId}
              onEdit={(content) => editMessage.mutate({ id: m.id, content })}
              onDelete={() => deleteMessage.mutate(m.id)}
            />
          );
        })}
      </div>
      <div className="px-4 sm:px-6 pb-4 pt-1">
        <div className="flex items-end gap-2 bg-secondary rounded-xl border border-border focus-within:border-primary transition px-3 py-2">
          <textarea
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={`Enviar mensagem para ${otherProfile.name}`}
            className="flex-1 bg-transparent outline-none resize-none py-2 max-h-40"
          />
          <button
            onClick={send}
            disabled={!draft.trim()}
            className="p-2 rounded-full text-primary-foreground disabled:opacity-40 transition"
            style={{ backgroundImage: "var(--gradient-dexy)" }}
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function DmMessageRow({
  message,
  compact,
  isMine,
  onEdit,
  onDelete,
}: {
  message: DmMessageWithAuthor;
  compact: boolean;
  isMine: boolean;
  onEdit: (content: string) => void;
  onDelete: () => void;
}) {
  const [hover, setHover] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(message.content);
  const timestamp = new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`group relative flex gap-3 px-3 py-1 rounded-lg hover:bg-secondary/40 ${compact ? "mt-0.5" : "mt-3"}`}
    >
      {compact ? (
        <div className="w-10 shrink-0 text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 text-right pr-1 pt-1">
          {timestamp}
        </div>
      ) : (
        <img
          src={avatarFor(message.author)}
          alt=""
          className="w-10 h-10 rounded-full shrink-0 object-cover bg-card"
        />
      )}
      <div className="min-w-0 flex-1">
        {!compact && (
          <div className="flex items-baseline gap-2">
            <span className="font-semibold text-foreground">{message.author.name}</span>
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
            <div className="mt-1 text-[11px] text-muted-foreground">Enter para salvar · Esc para cancelar</div>
          </div>
        ) : (
          <div className="text-[15px] leading-relaxed break-words">
            {message.content}
            {message.edited_at && <span className="text-[10px] text-muted-foreground ml-1">(editado)</span>}
          </div>
        )}
      </div>

      {hover && !editing && isMine && (
        <div className="absolute -top-3 right-4 flex items-center bg-card border border-border rounded-lg shadow-lg divide-x divide-border">
          <button
            onClick={() => setEditing(true)}
            className="p-2 hover:bg-secondary text-muted-foreground hover:text-foreground transition"
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button onClick={onDelete} className="p-2 hover:bg-secondary text-destructive transition">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
