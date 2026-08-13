const STORAGE_KEY = "dexy:recent-emojis";
const MAX_RECENTS = 16;

export function getRecentEmojis(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function pushRecentEmoji(emoji: string): string[] {
  const next = [emoji, ...getRecentEmojis().filter((e) => e !== emoji)].slice(0, MAX_RECENTS);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable (private mode, quota) — recents just won't persist.
  }
  return next;
}
