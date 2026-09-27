import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { RING_TIMEOUT_MS, type DmCallRow } from "./livekit";

// Ringing calls addressed to me in ANY conversation -- useDmCall only watches
// the one conversation it's bound to, so on its own a call only showed up once
// you happened to open that person's chat. No realtime filter needed: the
// dm_calls SELECT policy (is_dm_participant) already limits what realtime
// delivers to conversations I'm in.
export function useIncomingDmCall(myId: string | undefined): DmCallRow | null {
  const [incoming, setIncoming] = useState<DmCallRow | null>(null);

  useEffect(() => {
    if (!myId) return;
    let cancelled = false;

    (async () => {
      const { data } = await supabase
        .from("dm_calls")
        .select("*")
        .eq("status", "ringing")
        .neq("started_by", myId)
        .gt("started_at", new Date(Date.now() - RING_TIMEOUT_MS).toISOString())
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled && data) setIncoming(data);
    })();

    const channel = supabase
      .channel(`dm-calls-incoming:${myId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "dm_calls" }, (payload) => {
        const row = payload.new as DmCallRow | undefined;
        if (!row?.id) return;
        if (row.status === "ringing" && row.started_by !== myId) {
          setIncoming(row);
          return;
        }
        setIncoming((current) => (current?.id === row.id ? null : current));
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [myId]);

  // Stop showing it once the ring window is over even if the "missed" update
  // never arrives (e.g. the caller's app died mid-ring).
  useEffect(() => {
    if (!incoming) return;
    const remaining = RING_TIMEOUT_MS - (Date.now() - new Date(incoming.started_at).getTime());
    const timer = setTimeout(
      () => setIncoming((current) => (current?.id === incoming.id ? null : current)),
      Math.max(remaining, 0),
    );
    return () => clearTimeout(timer);
  }, [incoming]);

  return incoming;
}

export async function declineDmCall(callId: string): Promise<void> {
  await supabase
    .from("dm_calls")
    .update({ status: "declined", ended_at: new Date().toISOString() })
    .eq("id", callId)
    .eq("status", "ringing");
}
