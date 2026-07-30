import { motion } from "framer-motion";
import { Bell, MessageCircle, UserPlus } from "lucide-react";
import type { Notification } from "@/lib/queries";

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const iconFor: Record<string, typeof Bell> = {
  dm_message: MessageCircle,
  friend_request: UserPlus,
};

export function NotificationsPanel({
  notifications,
  onSelect,
  onClose,
}: {
  notifications: Notification[];
  onSelect: (n: Notification) => void;
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
        <div className="px-4 py-3 border-b border-border font-semibold text-sm">Notificações</div>
        {notifications.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhuma notificação ainda.</div>
        ) : (
          <div className="py-1">
            {notifications.map((n) => {
              const Icon = iconFor[n.type] ?? Bell;
              return (
                <button
                  key={n.id}
                  onClick={() => onSelect(n)}
                  className={`w-full flex items-start gap-3 px-4 py-2.5 text-left hover:bg-secondary/50 transition ${
                    n.read ? "" : "bg-primary/5"
                  }`}
                >
                  <div className="w-8 h-8 rounded-full bg-secondary grid place-items-center shrink-0 mt-0.5">
                    <Icon className="w-4 h-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug break-words">{n.text}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{timeAgo(n.created_at)}</p>
                  </div>
                  {!n.read && <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-2" />}
                </button>
              );
            })}
          </div>
        )}
      </motion.div>
    </>
  );
}
