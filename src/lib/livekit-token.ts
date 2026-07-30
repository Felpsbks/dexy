import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { AccessToken } from "livekit-server-sdk";

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
      ttl: "10m",
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
