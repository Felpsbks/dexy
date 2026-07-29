import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
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
  Inbox,
  Pin,
  ChevronDown,
  X,
  Mic,
  Headphones,
  Clapperboard,
  Loader2,
  LogOut,
} from "lucide-react";
import { DexyLogo } from "@/components/DexyLogo";
import { StudioView } from "@/components/StudioView";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/auth";
import {
  useChannels,
  useDeleteMessage,
  useEditMessage,
  useMembers,
  useMessages,
  useProfile,
  useSendMessage,
  useServers,
  useToggleReaction,
  useUpdateProfile,
  type MemberWithProfile,
  type MessageWithAuthor,
} from "@/lib/queries";
import type { Database } from "@/lib/database.types";

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [
      { title: "Dexy — Aplicação" },
      { name: "description", content: "Espaço de trabalho do Dexy — conversas, canais e comunidades." },
    ],
  }),
  component: AppPage,
});

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Server = Database["public"]["Tables"]["servers"]["Row"];
type Channel = Database["public"]["Tables"]["channels"]["Row"];
type UserStatus = "online" | "idle" | "dnd" | "offline";
type ChannelType = "text" | "voice" | "forum";

const statusColor: Record<UserStatus, string> = {
  online: "bg-emerald-500",
  idle: "bg-amber-400",
  dnd: "bg-rose-500",
  offline: "bg-zinc-500",
};

const statusLabel: Record<UserStatus, string> = {
  online: "Online",
  idle: "Ausente",
  dnd: "Não perturbe",
  offline: "Offline",
};

const channelIcon: Record<ChannelType, typeof Hash> = {
  text: Hash,
  voice: Volume2,
  forum: MessageSquareText,
};

function avatarFor(profile: Pick<Profile, "id" | "avatar_url">) {
  return profile.avatar_url || `https://api.dicebear.com/9.x/glass/svg?seed=${profile.id}`;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function aggregateReactions(
  rows: { emoji: string; user_id: string }[],
  myId: string | undefined,
) {
  const map = new Map<string, { emoji: string; count: number; reacted: boolean }>();
  for (const r of rows) {
    const existing = map.get(r.emoji);
    if (existing) {
      existing.count += 1;
      if (r.user_id === myId) existing.reacted = true;
    } else {
      map.set(r.emoji, { emoji: r.emoji, count: 1, reacted: r.user_id === myId });
    }
  }
  return Array.from(map.values());
}

type PanelView = "chat" | "profile" | "settings";
type PanelViewExt = PanelView | "studio";

function AppPage() {
  const router = useRouter();
  const session = useSession();
  const userId = session?.user.id;

  const { data: profile } = useProfile(userId);
  const { data: servers = [] } = useServers();
  const [activeServer, setActiveServer] = useState<string | undefined>(undefined);
  const { data: channels = [] } = useChannels(activeServer);
  const [activeChannel, setActiveChannel] = useState<string | undefined>(undefined);
  const { data: members = [] } = useMembers(activeServer);
  const { data: messages = [] } = useMessages(activeChannel);

  const sendMessage = useSendMessage(activeChannel, userId);
  const editMessage = useEditMessage(activeChannel);
  const deleteMessage = useDeleteMessage(activeChannel);
  const toggleReaction = useToggleReaction(activeChannel, userId);
  const updateProfile = useUpdateProfile(userId);

  const [draft, setDraft] = useState("");
  const [view, setView] = useState<PanelViewExt>("chat");
  const [membersOpen, setMembersOpen] = useState(true);
  const [mobileSidebar, setMobileSidebar] = useState(false);

  useEffect(() => {
    if (session === null) router.navigate({ to: "/" });
  }, [session, router]);

  useEffect(() => {
    if (!activeServer && servers.length > 0) setActiveServer(servers[0].id);
  }, [servers, activeServer]);

  useEffect(() => {
    if (channels.length > 0 && !channels.some((c) => c.id === activeChannel)) {
      setActiveChannel(channels[0].id);
    }
  }, [channels, activeChannel]);

  useEffect(() => {
    if (userId && profile && profile.status !== "online") {
      updateProfile.mutate({ status: "online" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, profile?.status]);

  const categorized = useMemo(() => {
    const map = new Map<string, Channel[]>();
    channels.forEach((c) => {
      const arr = map.get(c.category) ?? [];
      arr.push(c);
      map.set(c.category, arr);
    });
    return Array.from(map.entries());
  }, [channels]);

  if (session === undefined) {
    return <LoadingScreen />;
  }
  if (!session) {
    return null;
  }
  if (!profile) {
    return <LoadingScreen />;
  }

  const channel = channels.find((c) => c.id === activeChannel);
  if (!activeServer || !channel) {
    return <LoadingScreen />;
  }

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    sendMessage.mutate(text);
    setDraft("");
  };

  const handleReact = (mid: string, emoji: string) => {
    const msg = messages.find((m) => m.id === mid);
    const already = msg?.reactions.some((r) => r.user_id === userId && r.emoji === emoji) ?? false;
    toggleReaction.mutate({ messageId: mid, emoji, reacted: already });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    router.navigate({ to: "/" });
  };

  return (
    <div className="h-screen w-screen overflow-hidden bg-background text-foreground flex">
      {/* Server rail */}
      <aside className="hidden sm:flex w-[72px] shrink-0 flex-col items-center gap-2 py-3 bg-sidebar border-r border-border">
        <Link to="/" className="mb-2">
          <DexyLogo size={36} />
        </Link>
        <div className="w-8 h-px bg-border" />
        {servers.map((s: Server) => {
          const active = s.id === activeServer;
          return (
            <button
              key={s.id}
              onClick={() => setActiveServer(s.id)}
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
                  active ? "rounded-2xl shadow-[var(--shadow-glow)]" : "rounded-3xl group-hover:rounded-2xl"
                }`}
              >
                {s.icon_initial ?? s.name.charAt(0).toUpperCase()}
              </div>
            </button>
          );
        })}
        <button className="w-12 h-12 rounded-3xl hover:rounded-2xl grid place-items-center bg-card text-primary border border-border transition-all hover:bg-primary/10">
          <Plus className="w-5 h-5" />
        </button>
        <div className="mt-auto flex flex-col gap-2">
          <button
            onClick={() => setView("settings")}
            className="w-12 h-12 rounded-2xl grid place-items-center bg-card hover:bg-secondary transition"
          >
            <Settings className="w-5 h-5 text-muted-foreground" />
          </button>
          <button onClick={() => setView("profile")} className="relative">
            <img src={avatarFor(profile)} alt="" className="w-12 h-12 rounded-2xl object-cover bg-card" />
            <span
              className={`absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-sidebar ${
                statusColor[profile.status as UserStatus]
              }`}
            />
          </button>
        </div>
      </aside>

      {/* Channels sidebar */}
      <aside
        className={`${mobileSidebar ? "flex" : "hidden"} md:flex w-64 shrink-0 flex-col bg-card border-r border-border`}
      >
        <div className="h-14 px-4 flex items-center justify-between border-b border-border shadow-sm">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold truncate">
              {servers.find((s) => s.id === activeServer)?.name}
            </span>
          </div>
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        </div>
        <div className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
          {categorized.map(([category, list]) => (
            <CategoryGroup
              key={category}
              title={category}
              list={list}
              activeId={activeChannel}
              onSelect={(id) => {
                setActiveChannel(id);
                setView("chat");
                setMobileSidebar(false);
              }}
            />
          ))}
        </div>
        {/* Voice/status bar */}
        <div className="h-14 px-2 flex items-center gap-2 bg-sidebar border-t border-border">
          <img src={avatarFor(profile)} alt="" className="w-8 h-8 rounded-full object-cover" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{profile.name}</div>
            <div className="text-xs text-muted-foreground truncate">
              {statusLabel[profile.status as UserStatus]}
            </div>
          </div>
          <button className="p-2 rounded hover:bg-secondary text-muted-foreground"><Mic className="w-4 h-4" /></button>
          <button className="p-2 rounded hover:bg-secondary text-muted-foreground"><Headphones className="w-4 h-4" /></button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="h-14 px-4 flex items-center gap-3 border-b border-border bg-background/80 backdrop-blur">
          <button
            className="md:hidden p-2 rounded hover:bg-secondary"
            onClick={() => setMobileSidebar((v) => !v)}
          >
            <ChannelIconInline type={channel.type as ChannelType} />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <ChannelIconInline type={channel.type as ChannelType} />
            <span className="font-semibold truncate">{channel.name}</span>
            {channel.topic ? (
              <>
                <span className="hidden sm:block w-px h-5 bg-border mx-2" />
                <span className="hidden sm:block text-sm text-muted-foreground truncate">{channel.topic}</span>
              </>
            ) : null}
          </div>
          <div className="ml-auto flex items-center gap-1 text-muted-foreground">
            <IconBtn icon={Pin} />
            <IconBtn icon={Bell} />
            <IconBtn icon={Inbox} />
            <IconBtn icon={Clapperboard} onClick={() => setView("studio")} />
            <div className="hidden sm:flex items-center gap-2 ml-2 px-3 py-1.5 bg-secondary rounded-md text-sm">
              <Search className="w-3.5 h-3.5" />
              <input className="bg-transparent outline-none placeholder:text-muted-foreground w-36" placeholder="Buscar" />
            </div>
            <IconBtn icon={Users} onClick={() => setMembersOpen((v) => !v)} />
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          <section className="flex-1 flex flex-col min-w-0">
            <AnimatePresence mode="wait">
              {view === "chat" && (
                <motion.div
                  key="chat"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex-1 flex flex-col min-h-0"
                >
                  <ChatArea
                    channelName={channel.name}
                    channelType={channel.type as ChannelType}
                    messages={messages}
                    myId={userId}
                    onReact={handleReact}
                    onEdit={(mid, content) => editMessage.mutate({ id: mid, content })}
                    onDelete={(mid) => deleteMessage.mutate(mid)}
                  />
                  <Composer
                    channelName={channel.name}
                    value={draft}
                    onChange={setDraft}
                    onSend={send}
                  />
                </motion.div>
              )}
              {view === "profile" && (
                <ProfileView
                  key="profile"
                  profile={profile}
                  saving={updateProfile.isPending}
                  onSave={(patch) => updateProfile.mutate(patch)}
                  onSignOut={signOut}
                  onClose={() => setView("chat")}
                />
              )}
              {view === "settings" && <SettingsView key="settings" onClose={() => setView("chat")} />}
              {view === "studio" && (
                <StudioView
                  key="studio"
                  onClose={() => setView("chat")}
                  onApplyAvatar={(url) => updateProfile.mutate({ avatar_url: url })}
                />
              )}
            </AnimatePresence>
          </section>

          {membersOpen && view === "chat" && <MembersPanel members={members} />}
        </div>
      </main>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="h-screen w-screen grid place-items-center bg-background text-foreground">
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

function IconBtn({ icon: Icon, onClick }: { icon: typeof Bell; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="p-2 rounded hover:bg-secondary transition">
      <Icon className="w-4 h-4" />
    </button>
  );
}

function CategoryGroup({
  title,
  list,
  activeId,
  onSelect,
}: {
  title: string;
  list: Channel[];
  activeId: string | undefined;
  onSelect: (id: string) => void;
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
            {list.map((c) => {
              const Icon = channelIcon[c.type as ChannelType];
              const active = c.id === activeId;
              return (
                <button
                  key={c.id}
                  onClick={() => onSelect(c.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm transition ${
                    active
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{c.name}</span>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ChatArea({
  channelName,
  channelType,
  messages,
  myId,
  onReact,
  onEdit,
  onDelete,
}: {
  channelName: string;
  channelType: ChannelType;
  messages: MessageWithAuthor[];
  myId: string | undefined;
  onReact: (mid: string, emoji: string) => void;
  onEdit: (mid: string, content: string) => void;
  onDelete: (mid: string) => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto px-2 sm:px-6 py-6 space-y-1">
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
        <p className="text-sm text-muted-foreground mt-1">Este é o início do canal. Seja gentil.</p>
      </div>
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
            onReact={(e) => onReact(m.id, e)}
            onEdit={(c) => onEdit(m.id, c)}
            onDelete={() => onDelete(m.id)}
          />
        );
      })}
    </div>
  );
}

const QUICK_EMOJIS = ["🔥", "❤️", "😄", "🎉", "🚀", "👀"];

function MessageRow({
  message,
  author,
  compact,
  isMine,
  myId,
  onReact,
  onEdit,
  onDelete,
}: {
  message: MessageWithAuthor;
  author: Profile;
  compact: boolean;
  isMine: boolean;
  myId: string | undefined;
  onReact: (emoji: string) => void;
  onEdit: (content: string) => void;
  onDelete: () => void;
}) {
  const [hover, setHover] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(message.content);
  const [pickerOpen, setPickerOpen] = useState(false);
  const reactions = useMemo(() => aggregateReactions(message.reactions, myId), [message.reactions, myId]);
  const timestamp = formatTime(message.created_at);

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPickerOpen(false); }}
      className={`group relative flex gap-3 px-3 py-1 rounded-lg hover:bg-secondary/40 ${compact ? "mt-0.5" : "mt-3"}`}
    >
      {compact ? (
        <div className="w-10 shrink-0 text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 text-right pr-1 pt-1">
          {timestamp}
        </div>
      ) : (
        <img src={avatarFor(author)} alt="" className="w-10 h-10 rounded-full shrink-0 object-cover bg-card" />
      )}
      <div className="min-w-0 flex-1">
        {!compact && (
          <div className="flex items-baseline gap-2">
            <span className="font-semibold text-foreground">{author.name}</span>
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
                if (e.key === "Enter") { onEdit(editVal); setEditing(false); }
                if (e.key === "Escape") { setEditing(false); setEditVal(message.content); }
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
        {reactions.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {reactions.map((r) => (
              <button
                key={r.emoji}
                onClick={() => onReact(r.emoji)}
                className={`text-xs flex items-center gap-1 px-2 py-0.5 rounded-full border transition ${
                  r.reacted
                    ? "bg-primary/15 border-primary/50 text-primary"
                    : "bg-secondary border-border hover:border-primary/40"
                }`}
              >
                <span>{r.emoji}</span>
                <span className="font-semibold">{r.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {hover && !editing && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute -top-3 right-4 flex items-center bg-card border border-border rounded-lg shadow-lg divide-x divide-border"
          >
            <ActionBtn icon={Smile} onClick={() => setPickerOpen((v) => !v)} />
            <ActionBtn icon={Reply} />
            {isMine && (
              <>
                <ActionBtn icon={Pencil} onClick={() => setEditing(true)} />
                <ActionBtn icon={Trash2} onClick={onDelete} danger />
              </>
            )}
            <ActionBtn icon={MoreHorizontal} />
            {pickerOpen && (
              <div className="absolute top-10 right-0 bg-card border border-border rounded-lg p-2 flex gap-1 shadow-xl">
                {QUICK_EMOJIS.map((e) => (
                  <button
                    key={e}
                    onClick={() => { onReact(e); setPickerOpen(false); }}
                    className="w-8 h-8 rounded hover:bg-secondary text-lg"
                  >{e}</button>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ActionBtn({ icon: Icon, onClick, danger }: { icon: typeof Bell; onClick?: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`p-2 hover:bg-secondary transition ${danger ? "text-destructive" : "text-muted-foreground hover:text-foreground"}`}>
      <Icon className="w-4 h-4" />
    </button>
  );
}

function Composer({
  channelName,
  value,
  onChange,
  onSend,
}: {
  channelName: string;
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
}) {
  return (
    <div className="px-2 sm:px-6 pb-4 pt-1">
      <div className="flex items-end gap-2 bg-secondary rounded-xl border border-border focus-within:border-primary transition px-3 py-2">
        <button className="p-2 rounded-full hover:bg-background text-muted-foreground"><Paperclip className="w-4 h-4" /></button>
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
          className="flex-1 bg-transparent outline-none resize-none py-2 max-h-40"
        />
        <button className="p-2 rounded-full hover:bg-background text-muted-foreground"><Gift className="w-4 h-4" /></button>
        <button className="p-2 rounded-full hover:bg-background text-muted-foreground"><Smile className="w-4 h-4" /></button>
        <button
          onClick={onSend}
          disabled={!value.trim()}
          className="p-2 rounded-full text-primary-foreground disabled:opacity-40 transition"
          style={{ backgroundImage: "var(--gradient-dexy)" }}
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function MembersPanel({ members }: { members: MemberWithProfile[] }) {
  const grouped = useMemo(() => {
    const g: Record<UserStatus, MemberWithProfile[]> = { online: [], idle: [], dnd: [], offline: [] };
    members.forEach((m) => g[m.profile.status as UserStatus].push(m));
    return g;
  }, [members]);
  const labels: [UserStatus, string][] = [
    ["online", "Online"],
    ["idle", "Ausente"],
    ["dnd", "Não perturbe"],
    ["offline", "Offline"],
  ];
  return (
    <aside className="hidden lg:flex w-64 shrink-0 flex-col bg-card border-l border-border">
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
                {list.map((m) => (
                  <button key={m.user_id} className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-secondary transition text-left">
                    <div className="relative shrink-0">
                      <img src={avatarFor(m.profile)} alt="" className={`w-8 h-8 rounded-full object-cover ${m.profile.status === "offline" ? "opacity-50" : ""}`} />
                      <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-card ${statusColor[m.profile.status as UserStatus]}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm truncate ${m.profile.status === "offline" ? "text-muted-foreground" : "text-foreground"}`}>{m.profile.name}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function ProfileView({
  profile,
  saving,
  onSave,
  onSignOut,
  onClose,
}: {
  profile: Profile;
  saving: boolean;
  onSave: (patch: Partial<Pick<Profile, "name" | "bio" | "status" | "avatar_url">>) => void;
  onSignOut: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(profile.name);
  const [bio, setBio] = useState(profile.bio);
  const status = profile.status as UserStatus;
  const dirty = name !== profile.name || bio !== profile.bio;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="flex-1 overflow-y-auto"
    >
      <div className="relative">
        <div
          className="h-48 w-full"
          style={{
            backgroundImage: profile.banner_url
              ? `linear-gradient(135deg, oklch(0.814 0.145 217 / 0.55), oklch(0.897 0.249 135 / 0.4)), url(${profile.banner_url})`
              : `linear-gradient(135deg, oklch(0.814 0.145 217 / 0.55), oklch(0.897 0.249 135 / 0.4))`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-full bg-background/70 backdrop-blur hover:bg-background">
          <X className="w-4 h-4" />
        </button>
        <div className="absolute -bottom-12 left-8">
          <img src={avatarFor(profile)} alt="" className="w-24 h-24 rounded-full border-4 border-background object-cover bg-card" />
        </div>
      </div>
      <div className="pt-16 px-8 max-w-2xl space-y-6 pb-12">
        <div>
          <label className="text-xs uppercase tracking-wider text-muted-foreground">Nome de exibição</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full bg-secondary border border-border rounded-lg px-3 py-2 outline-none focus:border-primary" />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wider text-muted-foreground">Status</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {(["online", "idle", "dnd", "offline"] as UserStatus[]).map((s) => (
              <button
                key={s}
                onClick={() => onSave({ status: s })}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm transition ${
                  status === s ? "border-primary bg-primary/10 text-foreground" : "border-border bg-secondary text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${statusColor[s]}`} />
                {statusLabel[s]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs uppercase tracking-wider text-muted-foreground">Biografia</label>
          <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={4} className="mt-1 w-full bg-secondary border border-border rounded-lg px-3 py-2 outline-none focus:border-primary resize-none" />
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => onSave({ name, bio })}
            disabled={!dirty || saving}
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40 transition hover:brightness-110"
            style={{ backgroundImage: "var(--gradient-dexy)" }}
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Salvar alterações
          </button>
          <button
            onClick={onSignOut}
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-destructive border border-destructive/40 hover:bg-destructive/10 transition"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sair da conta
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function SettingsView({ onClose }: { onClose: () => void }) {
  const tabs = ["Aparência", "Tema", "Idioma", "Notificações", "Perfil"];
  const [tab, setTab] = useState(tabs[0]);
  const [density, setDensity] = useState<"cozy" | "compact">("cozy");
  const [theme, setTheme] = useState<"dark" | "cyan" | "lime">("cyan");
  const [lang, setLang] = useState("pt-BR");
  const [notif, setNotif] = useState({ mentions: true, all: false, sound: true });

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
          <button onClick={onClose} className="p-1 rounded hover:bg-secondary text-muted-foreground"><X className="w-4 h-4" /></button>
        </div>
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`w-full text-left px-3 py-2 rounded-md text-sm transition ${
              tab === t ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/50"
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
            <SettingRow label="Tema de cor" desc="Cores são simuladas apenas visualmente.">
              <div className="grid grid-cols-3 gap-3">
                {(["dark", "cyan", "lime"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTheme(t)}
                    className={`p-4 rounded-xl border text-left transition ${theme === t ? "border-primary" : "border-border"}`}
                  >
                    <div className={`h-16 rounded-lg mb-2 bg-gradient-to-br ${
                      t === "dark" ? "from-zinc-800 to-zinc-950" : t === "cyan" ? "from-[#00D8FF] to-[#3CEBFF]" : "from-[#8DFF2F] to-[#C8FF2A]"
                    }`} />
                    <div className="text-sm font-medium capitalize">{t}</div>
                  </button>
                ))}
              </div>
            </SettingRow>
          )}
          {tab === "Idioma" && (
            <SettingRow label="Idioma" desc="Idioma da interface (visual).">
              <select value={lang} onChange={(e) => setLang(e.target.value)} className="bg-secondary border border-border rounded-lg px-3 py-2 outline-none">
                <option value="pt-BR">Português (Brasil)</option>
                <option value="en">English</option>
                <option value="es">Español</option>
              </select>
            </SettingRow>
          )}
          {tab === "Notificações" && (
            <div className="space-y-3">
              {[
                ["mentions", "Menções", "Notificar quando alguém mencionar você."],
                ["all", "Todas as mensagens", "Notificar em qualquer mensagem nova."],
                ["sound", "Sons", "Tocar sons ao receber notificações."],
              ].map(([k, l, d]) => (
                <label key={k} className="flex items-start justify-between gap-4 p-4 border border-border rounded-xl bg-card">
                  <div>
                    <div className="font-medium">{l}</div>
                    <div className="text-sm text-muted-foreground">{d}</div>
                  </div>
                  <button
                    onClick={() => setNotif((n) => ({ ...n, [k]: !n[k as keyof typeof n] }))}
                    className={`relative w-11 h-6 rounded-full transition ${notif[k as keyof typeof notif] ? "bg-primary" : "bg-muted"}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-background transition ${notif[k as keyof typeof notif] ? "translate-x-5" : ""}`} />
                  </button>
                </label>
              ))}
            </div>
          )}
          {tab === "Perfil" && (
            <div className="text-sm text-muted-foreground">
              Vá em <button onClick={onClose} className="underline text-foreground">Perfil</button> para editar suas informações.
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function SettingRow({ label, desc, children }: { label: string; desc: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-medium">{label}</div>
      <div className="text-sm text-muted-foreground mb-3">{desc}</div>
      {children}
    </div>
  );
}
