import { desktopCapturer, type Session } from "electron";

// Chromium's own getDisplayMedia() picker doesn't exist inside Electron --
// without a handler registered here, the request either rejects or falls
// back to an unusable empty picker. Auto-selecting the primary screen keeps
// src/lib/livekit.ts's swapOrStartScreenShare() (still just a plain
// getDisplayMedia() call under the hood) working end to end unmodified.
// A custom picker window listing desktopCapturer sources (screens + windows,
// with thumbnails) replaces this auto-pick in a later phase.
export function registerDisplayMediaHandler(session: Session) {
  session.setDisplayMediaRequestHandler(async (request, callback) => {
    const sources = await desktopCapturer.getSources({ types: ["screen"] });
    const primaryScreen = sources[0];
    if (!primaryScreen) {
      callback({});
      return;
    }
    callback({ video: primaryScreen, audio: request.audioRequested ? "loopback" : undefined });
  });
}
