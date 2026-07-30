import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  LocalParticipant,
  Participant,
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
} from "livekit-client";
import { mintVoiceToken } from "./livekit-token";
import { supabase } from "./supabase";

export type ParticipantInfo = {
  identity: string;
  name: string;
  isLocal: boolean;
  isSpeaking: boolean;
  micTrack: Track | undefined;
  micMuted: boolean;
  cameraTrack: Track | undefined;
  screenShareTrack: Track | undefined;
};

function toInfo(p: Participant): ParticipantInfo {
  const mic = p.getTrackPublication(Track.Source.Microphone);
  const camera = p.getTrackPublication(Track.Source.Camera);
  const screen = p.getTrackPublication(Track.Source.ScreenShare);
  return {
    identity: p.identity,
    name: p.name || p.identity,
    isLocal: p instanceof LocalParticipant,
    isSpeaking: p.isSpeaking,
    micTrack: mic?.track,
    micMuted: !mic || mic.isMuted,
    cameraTrack: camera?.track,
    screenShareTrack: screen?.track,
  };
}

export type VoiceRoomStatus = "idle" | "connecting" | "connected" | "error";

export function useVoiceRoom(channelId: string | undefined) {
  const roomRef = useRef<Room | null>(null);
  const [status, setStatus] = useState<VoiceRoomStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [, forceTick] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    return () => {
      roomRef.current?.disconnect();
      roomRef.current = null;
    };
  }, [channelId]);

  const join = useCallback(async () => {
    if (!channelId || roomRef.current) return;
    setStatus("connecting");
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Sessão inválida.");

      const { token, url } = await mintVoiceToken({ data: { channelId, accessToken } });

      const room = new Room({ adaptiveStream: true, dynacast: true });
      room
        .on(RoomEvent.ParticipantConnected, forceTick)
        .on(RoomEvent.ParticipantDisconnected, forceTick)
        .on(RoomEvent.TrackSubscribed, forceTick)
        .on(RoomEvent.TrackUnsubscribed, forceTick)
        .on(RoomEvent.TrackMuted, forceTick)
        .on(RoomEvent.TrackUnmuted, forceTick)
        .on(RoomEvent.LocalTrackPublished, forceTick)
        .on(RoomEvent.LocalTrackUnpublished, forceTick)
        .on(RoomEvent.ActiveSpeakersChanged, forceTick)
        .on(RoomEvent.Disconnected, () => {
          roomRef.current = null;
          setStatus("idle");
          forceTick();
        });

      await room.connect(url, token);
      await room.localParticipant.setMicrophoneEnabled(true);

      roomRef.current = room;
      setStatus("connected");
      forceTick();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Não foi possível entrar na sala.");
    }
  }, [channelId]);

  const leave = useCallback(() => {
    roomRef.current?.disconnect();
    roomRef.current = null;
    setStatus("idle");
    forceTick();
  }, []);

  const toggleMic = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const enabled = room.localParticipant.isMicrophoneEnabled;
    await room.localParticipant.setMicrophoneEnabled(!enabled);
    forceTick();
  }, []);

  const toggleCamera = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const enabled = room.localParticipant.isCameraEnabled;
    await room.localParticipant.setCameraEnabled(!enabled);
    forceTick();
  }, []);

  const toggleScreenShare = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const enabled = room.localParticipant.isScreenShareEnabled;
    await room.localParticipant.setScreenShareEnabled(!enabled, { audio: true });
    forceTick();
  }, []);

  const room = roomRef.current;
  const participants: ParticipantInfo[] = room
    ? [
        toInfo(room.localParticipant),
        ...Array.from(room.remoteParticipants.values() as IterableIterator<RemoteParticipant>).map(toInfo),
      ]
    : [];

  return {
    status,
    error,
    participants,
    micEnabled: room?.localParticipant.isMicrophoneEnabled ?? false,
    cameraEnabled: room?.localParticipant.isCameraEnabled ?? false,
    screenShareEnabled: room?.localParticipant.isScreenShareEnabled ?? false,
    join,
    leave,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
  };
}
