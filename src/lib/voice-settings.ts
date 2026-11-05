import { useSyncExternalStore } from "react";

export type NoiseSuppressionMode = "krisp" | "standard" | "off";
export type InputMode = "voice" | "ptt";

export interface VoiceSettings {
  noiseSuppression: NoiseSuppressionMode;
  echoCancellation: boolean;
  // Off by default: measured against LiveKit Cloud, Chromium's AGC raised a
  // background voice ~13 dB (to nearly the level of the main speaker) while
  // leaving the main speaker unchanged.
  autoGainControl: boolean;
  inputMode: InputMode;
  // KeyboardEvent.code ("Backquote", "KeyV", "F13"...) or "Mouse4"/"Mouse5".
  pttKey: string;
  pttReleaseDelay: number;
}

const KEY = "dexy.voiceSettings";
const DEFAULTS: VoiceSettings = {
  noiseSuppression: "krisp",
  echoCancellation: true,
  autoGainControl: false,
  inputMode: "voice",
  pttKey: "Backquote",
  pttReleaseDelay: 200,
};
const EVENT = "dexy:voice-settings";

let cached: VoiceSettings | null = null;

export function getVoiceSettings(): VoiceSettings {
  if (cached) return cached;
  let stored: Partial<VoiceSettings> = {};
  try {
    stored = JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    // unavailable or corrupt -- defaults
  }
  cached = { ...DEFAULTS, ...stored };
  return cached;
}

export function updateVoiceSettings(patch: Partial<VoiceSettings>) {
  cached = { ...getVoiceSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    // keep the in-memory value
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

export function useVoiceSettings(): VoiceSettings {
  return useSyncExternalStore(subscribe, getVoiceSettings, () => DEFAULTS);
}

export function onVoiceSettingsChange(cb: () => void) {
  return subscribe(cb);
}
