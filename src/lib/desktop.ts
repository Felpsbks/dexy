// Bridge exposed by the Dexy desktop app's preload (electron/preload.cts).
// Absent in a normal browser; every caller must handle `null`.
export interface DesktopPrefs {
  minimizeToTray: boolean;
  openOnStartup: boolean;
  startMinimized: boolean;
  shareActivity?: boolean;
  shortcuts: { toggleMute: string; toggleDeafen: string; saveClip?: string };
  version?: string;
}

export interface PickerSource {
  id: string;
  name: string;
  kind: "screen" | "window";
  thumbnail: string;
  appIcon: string | null;
}

export interface DexyDesktop {
  isDesktop: true;
  platform: string;
  titleBarHeight: number;
  setBadge(count: number): void;
  flash(): void;
  focus(): void;
  getPrefs(): Promise<DesktopPrefs | null>;
  setPrefs(patch: Partial<DesktopPrefs>): Promise<DesktopPrefs | null>;
  onShortcut(cb: (action: "toggle-mute" | "toggle-deafen" | "save-clip") => void): () => void;
  onPickSource(cb: (sources: PickerSource[]) => void): () => void;
  pickSourceResult(id: string | null): void;
  setPushToTalk?(cfg: { enabled: boolean; code: string }): void;
  onPushToTalk?(cb: (down: boolean) => void): () => void;
  saveClip?(data: Uint8Array): Promise<string | null>;
  showClip?(path: string): void;
  getActivity?(): Promise<string | null>;
  onActivity?(cb: (game: string | null) => void): () => void;
}

export function getDesktop(): DexyDesktop | null {
  if (typeof window === "undefined") return null;
  const d = (window as unknown as { dexyDesktop?: DexyDesktop }).dexyDesktop;
  return d?.isDesktop ? d : null;
}

// Native toast (Windows notification center in the desktop app, browser
// notification on the web). Only fires while Dexy isn't the focused window.
export function notifyNative(title: string, body: string, onClick?: () => void) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (document.hasFocus()) return;
  const show = () => {
    const n = new Notification(title, { body, icon: "/icon-192.png", silent: true });
    n.onclick = () => {
      getDesktop()?.focus();
      window.focus();
      onClick?.();
      n.close();
    };
  };
  if (Notification.permission === "granted") show();
  else if (Notification.permission === "default") void Notification.requestPermission().then((p) => p === "granted" && show());
  getDesktop()?.flash();
}
