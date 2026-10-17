import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  session,
  shell,
  Tray,
} from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { registerDisplayMediaHandler, resetPickerReady } from "./display-media-handler.cjs";

const APP_URL = process.env.DEXY_DESKTOP_URL ?? (app.isPackaged ? "https://dexy.site" : "http://localhost:8080");
const APP_ORIGIN = new URL(APP_URL).origin;
const ICON = path.join(__dirname, "..", "electron", "assets", "icon.ico");
const TITLEBAR_HEIGHT = 32;
const BG = "#05070d";

interface DesktopPrefs {
  minimizeToTray: boolean;
  openOnStartup: boolean;
  startMinimized: boolean;
  shortcuts: { toggleMute: string; toggleDeafen: string };
}
const DEFAULT_PREFS: DesktopPrefs = {
  minimizeToTray: true,
  openOnStartup: false,
  startMinimized: false,
  shortcuts: { toggleMute: "CommandOrControl+Shift+M", toggleDeafen: "CommandOrControl+Shift+D" },
};
const prefsFile = () => path.join(app.getPath("userData"), "desktop-prefs.json");
function loadPrefs(): DesktopPrefs {
  try {
    const p = JSON.parse(fs.readFileSync(prefsFile(), "utf8"));
    return { ...DEFAULT_PREFS, ...p, shortcuts: { ...DEFAULT_PREFS.shortcuts, ...p.shortcuts } };
  } catch {
    return { ...DEFAULT_PREFS, shortcuts: { ...DEFAULT_PREFS.shortcuts } };
  }
}
let prefs: DesktopPrefs = DEFAULT_PREFS;
function savePrefs() {
  try {
    fs.writeFileSync(prefsFile(), JSON.stringify(prefs, null, 2));
  } catch (err) {
    console.warn("could not save desktop prefs", err);
  }
}

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function sendToRenderer(channel: string, ...args: unknown[]) {
  win?.webContents.send(channel, ...args);
}

function applyStartup() {
  app.setLoginItemSettings({ openAtLogin: prefs.openOnStartup, args: ["--hidden"] });
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  const bind = (accel: string, action: string) => {
    if (!accel) return;
    try {
      globalShortcut.register(accel, () => sendToRenderer("dexy:shortcut", action));
    } catch (err) {
      console.warn("shortcut failed", accel, err);
    }
  };
  bind(prefs.shortcuts.toggleMute, "toggle-mute");
  bind(prefs.shortcuts.toggleDeafen, "toggle-deafen");
}

function buildTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip("Dexy");
  const refresh = () =>
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Abrir Dexy", click: showWindow },
        { type: "separator" },
        { label: "Mutar / desmutar", click: () => sendToRenderer("dexy:shortcut", "toggle-mute") },
        { label: "Ensurdecer / ouvir", click: () => sendToRenderer("dexy:shortcut", "toggle-deafen") },
        { type: "separator" },
        {
          label: "Iniciar com o Windows",
          type: "checkbox",
          checked: prefs.openOnStartup,
          click: (item) => {
            prefs.openOnStartup = item.checked;
            savePrefs();
            applyStartup();
          },
        },
        { type: "separator" },
        {
          label: "Sair do Dexy",
          click: () => {
            quitting = true;
            app.quit();
          },
        },
      ]),
    );
  refresh();
  tray.on("click", showWindow);
  return refresh;
}

function createWindow(startHidden: boolean) {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 500,
    show: false,
    title: "Dexy",
    icon: ICON,
    backgroundColor: BG,
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    titleBarOverlay: { color: BG, symbolColor: "#cbd5e1", height: TITLEBAR_HEIGHT },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.once("ready-to-show", () => {
    if (!startHidden) win?.show();
  });
  win.on("close", (e) => {
    if (!quitting && prefs.minimizeToTray) {
      e.preventDefault();
      win?.hide();
    }
  });
  win.on("focus", () => win?.flashFrame(false));
  win.webContents.on("did-navigate", resetPickerReady);
  // Links to other sites open in the real browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_ORIGIN)) void shell.openExternal(url);
    return { action: url.startsWith(APP_ORIGIN) ? "allow" : "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(APP_ORIGIN)) {
      e.preventDefault();
      void shell.openExternal(url);
    }
  });
  win.loadURL(APP_URL);
}

function registerIpc(refreshTray: () => void) {
  const fromApp = (e: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) =>
    e.senderFrame?.url.startsWith(APP_ORIGIN) ?? false;

  ipcMain.handle("dexy:get-prefs", (e) => (fromApp(e) ? { ...prefs, version: app.getVersion() } : null));
  ipcMain.handle("dexy:set-prefs", (e, patch: Partial<DesktopPrefs>) => {
    if (!fromApp(e)) return null;
    prefs = { ...prefs, ...patch, shortcuts: { ...prefs.shortcuts, ...(patch.shortcuts ?? {}) } };
    savePrefs();
    applyStartup();
    registerShortcuts();
    refreshTray();
    return { ...prefs, version: app.getVersion() };
  });
  ipcMain.on("dexy:set-badge", (e, count: number, pngDataUrl: string | null) => {
    if (!fromApp(e) || !win) return;
    const n = Math.max(0, Math.floor(Number(count) || 0));
    if (n === 0 || typeof pngDataUrl !== "string" || !pngDataUrl.startsWith("data:image/png;base64,")) {
      win.setOverlayIcon(null, "");
    } else {
      win.setOverlayIcon(nativeImage.createFromDataURL(pngDataUrl), `${n} não lidas`);
    }
    tray?.setToolTip(n ? `Dexy · ${n} não lidas` : "Dexy");
  });
  ipcMain.on("dexy:flash", (e) => {
    if (fromApp(e) && win && !win.isFocused()) win.flashFrame(true);
  });
  ipcMain.on("dexy:focus", (e) => {
    if (fromApp(e)) showWindow();
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
  app.setAppUserModelId("site.dexy.desktop");
  nativeTheme.themeSource = "dark";

  app.whenReady().then(() => {
    prefs = loadPrefs();
    applyStartup();
    const startHidden = process.argv.includes("--hidden") || prefs.startMinimized;
    registerDisplayMediaHandler(session.defaultSession, () => win);
    const refreshTray = buildTray();
    registerIpc(refreshTray);
    createWindow(startHidden);
    registerShortcuts();

    app.on("activate", () => (win ? showWindow() : createWindow(false)));
  });

  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("will-quit", () => globalShortcut.unregisterAll());
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
