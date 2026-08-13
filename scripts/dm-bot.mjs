// Dev-only helper: a bot account that auto-accepts any DM call directed at it,
// so voice/video call flows can be tested solo without a second browser/account.
// It joins the LiveKit room for real (via @livekit/rtc-node) so it shows up as
// an actual connected participant on the other side — it just never publishes
// a mic/camera track, so there's no real audio/video coming FROM the bot.
//
// Run with: bun run bot   (loads env from .env automatically)

import { createClient } from "@supabase/supabase-js";
import { AccessToken } from "livekit-server-sdk";
import { Room } from "@livekit/rtc-node";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const LIVEKIT_URL = process.env.VITE_LIVEKIT_URL;
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
const BOT_EMAIL = process.env.DEXY_BOT_EMAIL;
const BOT_PASSWORD = process.env.DEXY_BOT_PASSWORD;
const BOT_NAME = process.env.DEXY_BOT_NAME || "Dexy Bot";
const BOT_HANDLE = process.env.DEXY_BOT_HANDLE || "dexybot";
const TARGET_HANDLE = process.env.DEXY_BOT_TARGET_HANDLE;
const ANSWER_DELAY_MS = 1500;
// Safety net so a forgotten call doesn't sit "active" forever if you walk away
// mid-test — NOT meant to be hit during normal testing. Override with
// DEXY_BOT_AUTO_HANGUP_MS in .env if you need it shorter/longer.
const AUTO_HANGUP_MS = Number(process.env.DEXY_BOT_AUTO_HANGUP_MS) || 30 * 60_000;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error("Faltam VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY no ambiente.");
}
if (!BOT_EMAIL || !BOT_PASSWORD) {
  throw new Error("Faltam DEXY_BOT_EMAIL / DEXY_BOT_PASSWORD no ambiente (veja .env.example).");
}
if (!TARGET_HANDLE) {
  throw new Error("Falta DEXY_BOT_TARGET_HANDLE no ambiente (o @handle que o bot deve chamar de amigo).");
}
if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  throw new Error("Faltam VITE_LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET no ambiente.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function ensureBotAccount() {
  const signIn = await supabase.auth.signInWithPassword({ email: BOT_EMAIL, password: BOT_PASSWORD });
  if (!signIn.error) return signIn.data.user.id;

  console.log("Conta do bot ainda não existe, criando...");
  const signUp = await supabase.auth.signUp({
    email: BOT_EMAIL,
    password: BOT_PASSWORD,
    options: { data: { name: BOT_NAME, handle: BOT_HANDLE } },
  });
  if (signUp.error || !signUp.data.user) {
    throw new Error(`Falha ao criar conta do bot: ${signUp.error?.message}`);
  }
  return signUp.data.user.id;
}

async function ensureFriendship(botId, targetId) {
  const { data: existing } = await supabase
    .from("friendships")
    .select("user_id, friend_id, status")
    .or(
      `and(user_id.eq.${botId},friend_id.eq.${targetId}),and(user_id.eq.${targetId},friend_id.eq.${botId})`,
    )
    .maybeSingle();

  if (existing?.status === "accepted") return;

  if (!existing) {
    const { error } = await supabase.from("friendships").insert({ user_id: botId, friend_id: targetId, status: "accepted" });
    if (error) throw new Error(`Falha ao criar amizade: ${error.message}`);
    console.log("Amizade criada e já aceita.");
    return;
  }

  const { error } = await supabase
    .from("friendships")
    .update({ status: "accepted" })
    .eq("user_id", existing.user_id)
    .eq("friend_id", existing.friend_id);
  if (error) throw new Error(`Falha ao aceitar amizade: ${error.message}`);
  console.log("Amizade pendente aceita automaticamente.");
}

async function main() {
  const botId = await ensureBotAccount();
  console.log(`Bot autenticado (id: ${botId}).`);

  await supabase.from("profiles").update({ name: BOT_NAME, status: "online" }).eq("id", botId);

  const { data: target, error: targetError } = await supabase
    .from("profiles")
    .select("id, name")
    .eq("handle", TARGET_HANDLE)
    .single();
  if (targetError || !target) {
    throw new Error(`Usuário alvo @${TARGET_HANDLE} não encontrado: ${targetError?.message}`);
  }

  await ensureFriendship(botId, target.id);

  const { data: conversationId, error: convError } = await supabase.rpc("get_or_create_dm", {
    other_user_id: target.id,
  });
  if (convError || !conversationId) {
    throw new Error(`Falha ao abrir conversa com @${TARGET_HANDLE}: ${convError?.message}`);
  }
  console.log(`Pronto. ${BOT_NAME} vai sempre atender chamadas de ${target.name} nesta conversa.`);

  const hangupTimers = new Map();
  const activeRooms = new Map(); // call.id -> Room

  async function joinLiveKitRoom(conversationId) {
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: botId,
      name: BOT_NAME,
      ttl: "6h",
    });
    at.addGrant({
      room: `dm-${conversationId}`,
      roomJoin: true,
      // The bot only ever listens — never publishes a mic/camera track — so
      // it doesn't need canPublish, just enough to show up as connected.
      canPublish: false,
      canSubscribe: true,
    });
    const token = await at.toJwt();

    const room = new Room();
    await room.connect(LIVEKIT_URL, token, { autoSubscribe: true });
    return room;
  }

  async function leaveLiveKitRoom(callId) {
    const room = activeRooms.get(callId);
    if (!room) return;
    activeRooms.delete(callId);
    try {
      await room.disconnect();
    } catch {
      // already gone, nothing to clean up
    }
  }

  async function answer(call) {
    console.log(`Chamada recebida (${call.kind}) — atendendo em ${ANSWER_DELAY_MS}ms...`);
    await new Promise((r) => setTimeout(r, ANSWER_DELAY_MS));
    const { error } = await supabase
      .from("dm_calls")
      .update({ status: "active", answered_at: new Date().toISOString() })
      .eq("id", call.id)
      .eq("status", "ringing");
    if (error) {
      console.error("Falha ao atender:", error.message);
      return;
    }
    try {
      const room = await joinLiveKitRoom(call.conversation_id);
      activeRooms.set(call.id, room);
      console.log("Chamada atendida — bot conectado na sala do LiveKit (sem publicar áudio/vídeo).");
    } catch (err) {
      console.error("Atendeu a chamada mas falhou ao conectar no LiveKit:", err.message || err);
    }
    const timer = setTimeout(async () => {
      hangupTimers.delete(call.id);
      const { error: hangupError } = await supabase
        .from("dm_calls")
        .update({ status: "ended", ended_at: new Date().toISOString() })
        .eq("id", call.id)
        .eq("status", "active");
      await leaveLiveKitRoom(call.id);
      if (!hangupError) console.log("Bot encerrou a chamada automaticamente (tempo máximo).");
    }, AUTO_HANGUP_MS);
    hangupTimers.set(call.id, timer);
  }

  supabase
    .channel(`dm-bot:${conversationId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "dm_calls", filter: `conversation_id=eq.${conversationId}` },
      (payload) => {
        const call = payload.new;
        if (call.started_by !== botId && call.status === "ringing") {
          answer(call);
        }
      },
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "dm_calls", filter: `conversation_id=eq.${conversationId}` },
      (payload) => {
        const call = payload.new;
        if (call.status === "ended" || call.status === "declined" || call.status === "missed") {
          const timer = hangupTimers.get(call.id);
          if (timer) {
            clearTimeout(timer);
            hangupTimers.delete(call.id);
          }
          leaveLiveKitRoom(call.id);
        }
      },
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") console.log("Escutando chamadas em tempo real. Deixe este terminal aberto.");
    });
}

async function goOffline() {
  const { data } = await supabase.auth.getUser();
  if (data.user) await supabase.from("profiles").update({ status: "offline" }).eq("id", data.user.id);
  process.exit(0);
}

process.on("SIGINT", goOffline);
process.on("SIGTERM", goOffline);

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
