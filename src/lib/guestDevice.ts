const KEY = "dexy_guest_blocked_until";
const BLOCK_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export function getGuestBlockRemainingMs(): number {
  const raw = localStorage.getItem(KEY);
  if (!raw) return 0;
  return Math.max(0, Number(raw) - Date.now());
}

export function markGuestSignedOut(): void {
  localStorage.setItem(KEY, String(Date.now() + BLOCK_DURATION_MS));
}
