import { desktopCapturer, ipcMain, type BrowserWindow, type Session } from "electron";

export interface PickerSource {
  id: string;
  name: string;
  kind: "screen" | "window";
  thumbnail: string;
  appIcon: string | null;
}

let rendererPickerReady = false;
let pending: ((id: string | null) => void) | null = null;

// A reload/navigation may land on a site version without the picker.
export function resetPickerReady() {
  rendererPickerReady = false;
  pending?.(null);
  pending = null;
}

// Chromium's own getDisplayMedia() picker doesn't exist inside Electron. The
// web app registers an in-app picker (Discord-style, screens + windows with
// live thumbnails) through the preload; until it has, or if it doesn't answer,
// fall back to the primary screen so sharing still works with an older site.
export function registerDisplayMediaHandler(session: Session, getWin: () => BrowserWindow | null) {
  ipcMain.on("dexy:picker-ready", () => {
    rendererPickerReady = true;
  });
  ipcMain.on("dexy:picker-result", (_e, id: string | null) => {
    pending?.(typeof id === "string" ? id : null);
    pending = null;
  });

  session.setDisplayMediaRequestHandler(async (request, callback) => {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 400, height: 225 },
      fetchWindowIcons: true,
    });
    const screens = sources.filter((s) => s.id.startsWith("screen:"));
    const win = getWin();
    let chosenId: string | null = screens[0]?.id ?? null;

    if (rendererPickerReady && win && !win.isDestroyed()) {
      const payload: PickerSource[] = sources
        .filter((s) => s.name !== "Dexy" || s.id.startsWith("screen:"))
        .map((s) => ({
          id: s.id,
          name: s.name,
          kind: s.id.startsWith("screen:") ? "screen" : "window",
          thumbnail: s.thumbnail.toDataURL(),
          appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
        }));
      pending?.(null);
      chosenId = await new Promise<string | null>((resolve) => {
        pending = resolve;
        win.webContents.send("dexy:pick-source", payload);
      });
    }

    const chosen = sources.find((s) => s.id === chosenId);
    if (!chosen) {
      callback({});
      return;
    }
    // System audio loopback only makes sense for a whole screen; for a single
    // window Windows can't isolate that app's audio here.
    const withAudio = request.audioRequested && chosen.id.startsWith("screen:");
    callback({ video: chosen, ...(withAudio ? { audio: "loopback" as const } : {}) });
  });
}
