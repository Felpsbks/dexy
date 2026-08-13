import { useEffect, useRef } from "react";
import type { DmCallStatus } from "./livekit";

// All picked by hand from generated candidates (see the ringtone-lab artifact).
const RING_SRC = "/sounds/ring.wav";
const ACCEPTED_SRC = "/sounds/accepted.wav";
const ENDED_SRC = "/sounds/ended.wav";
const RECONNECTING_SRC = "/sounds/reconnecting.wav";
const SCREEN_SHARE_START_SRC = "/sounds/screen_share_start.wav";
const SCREEN_SHARE_STOP_SRC = "/sounds/screen_share_stop.wav";
const MESSAGE_SENT_SRC = "/sounds/message_sent.wav";
const MESSAGE_RECEIVED_SRC = "/sounds/message_received.wav";
const MIC_MUTED_SRC = "/sounds/mic_muted.wav";
const MIC_UNMUTED_SRC = "/sounds/mic_unmuted.wav";

// Single chokepoint every sound in this file funnels through — gating it
// here covers message/call/mute/screen-share sounds app-wide from one
// place, instead of threading a "sound enabled" prop through every hook.
// Synced from the persisted profiles.notify_sound setting, see app.tsx.
let soundEnabled = true;

export function setSoundEnabled(enabled: boolean) {
  soundEnabled = enabled;
}

function playOneShot(src: string, volume = 0.7) {
  if (typeof window === "undefined" || !soundEnabled) return;
  const audio = new Audio(src);
  audio.volume = volume;
  audio.play().catch(() => {});
}

export function playMessageSentSound() {
  playOneShot(MESSAGE_SENT_SRC, 0.5);
}

function playMessageReceivedSound() {
  playOneShot(MESSAGE_RECEIVED_SRC, 0.5);
}

// Plays when a new message from the other person lands in the currently open
// conversation. Keyed off conversationId too so switching to a different
// conversation never fires a false "received" sound just from loading its
// (possibly other-authored) last message.
export function useIncomingMessageSound(
  lastMessage: { id: string; author_id: string } | undefined,
  conversationId: string | undefined,
  myId: string | undefined,
) {
  const lastSeenRef = useRef<{ conversationId: string; messageId: string } | null>(null);

  useEffect(() => {
    if (!lastMessage || !conversationId) return;
    const prev = lastSeenRef.current;
    const isNewInSameConversation =
      !!prev && prev.conversationId === conversationId && prev.messageId !== lastMessage.id;
    if (isNewInSameConversation && lastMessage.author_id !== myId) {
      playMessageReceivedSound();
    }
    lastSeenRef.current = { conversationId, messageId: lastMessage.id };
  }, [lastMessage, conversationId, myId]);
}

type RingHandle = { stop: () => void };
const NOOP_RING: RingHandle = { stop: () => {} };

const RING_VOLUME = 0.6;
const RING_FADE_OUT_MS = 120;

let ringAudio: HTMLAudioElement | null = null;

function getRingAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!ringAudio) {
    ringAudio = new Audio(RING_SRC);
    ringAudio.loop = true;
  }
  return ringAudio;
}

// Same ring for outgoing and incoming — only one file was picked, and
// splitting it into two would mean *not* using the tone that was chosen.
function startRing(): RingHandle {
  const audio = getRingAudio();
  if (!audio) return NOOP_RING;
  audio.currentTime = 0;
  audio.volume = RING_VOLUME;
  audio.play().catch(() => {});

  let fadeInterval: ReturnType<typeof setInterval> | null = null;
  return {
    // Hanging up mid-ring used to hard-cut the audio, which pops — fade out
    // over a beat instead so stopping never clicks.
    stop: () => {
      if (fadeInterval) return;
      const steps = 8;
      let step = 0;
      fadeInterval = setInterval(() => {
        step += 1;
        audio.volume = Math.max(0, RING_VOLUME * (1 - step / steps));
        if (step >= steps) {
          if (fadeInterval) clearInterval(fadeInterval);
          audio.pause();
          audio.currentTime = 0;
          audio.volume = RING_VOLUME;
        }
      }, RING_FADE_OUT_MS / steps);
    },
  };
}

// Plays the ringtone while a DM call is ringing (outgoing or incoming), a
// chime the moment it's accepted, and a closing sound when a connected call
// ends — driven purely off the call status, so it stays in sync regardless
// of who hung up or whether it dropped and reconnected.
export function useCallSounds(status: DmCallStatus) {
  const ringRef = useRef<RingHandle>(NOOP_RING);
  const prevStatusRef = useRef<DmCallStatus>("idle");

  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;

    if (status === "outgoing" || status === "incoming") {
      if (prev !== status) {
        ringRef.current.stop();
        ringRef.current = startRing();
      }
      return;
    }

    ringRef.current.stop();
    ringRef.current = NOOP_RING;

    if (
      status === "active" &&
      (prev === "outgoing" || prev === "connecting" || prev === "incoming")
    ) {
      playOneShot(ACCEPTED_SRC);
    } else if (status === "idle" && prev !== "idle") {
      // Covers hanging up a connected call, but also cancelling before it's
      // answered or declining/missing one — any of those ends the call.
      playOneShot(ENDED_SRC);
    }
  }, [status]);

  useEffect(() => () => ringRef.current.stop(), []);
}

// Plays once when a call connection drops and the app starts retrying —
// works off the `reconnecting` flag from useDmCall/useVoiceRoom, so it fires
// for a real network drop but not for a normal, intentional hangup.
export function useReconnectingSound(reconnecting: boolean) {
  const wasReconnectingRef = useRef(false);

  useEffect(() => {
    if (reconnecting && !wasReconnectingRef.current) {
      playOneShot(RECONNECTING_SRC);
    }
    wasReconnectingRef.current = reconnecting;
  }, [reconnecting]);
}

// Same chime family covers two different mute actions (your own mic, and
// "silenciar todos"/deafen) — from the user's perspective both are just
// "am I making/hearing noise right now", so one sound pair is reused for
// both instead of maintaining separate audio per toggle.
export function useMuteToggleSound(muted: boolean) {
  const prevRef = useRef(muted);

  useEffect(() => {
    if (muted !== prevRef.current) {
      playOneShot(muted ? MIC_MUTED_SRC : MIC_UNMUTED_SRC, 0.6);
    }
    prevRef.current = muted;
  }, [muted]);
}

// Plays on screen-share start/stop. Swapping to a different window (see
// swapOrStartScreenShare in livekit.ts) never flips `screenShareEnabled` to
// false in between, so it correctly stays quiet during a swap.
export function useScreenShareSound(screenShareEnabled: boolean) {
  const wasSharingRef = useRef(false);

  useEffect(() => {
    if (screenShareEnabled && !wasSharingRef.current) {
      playOneShot(SCREEN_SHARE_START_SRC);
    } else if (!screenShareEnabled && wasSharingRef.current) {
      playOneShot(SCREEN_SHARE_STOP_SRC);
    }
    wasSharingRef.current = screenShareEnabled;
  }, [screenShareEnabled]);
}
