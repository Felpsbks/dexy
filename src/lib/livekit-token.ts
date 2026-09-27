import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

export const mintVoiceToken = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { channelId: string; accessToken: string })
  .handler(async ({ data }) => {
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
    const livekitUrl = process.env.VITE_LIVEKIT_URL;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!supabaseUrl || !supabaseAnonKey || !livekitUrl || !apiKey || !apiSecret) {
      throw new Error("Missing Supabase/LiveKit server configuration.");
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${data.accessToken}` } },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser(data.accessToken);
    if (userError || !userData.user) {
      throw new Error("Not authenticated.");
    }

    // RLS on `channels` only allows selecting a channel if the caller is a member
    // of its server (see is_channel_member in the schema) — reusing that policy
    // here is the membership check for the voice room.
    const { data: channel, error: channelError } = await supabase
      .from("channels")
      .select("id")
      .eq("id", data.channelId)
      .single();

    if (channelError || !channel) {
      throw new Error("Channel not found or access denied.");
    }

    const profile = userData.user.user_metadata as { name?: string } | null;

    const at = new AccessToken(apiKey, apiSecret, {
      identity: userData.user.id,
      name: profile?.name ?? userData.user.email ?? userData.user.id,
      // Long TTL: the client reuses this same token to resume the session after a
      // network drop, so if it expires mid-call the automatic reconnect fails and
      // the call is silently lost instead of recovering.
      ttl: "6h",
    });
    at.addGrant({
      room: data.channelId,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();
    return { token, url: livekitUrl };
  });

export const mintDmVoiceToken = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { conversationId: string; accessToken: string })
  .handler(async ({ data }) => {
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
    const livekitUrl = process.env.VITE_LIVEKIT_URL;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!supabaseUrl || !supabaseAnonKey || !livekitUrl || !apiKey || !apiSecret) {
      throw new Error("Missing Supabase/LiveKit server configuration.");
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${data.accessToken}` } },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser(data.accessToken);
    if (userError || !userData.user) {
      throw new Error("Not authenticated.");
    }

    const { data: isParticipant, error: participantError } = await supabase.rpc(
      "is_dm_participant",
      { p_conversation_id: data.conversationId, p_user_id: userData.user.id },
    );

    if (participantError || !isParticipant) {
      throw new Error("Conversation not found or access denied.");
    }

    const { data: isBlocked, error: blockedError } = await supabase.rpc("is_dm_blocked", {
      p_conversation_id: data.conversationId,
    });

    if (blockedError || isBlocked) {
      throw new Error("Conversation not found or access denied.");
    }

    // Real authorization: only mint a token when there's a dm_calls row that
    // actually needs one right now. Never trust callId/status/started_by
    // from the client for this — always ask the database directly.
    //
    // EXISTS on purpose, not "pick the latest call": nothing today stops
    // multiple concurrent dm_calls rows for the same conversation (tracked
    // separately as a residual risk, out of scope for this change) — picking
    // "the" row by recency would let a newer concurrent insert hijack
    // authorization away from a legitimate in-progress call. EXISTS sidesteps
    // that: it only asks "is there *some* row that authorizes this caller
    // right now", regardless of how many rows exist.
    //
    //   started_by = me AND status = 'ringing' -> the caller, waiting for
    //     pickup — the one case a ringing call authorizes only one specific
    //     side, since the callee must accept() first (which the Etapa 6.5
    //     trigger flips to 'active') before they can request a token.
    //   status = 'active'                       -> either participant —
    //     covers the callee right after accepting, and both sides
    //     reconnecting to an ongoing call.
    // ended/declined/missed/no-row never authorize.
    const { data: authorizingCalls, error: callsError } = await supabase
      .from("dm_calls")
      .select("id")
      .eq("conversation_id", data.conversationId)
      .or(`and(started_by.eq.${userData.user.id},status.eq.ringing),status.eq.active`)
      .limit(1);

    if (callsError || !authorizingCalls || authorizingCalls.length === 0) {
      throw new Error("No call in progress authorizes this token.");
    }

    const profile = userData.user.user_metadata as { name?: string } | null;

    const at = new AccessToken(apiKey, apiSecret, {
      identity: userData.user.id,
      name: profile?.name ?? userData.user.email ?? userData.user.id,
      ttl: "6h",
    });
    at.addGrant({
      room: `dm-${data.conversationId}`,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();
    return { token, url: livekitUrl };
  });

// Grace before an unanswered/unattended call can be treated as abandoned:
// covers the gap between the dm_calls write and the client actually joining
// the LiveKit room (token mint + connect).
const ORPHAN_GRACE_MS = 15_000;
const RING_TIMEOUT_MS = 30_000;

// A ringing/active dm_calls row whose LiveKit room is empty is a leftover
// from an app that closed or crashed mid-call -- the caller joins the room as
// soon as it starts ringing, so a live call always has someone in it. Ends it
// so the unique ringing/active index stops blocking the next call.
export const clearOrphanedDmCall = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { conversationId: string; accessToken: string })
  .handler(async ({ data }) => {
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
    const livekitUrl = process.env.VITE_LIVEKIT_URL;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!supabaseUrl || !supabaseAnonKey || !livekitUrl || !apiKey || !apiSecret) {
      throw new Error("Missing Supabase/LiveKit server configuration.");
    }

    // Caller's own JWT: RLS limits both the read and the update below to
    // conversations they participate in.
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${data.accessToken}` } },
    });
    const { data: userData, error: userError } = await supabase.auth.getUser(data.accessToken);
    if (userError || !userData.user) throw new Error("Not authenticated.");

    const { data: row } = await supabase
      .from("dm_calls")
      .select("id, status, started_at, answered_at")
      .eq("conversation_id", data.conversationId)
      .in("status", ["ringing", "active"])
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!row) return { cleared: false };

    const since = new Date(row.answered_at ?? row.started_at).getTime();
    const age = Date.now() - since;
    const ringExpired = row.status === "ringing" && age > RING_TIMEOUT_MS + ORPHAN_GRACE_MS;

    if (!ringExpired) {
      if (age < ORPHAN_GRACE_MS) return { cleared: false };
      const rooms = new RoomServiceClient(livekitUrl.replace(/^wss:/, "https:"), apiKey, apiSecret);
      let participantCount: number;
      try {
        participantCount = (await rooms.listParticipants(`dm-${data.conversationId}`)).length;
      } catch (err) {
        const e = err as { code?: string; message?: string };
        if (e.code !== "not_found" && !/does not exist/i.test(e.message ?? "")) {
          // Can't tell whether the call is live -- never end it on a guess.
          return { cleared: false };
        }
        participantCount = 0;
      }
      if (participantCount > 0) return { cleared: false };
    }

    const terminal = row.status === "ringing" ? "missed" : "ended";
    const { error: updateError } = await supabase
      .from("dm_calls")
      .update({ status: terminal, ended_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", row.status);
    return { cleared: !updateError };
  });
