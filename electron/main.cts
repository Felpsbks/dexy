import { app, BrowserWindow, session } from "electron";
import * as path from "node:path";
import { registerDisplayMediaHandler } from "./display-media-handler.cjs";

// Same H.264 publish path as src/lib/livekit.ts's ROOM_PUBLISH_DEFAULTS --
// this just makes sure Chromium's hardware encoder is available to use it,
// instead of silently falling back to software encoding.
app.commandLine.appendSwitch("enable-features", "WebRtcH264Encoder,PlatformHEVCEncoderSupport");

const APP_URL = process.env.DEXY_DESKTOP_URL ?? (app.isPackaged ? "https://dexy.site" : "http://localhost:8080");

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadURL(APP_URL);
}

app.whenReady().then(() => {
  registerDisplayMediaHandler(session.defaultSession);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
