import { useSyncExternalStore, type ReactNode } from "react";
import { createElement } from "react";

// The channel message currently being replied to (shared between the message
// list's "Responder" button, the composer's reply bar and send()).
export interface ReplyTarget {
  id: string;
  authorName: string;
}

let current: ReplyTarget | null = null;
const listeners = new Set<() => void>();

export function setChannelReply(t: ReplyTarget | null) {
  current = t;
  listeners.forEach((l) => l());
}
export function getChannelReply() {
  return current;
}
export function useChannelReply() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => null,
  );
}

const MENTION_RE = /(@[A-Za-z0-9_.+-]{2,64})/g;

// Renders message text with @handles highlighted (Discord-style pills).
export function renderWithMentions(text: string, myHandle?: string): ReactNode[] {
  return text.split(MENTION_RE).map((part, i) => {
    if (i % 2 === 0) return part;
    const h = part.slice(1).toLowerCase();
    const isMe = !!myHandle && (h === myHandle.toLowerCase() || h.replace(/[.+-]+$/, "") === myHandle.toLowerCase());
    return createElement(
      "span",
      {
        key: i,
        className: `rounded px-0.5 font-medium ${isMe ? "bg-amber-400/25 text-amber-200" : "bg-primary/20 text-primary"}`,
      },
      part,
    );
  });
}

export function mentionsHandle(text: string, handle?: string) {
  if (!handle) return false;
  return new RegExp(`@${handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_+-]|\\.[A-Za-z0-9])`, "i").test(text);
}
