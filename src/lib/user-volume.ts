import { useSyncExternalStore } from "react";

// Per-person playback settings, local to this device (like Discord's
// "User Volume" / "Mute"): separately for their voice and their stream audio.
export type VolumeKind = "voice" | "stream";
export interface UserVolume {
  volume: number; // 0..2 (0%..200%)
  muted: boolean;
}

const KEY = "dexy.userVolumes";
const EVENT = "dexy:user-volumes";
const DEFAULT: UserVolume = { volume: 1, muted: false };
let cache: Record<string, UserVolume> | null = null;

function all(): Record<string, UserVolume> {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    cache = {};
  }
  return cache!;
}

export function getUserVolume(kind: VolumeKind, userId: string): UserVolume {
  return all()[`${kind}:${userId}`] ?? DEFAULT;
}

export function setUserVolume(kind: VolumeKind, userId: string, patch: Partial<UserVolume>) {
  const next = { ...all(), [`${kind}:${userId}`]: { ...getUserVolume(kind, userId), ...patch } };
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // keep in memory
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

export function useUserVolume(kind: VolumeKind, userId: string): UserVolume {
  return useSyncExternalStore(
    subscribe,
    () => getUserVolume(kind, userId),
    () => DEFAULT,
  );
}

let playbackCtx: AudioContext | null = null;
// Shared context for >100% boosts. Created on demand (joining a call is a
// user gesture, so it starts running).
export function getPlaybackContext(): AudioContext {
  if (!playbackCtx || playbackCtx.state === "closed") playbackCtx = new AudioContext();
  if (playbackCtx.state === "suspended") void playbackCtx.resume();
  return playbackCtx;
}
