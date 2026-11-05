import { ipcMain, type BrowserWindow } from "electron";

// Global push-to-talk. Electron's globalShortcut reports presses only, never
// releases, so the key state is polled with GetAsyncKeyState. A low-level
// keyboard hook was tried first and stopped delivering events during calls;
// polling also adds no latency to the game's own input. The bound key is a
// web KeyboardEvent.code ("KeyV", "F13", "ControlLeft"...) or "Mouse3..5".
const POLL_MS = 15;

const NAMED_VK: Record<string, number> = {
  Mouse3: 0x04,
  Mouse4: 0x05,
  Mouse5: 0x06,
  Backspace: 0x08,
  Tab: 0x09,
  Enter: 0x0d,
  CapsLock: 0x14,
  Space: 0x20,
  PageUp: 0x21,
  PageDown: 0x22,
  End: 0x23,
  Home: 0x24,
  ArrowLeft: 0x25,
  ArrowUp: 0x26,
  ArrowRight: 0x27,
  ArrowDown: 0x28,
  Insert: 0x2d,
  Delete: 0x2e,
  ShiftLeft: 0xa0,
  ShiftRight: 0xa1,
  ControlLeft: 0xa2,
  ControlRight: 0xa3,
  AltLeft: 0xa4,
  AltRight: 0xa5,
  Semicolon: 0xba,
  Equal: 0xbb,
  Comma: 0xbc,
  Minus: 0xbd,
  Period: 0xbe,
  Slash: 0xbf,
  Backquote: 0xc0,
  BracketLeft: 0xdb,
  Backslash: 0xdc,
  BracketRight: 0xdd,
  Quote: 0xde,
};

function vkForCode(code: string): number | null {
  if (NAMED_VK[code] !== undefined) return NAMED_VK[code];
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1].charCodeAt(0);
  m = /^Digit([0-9])$/.exec(code);
  if (m) return 0x30 + Number(m[1]);
  m = /^Numpad([0-9])$/.exec(code);
  if (m) return 0x60 + Number(m[1]);
  m = /^F([1-9]|1[0-9]|2[0-4])$/.exec(code);
  if (m) return 0x70 + Number(m[1]) - 1;
  return null;
}

type KeyStateFn = (vk: number) => number;

function loadKeyState(): KeyStateFn | null {
  if (process.platform !== "win32") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require("koffi");
    return koffi.load("user32.dll").func("short __stdcall GetAsyncKeyState(int vKey)");
  } catch (err) {
    console.warn("push-to-talk unavailable", err);
    return null;
  }
}

export function registerPushToTalk(getWin: () => BrowserWindow | null) {
  let keyState: KeyStateFn | null | undefined;
  let timer: ReturnType<typeof setInterval> | null = null;
  let held = false;

  const emit = (down: boolean) => {
    if (held === down) return;
    held = down;
    getWin()?.webContents.send("dexy:ptt", down);
  };

  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
    emit(false);
  };

  ipcMain.on("dexy:set-ptt", (_e, cfg: { enabled?: boolean; code?: string } | null) => {
    stop();
    const vk = cfg?.enabled && typeof cfg.code === "string" ? vkForCode(cfg.code) : null;
    if (vk === null) return;
    if (keyState === undefined) keyState = loadKeyState();
    const read = keyState;
    if (!read) return;
    timer = setInterval(() => emit((read(vk) & 0x8000) !== 0), POLL_MS);
  });

  return stop;
}
