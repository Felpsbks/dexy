import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import type { Database } from "./database.types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Server = Database["public"]["Tables"]["servers"]["Row"];
type Channel = Database["public"]["Tables"]["channels"]["Row"];

export type MessageWithAuthor = Database["public"]["Tables"]["messages"]["Row"] & {
  author: Profile;
  reactions: Database["public"]["Tables"]["message_reactions"]["Row"][];
};

export type MemberWithProfile = Database["public"]["Tables"]["server_members"]["Row"] & {
  profile: Profile;
};

export function useProfile(userId: string | undefined) {
  return useQuery({
    queryKey: ["profile", userId],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").eq("id", userId!).single();
      if (error) throw error;
      return data as Profile;
    },
    enabled: !!userId,
  });
}

export function useUpdateProfile(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Pick<Profile, "name" | "bio" | "status" | "avatar_url">>) => {
      const { error } = await supabase.from("profiles").update(patch).eq("id", userId!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile", userId] });
      queryClient.invalidateQueries({ queryKey: ["members"] });
    },
  });
}

export function useServers() {
  return useQuery({
    queryKey: ["servers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("servers").select("*").order("created_at");
      if (error) throw error;
      return data as Server[];
    },
  });
}

export function useChannels(serverId: string | undefined) {
  return useQuery({
    queryKey: ["channels", serverId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("channels")
        .select("*")
        .eq("server_id", serverId!)
        .order("position");
      if (error) throw error;
      return data as Channel[];
    },
    enabled: !!serverId,
  });
}

export function useMembers(serverId: string | undefined) {
  return useQuery({
    queryKey: ["members", serverId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("server_members")
        .select("*, profile:profiles(*)")
        .eq("server_id", serverId!);
      if (error) throw error;
      return data as unknown as MemberWithProfile[];
    },
    enabled: !!serverId,
  });
}

export function useMessages(channelId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ["messages", channelId];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("*, author:profiles(*), reactions:message_reactions(*)")
        .eq("channel_id", channelId!)
        .order("created_at");
      if (error) throw error;
      return data as unknown as MessageWithAuthor[];
    },
    enabled: !!channelId,
  });

  useEffect(() => {
    if (!channelId) return;
    const channel = supabase
      .channel(`messages:${channelId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `channel_id=eq.${channelId}` },
        () => queryClient.invalidateQueries({ queryKey }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_reactions" },
        () => queryClient.invalidateQueries({ queryKey }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  return query;
}

export function useSendMessage(channelId: string | undefined, authorId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (content: string) => {
      const { error } = await supabase
        .from("messages")
        .insert({ channel_id: channelId!, author_id: authorId!, content });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["messages", channelId] }),
  });
}

export function useEditMessage(channelId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, content }: { id: string; content: string }) => {
      const { error } = await supabase
        .from("messages")
        .update({ content, edited_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["messages", channelId] }),
  });
}

export function useDeleteMessage(channelId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("messages").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["messages", channelId] }),
  });
}

export function useToggleReaction(channelId: string | undefined, userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      messageId,
      emoji,
      reacted,
    }: {
      messageId: string;
      emoji: string;
      reacted: boolean;
    }) => {
      if (reacted) {
        const { error } = await supabase
          .from("message_reactions")
          .delete()
          .eq("message_id", messageId)
          .eq("user_id", userId!)
          .eq("emoji", emoji);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("message_reactions")
          .insert({ message_id: messageId, user_id: userId!, emoji });
        if (error) throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["messages", channelId] }),
  });
}

export function invalidateServers(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: ["servers"] });
}
