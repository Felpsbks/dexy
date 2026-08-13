import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  AudioPresets,
  createLocalScreenTracks,
  DisconnectReason,
  LocalParticipant,
  Participant,
  Room,
  RoomEvent,
  Track,
  type AudioCaptureOptions,
  type RemoteParticipant,
} from "livekit-client";

// LiveKit's own Room default (AudioPresets.music, 48kbps) already beats the
// generic "speech" preset, but musicHighQuality (96kbps) is a clearly
// audible step up for voice with no real downside on typical connections —
// same idea as the screen-share bitrate bump above, just for mic audio.
const ROOM_PUBLISH_DEFAULTS = { audioPreset: AudioPresets.musicHighQuality };
import { mintDmVoiceToken, mintVoiceToken } from "./livekit-token";
import { supabase } from "./supabase";
import type { Database } from "./database.types";

// Forces the browser's own echo cancellation / noise suppression / auto gain
// on every mic capture — relying on browser defaults isn't reliable across
// Chrome/Firefox/Safari, and this is most of what makes Discord's voice
// sound "clean" without any extra processing library.
const MIC_CAPTURE_OPTIONS: AudioCaptureOptions = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

// ActiveSpeakersChanged fires far more often than the other room events
// (every audio-level sample change while anyone talks) — forwarding every
// one straight into forceTick() re-renders the whole call view (and
// everything above it, like a scrollable message list) many times a
// second, which starves the main thread and makes scrolling feel frozen.
// Trailing-edge throttle keeps the speaking-glow responsive without that.
function throttleTrailing(fn: () => void, ms: number) {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    const now = Date.now();
    const remaining = ms - (now - last);
    if (remaining <= 0) {
      last = now;
      fn();
    } else if (!timer) {
      timer = setTimeout(() => {
        last = Date.now();
        timer = null;
        fn();
      }, remaining);
    }
  };
}

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

// LiveKit's own screen-share default (unset resolution/encoding) lands
// around 1080p at ~2.5Mbps/15fps -- soft *and* choppy. Both tiers below
// explicitly request a resolution, 60fps (the real ceiling for "fluid" --
// browsers don't reliably expose true 120fps capture for getDisplayMedia,
// no mainstream video call product offers it either), and a bitrate high
// enough to actually carry that framerate instead of the capture rate
// outrunning a bitrate sized for 30fps. Simulcast stays off so the one
// layer sent is always the full-quality one, never adapted down to
// whatever the smallest viewer's tile happens to render at.
export const SCREEN_SHARE_QUALITIES = {
  "1080p": {
    resolution: { width: 1920, height: 1080, frameRate: 60 },
    encoding: { maxBitrate: 7_000_000, maxFramerate: 60 },
  },
  "4k": {
    resolution: { width: 3840, height: 2160, frameRate: 60 },
    encoding: { maxBitrate: 16_000_000, maxFramerate: 60 },
  },
} as const;
export type ScreenShareQuality = keyof typeof SCREEN_SHARE_QUALITIES;

// Clicking "share screen" while already sharing picks a *different* source
// instead of stopping — the new capture is grabbed before anything is torn
// down, so cancelling the picker leaves the current share running untouched.
// Actually stopping is a separate, unambiguous action (see stopScreenShare).
async function swapOrStartScreenShare(room: Room, quality: ScreenShareQuality = "1080p") {
  const preset = SCREEN_SHARE_QUALITIES[quality];
  const captureOptions = {
    audio: true,
    resolution: preset.resolution,
    // 'motion' tells the browser's encoder to spend its budget on frame
    // rate/smoothness rather than per-frame sharpness -- 'detail' (the
    // previous value) does the opposite, which silently fights the whole
    // point of asking for 60fps above. Screen shares here are overwhelmingly
    // gameplay/video, not static documents, so motion is the right default.
    contentHint: "motion" as const,
  };
  const publishOptions = { videoEncoding: preset.encoding, simulcast: false };

  const lp = room.localParticipant;
  if (!lp.isScreenShareEnabled) {
    await lp.setScreenShareEnabled(true, captureOptions, publishOptions);
    return;
  }
  const newTracks = await createLocalScreenTracks(captureOptions);
  const oldVideo = lp.getTrackPublication(Track.Source.ScreenShare)?.track;
  const oldAudio = lp.getTrackPublication(Track.Source.ScreenShareAudio)?.track;
  if (oldVideo) await lp.unpublishTrack(oldVideo);
  if (oldAudio) await lp.unpublishTrack(oldAudio);
  for (const track of newTracks) {
    await lp.publishTrack(track, track.source === Track.Source.ScreenShare ? publishOptions : undefined);
  }
}

async function stopScreenShare(room: Room) {
  await room.localParticipant.setScreenShareEnabled(false);
}

export type VoiceRoomStatus = "idle" | "connecting" | "connected" | "error";

// Backoff schedule for our own app-level reconnect retries, layered on top of
// LiveKit's internal reconnect (which can give up sooner than a real outage lasts).
const RECONNECT_RETRY_DELAYS_MS = [1000, 2500, 5000, 8000];

// LiveKit's own DisconnectReason enum, translated for a non-technical banner.
// SIGNAL_CLOSE / STATE_MISMATCH are the ones that show up after a real network
// drop (wifi hiccup, laptop sleep) once automatic reconnection gives up.
function disconnectReasonLabel(reason: DisconnectReason | undefined): string {
  switch (reason) {
    case DisconnectReason.DUPLICATE_IDENTITY:
      return "Você entrou nessa chamada em outra aba ou dispositivo.";
    case DisconnectReason.SERVER_SHUTDOWN:
    case DisconnectReason.ROOM_DELETED:
    case DisconnectReason.ROOM_CLOSED:
      return "A sala foi encerrada pelo servidor.";
    case DisconnectReason.PARTICIPANT_REMOVED:
      return "Você foi removido da chamada.";
    default:
      return "A conexão caiu e não foi possível reconectar. Tente entrar novamente.";
  }
}

export interface VoiceRoomHook {
  status: VoiceRoomStatus;
  error: string | null;
  reconnecting: boolean;
  participants: ParticipantInfo[];
  micEnabled: boolean;
  cameraEnabled: boolean;
  screenShareEnabled: boolean;
  join: () => Promise<void>;
  leave: () => void;
  toggleMic: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  toggleScreenShare: (quality?: ScreenShareQuality) => Promise<void>;
  stopScreenShare: () => Promise<void>;
}

export function useVoiceRoom(channelId: string | undefined): VoiceRoomHook {
  const roomRef = useRef<Room | null>(null);
  const connectingRef = useRef(false);
  const intentionalRef = useRef(false);
  const handleUnexpectedDisconnectRef = useRef<(reason: DisconnectReason | undefined) => void>(
    () => {},
  );
  // Remembers the last mic state the user chose (via toggleMic) so the *next*
  // join starts the same way instead of always force-enabling the mic — that
  // hardcoded reset was both ignoring a previous mute and, since it always ran
  // right after connect, visible as the mic briefly flickering off/on.
  const micPrefRef = useRef(true);
  const [status, setStatus] = useState<VoiceRoomStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [, forceTick] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    return () => {
      intentionalRef.current = true;
      roomRef.current?.disconnect();
      roomRef.current = null;
    };
  }, [channelId]);

  // Low-level connect: creates the Room and wires it up, but doesn't touch the
  // public `status`/`error` state — join() and the reconnect retry loop below
  // both build on this and decide for themselves how to surface the outcome.
  const connectRoom = useCallback(async (chId: string) => {
    if (connectingRef.current || roomRef.current) return;
    connectingRef.current = true;
    intentionalRef.current = false;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Sessão inválida.");

      const { token, url } = await mintVoiceToken({ data: { channelId: chId, accessToken } });

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: ROOM_PUBLISH_DEFAULTS,
      });
      // Connecting fires a burst of these in the same instant (participant
      // joined, mic track published/subscribed, ...) — without coalescing,
      // each one is a separate synchronous re-render landing right as the
      // call view mounts, which is exactly the moment someone is likely to
      // start scrolling and feel it stutter. One throttled tick absorbs the
      // whole burst into a single re-render.
      const tick = throttleTrailing(forceTick, 200);
      room
        .on(RoomEvent.ParticipantConnected, tick)
        .on(RoomEvent.ParticipantDisconnected, tick)
        .on(RoomEvent.TrackSubscribed, tick)
        .on(RoomEvent.TrackUnsubscribed, tick)
        .on(RoomEvent.TrackMuted, tick)
        .on(RoomEvent.TrackUnmuted, tick)
        .on(RoomEvent.LocalTrackPublished, tick)
        .on(RoomEvent.LocalTrackUnpublished, tick)
        .on(RoomEvent.ActiveSpeakersChanged, throttleTrailing(forceTick, 400))
        .on(RoomEvent.Reconnecting, () => setReconnecting(true))
        .on(RoomEvent.Reconnected, () => setReconnecting(false))
        .on(RoomEvent.Disconnected, (reason) => {
          if (intentionalRef.current) {
            roomRef.current = null;
            setReconnecting(false);
            forceTick();
          } else {
            handleUnexpectedDisconnectRef.current(reason);
          }
        });

      await room.connect(url, token);
      await room.localParticipant.setMicrophoneEnabled(micPrefRef.current, MIC_CAPTURE_OPTIONS);

      roomRef.current = room;
      forceTick();
    } finally {
      connectingRef.current = false;
    }
  }, []);

  // Same reconnect-with-fresh-token retry strategy as useDmCall: LiveKit's own
  // internal reconnect can give up sooner than a real outage (wifi switching,
  // laptop waking from sleep) lasts, so we keep trying for a while ourselves
  // before finally surfacing an error.
  const handleUnexpectedDisconnect = useCallback(
    (reason: DisconnectReason | undefined) => {
      roomRef.current = null;
      const chId = channelId;
      if (!chId) {
        setReconnecting(false);
        setError(disconnectReasonLabel(reason));
        setStatus("error");
        forceTick();
        return;
      }

      setReconnecting(true);
      forceTick();

      (async () => {
        for (const delay of RECONNECT_RETRY_DELAYS_MS) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          if (intentionalRef.current) return;
          try {
            await connectRoom(chId);
            if (roomRef.current) {
              setReconnecting(false);
              setError(null);
              setStatus("connected");
              forceTick();
              return;
            }
          } catch {
            // keep retrying
          }
        }

        setReconnecting(false);
        setError(disconnectReasonLabel(reason));
        setStatus("error");
        forceTick();
      })();
    },
    [channelId, connectRoom],
  );
  handleUnexpectedDisconnectRef.current = handleUnexpectedDisconnect;

  const join = useCallback(async () => {
    if (!channelId || roomRef.current) return;
    setStatus("connecting");
    setError(null);
    try {
      await connectRoom(channelId);
      setStatus("connected");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Não foi possível entrar na sala.");
    }
  }, [channelId, connectRoom]);

  const leave = useCallback(() => {
    intentionalRef.current = true;
    roomRef.current?.disconnect();
    roomRef.current = null;
    setReconnecting(false);
    setStatus("idle");
    forceTick();
  }, []);

  const toggleMic = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const enabled = room.localParticipant.isMicrophoneEnabled;
    micPrefRef.current = !enabled;
    await room.localParticipant.setMicrophoneEnabled(!enabled, MIC_CAPTURE_OPTIONS);
    forceTick();
  }, []);

  const toggleCamera = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const enabled = room.localParticipant.isCameraEnabled;
    await room.localParticipant.setCameraEnabled(!enabled);
    forceTick();
  }, []);

  const toggleScreenShare = useCallback(async (quality: ScreenShareQuality = "1080p") => {
    const room = roomRef.current;
    if (!room) return;
    try {
      await swapOrStartScreenShare(room, quality);
    } catch {
      // User cancelled the share picker or denied permission — leave the current share (if any) as-is.
    }
    forceTick();
  }, []);

  const stopScreenShareAction = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    await stopScreenShare(room);
    forceTick();
  }, []);

  const room = roomRef.current;
  const participants: ParticipantInfo[] = room
    ? [
        toInfo(room.localParticipant),
        ...Array.from(room.remoteParticipants.values() as IterableIterator<RemoteParticipant>).map(
          toInfo,
        ),
      ]
    : [];

  return {
    status,
    error,
    reconnecting,
    participants,
    micEnabled: room?.localParticipant.isMicrophoneEnabled ?? false,
    cameraEnabled: room?.localParticipant.isCameraEnabled ?? false,
    screenShareEnabled: room?.localParticipant.isScreenShareEnabled ?? false,
    join,
    leave,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    stopScreenShare: stopScreenShareAction,
  };
}

// --- 1:1 DM calls ---

export type DmCallRow = Database["public"]["Tables"]["dm_calls"]["Row"];
export type DmCallStatus = "idle" | "outgoing" | "incoming" | "connecting" | "active";
export type DmCallKind = "audio" | "video";

// How long an unanswered call keeps ringing before it's auto-marked "missed"
// for both sides — without this, a call nobody answers (but nobody declines
// either) would ring forever as long as both tabs stay open.
const RING_TIMEOUT_MS = 30_000;

export function formatCallDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return "poucos segundos";
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 60) return `${minutes} minuto${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  return `${hours} hora${hours === 1 ? "" : "s"}`;
}

// MM:SS (or H:MM:SS past an hour) live call-timer format, e.g. "02:34" — as
// opposed to formatCallDuration's coarse "5 minutos" used in ended-call logs.
export function formatCallTimer(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Live-ticking elapsed time since `sinceIso` — re-renders every second while
// a timestamp is present, for the "Em chamada • 02:34" header/sidebar timer.
export function useCallElapsedMs(sinceIso: string | null | undefined) {
  const [, forceTick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!sinceIso) return;
    const id = setInterval(forceTick, 1000);
    return () => clearInterval(id);
  }, [sinceIso]);
  return sinceIso ? Date.now() - new Date(sinceIso).getTime() : 0;
}

export interface DmCallHook {
  status: DmCallStatus;
  error: string | null;
  reconnecting: boolean;
  call: DmCallRow | null;
  participants: ParticipantInfo[];
  micEnabled: boolean;
  cameraEnabled: boolean;
  screenShareEnabled: boolean;
  start: (kind: DmCallKind) => Promise<void>;
  accept: () => Promise<void>;
  decline: () => Promise<void>;
  hangup: () => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  toggleScreenShare: (quality?: ScreenShareQuality) => Promise<void>;
  stopScreenShare: () => Promise<void>;
}

// Shared by the mount-effect auto-heal below and by start() (Etapa 6.10):
// a "ringing" call older than this was never accepted/declined/cancelled by
// anyone with a tab open to run the 30s ring timer, so it's safe to treat
// as abandoned.
const STALE_RINGING_MS = 2 * 60 * 1000;

// Etapa 6.11: an "active" call can also become orphaned — e.g. the browser
// crashed, laptop lid closed without graceful disconnect, or the network
// dropped at the exact moment the cleanup update would fire. Unlike
// "ringing" (which has a 30s ring timer), "active" calls have no natural
// expiry. 5 minutes is generous enough that no legitimate ongoing call would
// ever be caught (a real call has at least one participant connected to the
// LiveKit room, and if they drop, handleUnexpectedDisconnect retries for
// ~45s before ending the row), but short enough that the user isn't stuck
// for hours unable to call again.
const STALE_ACTIVE_MS = 5 * 60 * 1000;

async function expireStaleCall(conversationId: string): Promise<void> {
  const { data } = await supabase
    .from("dm_calls")
    .select("id, status, started_at")
    .eq("conversation_id", conversationId)
    .in("status", ["ringing", "active"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return;

  const ageMs = Date.now() - new Date(data.started_at).getTime();

  if (data.status === "ringing" && ageMs > STALE_RINGING_MS) {
    // .eq("status","ringing") guards against a TOCTOU flip between the SELECT
    // above and this write (e.g. it got accepted a moment ago) — matches the
    // same discipline already used by the ring-timeout effect below. The 6.5
    // trigger would reject a non-ringing->missed transition anyway, but the
    // WHERE clause keeps this a clean no-op instead of a thrown error.
    await supabase
      .from("dm_calls")
      .update({ status: "missed", ended_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("status", "ringing");
    return;
  }

  if (data.status === "active" && ageMs > STALE_ACTIVE_MS) {
    // Same TOCTOU guard: only touch rows still "active" at UPDATE time.
    // The 6.5 trigger only allows active->ended, so this is the correct
    // terminal state for an orphaned active call.
    await supabase
      .from("dm_calls")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("status", "active");
  }
}

export function useDmCall(
  conversationId: string | undefined,
  myId: string | undefined,
): DmCallHook {
  const roomRef = useRef<Room | null>(null);
  const callRef = useRef<DmCallRow | null>(null);
  const connectingRef = useRef(false);
  const intentionalRef = useRef(false);
  // connectRoom is memoized once (stable identity) but needs to call the *latest*
  // handleUnexpectedDisconnect (which closes over conversationId and can change
  // across renders) — routed through a ref to sidestep the stale-closure trap.
  const handleUnexpectedDisconnectRef = useRef<(reason: DisconnectReason | undefined) => void>(
    () => {},
  );
  // Same "remember the last mic state" fix as useVoiceRoom — this hook is
  // mounted once for the whole session (lifted to app.tsx so calls survive
  // navigation), so the ref naturally carries the preference from one call
  // to the next.
  const micPrefRef = useRef(true);
  const [status, setStatus] = useState<DmCallStatus>("idle");
  const [call, setCall] = useState<DmCallRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [, forceTick] = useReducer((n: number) => n + 1, 0);

  const setCallState = useCallback((row: DmCallRow | null) => {
    callRef.current = row;
    setCall(row);
  }, []);

  const connectRoom = useCallback(async (convId: string) => {
    if (connectingRef.current || roomRef.current) return;
    connectingRef.current = true;
    intentionalRef.current = false;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Sessão inválida.");

      const { token, url } = await mintDmVoiceToken({
        data: { conversationId: convId, accessToken },
      });

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: ROOM_PUBLISH_DEFAULTS,
      });
      // See useVoiceRoom's connectRoom for why this is throttled, not direct:
      // connecting fires a burst of these in the same instant, and each one
      // used to be its own synchronous re-render landing right as the call
      // view mounts — exactly when someone is likely to start scrolling.
      const tick = throttleTrailing(forceTick, 200);
      room
        .on(RoomEvent.ParticipantConnected, tick)
        .on(RoomEvent.ParticipantDisconnected, tick)
        .on(RoomEvent.TrackSubscribed, tick)
        .on(RoomEvent.TrackUnsubscribed, tick)
        .on(RoomEvent.TrackMuted, tick)
        .on(RoomEvent.TrackUnmuted, tick)
        .on(RoomEvent.LocalTrackPublished, tick)
        .on(RoomEvent.LocalTrackUnpublished, tick)
        .on(RoomEvent.ActiveSpeakersChanged, throttleTrailing(forceTick, 400))
        .on(RoomEvent.Reconnecting, () => setReconnecting(true))
        .on(RoomEvent.Reconnected, () => setReconnecting(false))
        .on(RoomEvent.Disconnected, (reason) => {
          if (intentionalRef.current) {
            roomRef.current = null;
            setReconnecting(false);
            forceTick();
          } else {
            handleUnexpectedDisconnectRef.current(reason);
          }
        });

      await room.connect(url, token);
      await room.localParticipant.setMicrophoneEnabled(micPrefRef.current, MIC_CAPTURE_OPTIONS);
      if (callRef.current?.kind === "video") {
        // A camera failure (busy, missing, denied) shouldn't kill an otherwise
        // working audio call — fall back to audio-only instead of aborting.
        try {
          await room.localParticipant.setCameraEnabled(true);
        } catch {
          // ignored: call continues without video
        }
      }
      roomRef.current = room;
      forceTick();
    } finally {
      connectingRef.current = false;
    }
  }, []);

  // A dropped connection we didn't cause ourselves (network blip, laptop sleep,
  // wifi switch, ...). Instead of giving up the moment LiveKit's own internal
  // reconnect exhausts, keep retrying with a fresh room/token for a while —
  // only once that also fails do we surface an error and close out the call
  // row, so the other side (and the call log) aren't left with a call stuck
  // "active" forever.
  const handleUnexpectedDisconnect = useCallback(
    (reason: DisconnectReason | undefined) => {
      roomRef.current = null;
      const convId = conversationId;
      const droppedCall = callRef.current;

      if (!convId || !droppedCall) {
        setReconnecting(false);
        setError(disconnectReasonLabel(reason));
        setCallState(null);
        setStatus("idle");
        forceTick();
        return;
      }

      setReconnecting(true);
      forceTick();

      (async () => {
        for (const delay of RECONNECT_RETRY_DELAYS_MS) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          // The call ended for another reason while we were waiting to retry
          // (we hung up, the peer hung up, ...) — nothing left to reconnect to.
          if (callRef.current?.id !== droppedCall.id) return;
          try {
            await connectRoom(convId);
            if (roomRef.current) {
              setReconnecting(false);
              setError(null);
              forceTick();
              return;
            }
          } catch {
            // keep retrying
          }
        }

        setReconnecting(false);
        setError(disconnectReasonLabel(reason));
        await supabase
          .from("dm_calls")
          .update({ status: "ended", ended_at: new Date().toISOString() })
          .eq("id", droppedCall.id)
          .eq("status", "active");
        setCallState(null);
        setStatus("idle");
        forceTick();
      })();
    },
    [conversationId, connectRoom, setCallState],
  );
  handleUnexpectedDisconnectRef.current = handleUnexpectedDisconnect;

  const endLocally = useCallback(() => {
    intentionalRef.current = true;
    roomRef.current?.disconnect();
    roomRef.current = null;
    setReconnecting(false);
    setCallState(null);
    setStatus("idle");
  }, [setCallState]);

  useEffect(() => {
    if (!conversationId || !myId) return;
    let cancelled = false;

    (async () => {
      await expireStaleCall(conversationId);
      if (cancelled) return;

      const { data } = await supabase
        .from("dm_calls")
        .select("*")
        .eq("conversation_id", conversationId)
        .in("status", ["ringing", "active"])
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled || !data) return;

      if (data.status === "ringing" && data.started_by !== myId) {
        setCallState(data);
        setStatus("incoming");
      }
    })();

    const channel = supabase
      .channel(`dm-calls:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "dm_calls",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as DmCallRow | undefined;
          if (!row) return;

          if (row.status === "ringing" && row.started_by !== myId) {
            setCallState(row);
            setStatus((s) => (s === "idle" ? "incoming" : s));
            return;
          }

          if (callRef.current && row.id !== callRef.current.id) return;

          if (row.status === "active") {
            setCallState(row);
            if (roomRef.current) {
              setStatus("active");
            } else {
              setStatus("connecting");
              connectRoom(conversationId)
                .then(() => setStatus("active"))
                .catch((err) => {
                  setError(err instanceof Error ? err.message : "Falha ao conectar.");
                  endLocally();
                });
            }
            return;
          }

          if (row.status === "ended" || row.status === "declined" || row.status === "missed") {
            endLocally();
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      intentionalRef.current = true;
      roomRef.current?.disconnect();
      roomRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, myId]);

  // Live ring timer, keyed off the call row's own started_at so it fires at
  // the same instant on both the caller's and callee's screens regardless of
  // when either tab mounted. The eq("status","ringing") guard makes this a
  // no-op once the call's been answered/declined/cancelled, and if both
  // sides' timers happen to fire together only the first write changes
  // anything — the other one just matches zero rows.
  useEffect(() => {
    if ((status !== "outgoing" && status !== "incoming") || !call) return;
    const remaining = RING_TIMEOUT_MS - (Date.now() - new Date(call.started_at).getTime());
    const timer = setTimeout(
      async () => {
        // .select() so we know whether *this* write actually flipped the row
        // (vs. it having already been answered/declined/cancelled a moment
        // earlier) — if it did, drop out of the ringing UI immediately
        // instead of waiting on the realtime echo, which is what left the
        // "Chamando..." banner stuck on screen after the DB had already
        // moved on.
        const { data } = await supabase
          .from("dm_calls")
          .update({ status: "missed", ended_at: new Date().toISOString() })
          .eq("id", call.id)
          .eq("status", "ringing")
          .select();
        if (data && data.length > 0) {
          endLocally();
        }
      },
      Math.max(remaining, 0),
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, call?.id, call?.started_at, endLocally]);

  const start = useCallback(
    async (kind: DmCallKind) => {
      if (!conversationId || !myId) return;
      setError(null);
      setStatus("outgoing");
      try {
        // Etapa 6.10 + 6.11: sweep orphaned calls before attempting the
        // INSERT. Covers both "ringing" calls abandoned before anyone's 30s
        // ring timer ran (>2min = missed), and "active" calls whose
        // participants crashed/disconnected without cleanly ending the row
        // (>5min = ended). Since Etapa 6.9's unique index blocks any new
        // call while one of these exists, sweeping here — right before the
        // one moment that actually needs the slot free — means the fix
        // doesn't depend on anyone having the conversation open at all.
        await expireStaleCall(conversationId);

        const { data, error: insertError } = await supabase
          .from("dm_calls")
          .insert({ conversation_id: conversationId, started_by: myId, kind })
          .select()
          .single();
        if (insertError) {
          // dm_calls_one_ringing_or_active_per_conversation (Etapa 6.9) —
          // the database, not this client, is the authority on whether a
          // call can start: two tabs/devices can race to INSERT at the same
          // instant, and only the DB can arbitrate which one actually wins.
          // Postgres unique-violation is SQLSTATE 23505.
          if (insertError.code === "23505") {
            throw new Error("Já existe uma chamada em andamento nesta conversa.");
          }
          throw insertError;
        }
        setCallState(data);
        await connectRoom(conversationId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Não foi possível iniciar a chamada.");
        setStatus("idle");
      }
    },
    [conversationId, myId, connectRoom, setCallState],
  );

  const accept = useCallback(async () => {
    if (!callRef.current || !conversationId) return;
    setStatus("connecting");
    try {
      const { data, error: updateError } = await supabase
        .from("dm_calls")
        .update({ status: "active", answered_at: new Date().toISOString() })
        .eq("id", callRef.current.id)
        .select()
        .single();
      if (updateError) throw updateError;
      setCallState(data);
      await connectRoom(conversationId);
      setStatus("active");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível entrar na chamada.");
      setStatus("idle");
    }
  }, [conversationId, connectRoom, setCallState]);

  const decline = useCallback(async () => {
    if (!callRef.current) return;
    await supabase
      .from("dm_calls")
      .update({ status: "declined", ended_at: new Date().toISOString() })
      .eq("id", callRef.current.id);
    setCallState(null);
    setStatus("idle");
  }, [setCallState]);

  const hangup = useCallback(async () => {
    const activeCall = callRef.current;
    if (activeCall) {
      const nextStatus = activeCall.answered_at ? "ended" : "missed";
      await supabase
        .from("dm_calls")
        .update({ status: nextStatus, ended_at: new Date().toISOString() })
        .eq("id", activeCall.id);
    }
    endLocally();
  }, [endLocally]);

  const toggleMic = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const enabled = !room.localParticipant.isMicrophoneEnabled;
    micPrefRef.current = enabled;
    await room.localParticipant.setMicrophoneEnabled(enabled, MIC_CAPTURE_OPTIONS);
    forceTick();
  }, []);

  const toggleCamera = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    await room.localParticipant.setCameraEnabled(!room.localParticipant.isCameraEnabled);
    forceTick();
  }, []);

  const toggleScreenShare = useCallback(async (quality: ScreenShareQuality = "1080p") => {
    const room = roomRef.current;
    if (!room) return;
    try {
      await swapOrStartScreenShare(room, quality);
    } catch {
      // User cancelled the share picker or denied permission — leave the current share (if any) as-is.
    }
    forceTick();
  }, []);

  const stopScreenShareAction = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    await stopScreenShare(room);
    forceTick();
  }, []);

  const room = roomRef.current;
  const participants: ParticipantInfo[] = room
    ? [
        toInfo(room.localParticipant),
        ...Array.from(room.remoteParticipants.values() as IterableIterator<RemoteParticipant>).map(
          toInfo,
        ),
      ]
    : [];

  return {
    status,
    error,
    reconnecting,
    call,
    participants,
    micEnabled: room?.localParticipant.isMicrophoneEnabled ?? false,
    cameraEnabled: room?.localParticipant.isCameraEnabled ?? false,
    screenShareEnabled: room?.localParticipant.isScreenShareEnabled ?? false,
    start,
    accept,
    decline,
    hangup,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    stopScreenShare: stopScreenShareAction,
  };
}
