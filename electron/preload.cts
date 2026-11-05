import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

function badgePng(n: number): string | null {
  if (n <= 0) return null;
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const x = c.getContext("2d");
  if (!x) return null;
  x.fillStyle = "#ef4444";
  x.beginPath();
  x.arc(16, 16, 16, 0, Math.PI * 2);
  x.fill();
  const label = n > 99 ? "99+" : String(n);
  x.fillStyle = "#fff";
  x.font = `bold ${label.length > 2 ? 13 : label.length > 1 ? 17 : 20}px "Segoe UI", Arial, sans-serif`;
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText(label, 16, 17);
  return c.toDataURL("image/png");
}

// The only surface the Dexy site gets from the desktop shell. Everything is
// a narrow message; no Node, filesystem or arbitrary IPC is exposed.
contextBridge.exposeInMainWorld("dexyDesktop", {
  isDesktop: true,
  platform: process.platform,
  titleBarHeight: 32,
  setBadge: (count: number) => ipcRenderer.send("dexy:set-badge", count, badgePng(count)),
  flash: () => ipcRenderer.send("dexy:flash"),
  focus: () => ipcRenderer.send("dexy:focus"),
  getPrefs: () => ipcRenderer.invoke("dexy:get-prefs"),
  setPrefs: (patch: unknown) => ipcRenderer.invoke("dexy:set-prefs", patch),
  onShortcut: (cb: (action: string) => void) => {
    const h = (_e: IpcRendererEvent, action: string) => cb(action);
    ipcRenderer.on("dexy:shortcut", h);
    return () => ipcRenderer.removeListener("dexy:shortcut", h);
  },
  onPickSource: (cb: (sources: unknown[]) => void) => {
    const h = (_e: IpcRendererEvent, sources: unknown[]) => cb(sources);
    ipcRenderer.on("dexy:pick-source", h);
    ipcRenderer.send("dexy:picker-ready");
    return () => ipcRenderer.removeListener("dexy:pick-source", h);
  },
  pickSourceResult: (id: string | null) => ipcRenderer.send("dexy:picker-result", id),
  saveClip: (data: Uint8Array) => ipcRenderer.invoke("dexy:save-clip", data),
  showClip: (file: string) => ipcRenderer.send("dexy:show-clip", file),
  getActivity: () => ipcRenderer.invoke("dexy:get-activity"),
  onActivity: (cb: (game: string | null) => void) => {
    const h = (_e: IpcRendererEvent, game: string | null) => cb(game);
    ipcRenderer.on("dexy:activity", h);
    return () => ipcRenderer.removeListener("dexy:activity", h);
  },
  setPushToTalk: (cfg: { enabled: boolean; code: string }) => ipcRenderer.send("dexy:set-ptt", cfg),
  onPushToTalk: (cb: (down: boolean) => void) => {
    const h = (_e: IpcRendererEvent, down: boolean) => cb(!!down);
    ipcRenderer.on("dexy:ptt", h);
    return () => ipcRenderer.removeListener("dexy:ptt", h);
  },
});
