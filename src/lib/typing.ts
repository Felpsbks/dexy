import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";

const SEND_EVERY_MS = 2500;
const SHOW_FOR_MS = 4000;

// "Fulano está digitando..." over a Supabase Realtime broadcast channel —
// ephemeral, never stored. `scope` is e.g. `dm:<conversationId>`.
export function useTypingIndicator(scope: string | undefined, myId: string | undefined, myName: string | undefined) {
  const [typers, setTypers] = useState<Record<string, { name: string; until: number }>>({});
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastSentRef = useRef(0);

  useEffect(() => {
    setTypers({});
    if (!scope || !myId) return;
    const ch = supabase.channel(`typing:${scope}`, { config: { broadcast: { self: false } } });
    ch.on("broadcast", { event: "typing" }, ({ payload }) => {
      const p = payload as { userId?: string; name?: string; stop?: boolean };
      if (!p.userId || p.userId === myId) return;
      setTypers((t) => {
        const next = { ...t };
        if (p.stop) delete next[p.userId!];
        else next[p.userId!] = { name: p.name ?? "Alguém", until: Date.now() + SHOW_FOR_MS };
        return next;
      });
    }).subscribe();
    channelRef.current = ch;
    const sweep = setInterval(() => {
      setTypers((t) => {
        const now = Date.now();
        const live = Object.entries(t).filter(([, v]) => v.until > now);
        return live.length === Object.keys(t).length ? t : Object.fromEntries(live);
      });
    }, 1000);
    return () => {
      clearInterval(sweep);
      channelRef.current = null;
      void supabase.removeChannel(ch);
    };
  }, [scope, myId]);

  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (!channelRef.current || now - lastSentRef.current < SEND_EVERY_MS) return;
    lastSentRef.current = now;
    void channelRef.current.send({ type: "broadcast", event: "typing", payload: { userId: myId, name: myName } });
  }, [myId, myName]);

  const notifyStopped = useCallback(() => {
    lastSentRef.current = 0;
    void channelRef.current?.send({ type: "broadcast", event: "typing", payload: { userId: myId, stop: true } });
  }, [myId]);

  return { typingNames: Object.values(typers).map((t) => t.name), notifyTyping, notifyStopped };
}

export function typingLabel(names: string[]) {
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} está digitando...`;
  if (names.length === 2) return `${names[0]} e ${names[1]} estão digitando...`;
  return "Várias pessoas estão digitando...";
}
