import { useEffect } from "react";
import { getDesktop } from "./desktop";
import { setPushToTalkHeld } from "./livekit";
import { useVoiceSettings } from "./voice-settings";

const isTypingTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

// Wires the push-to-talk key: global (works inside games) through the desktop
// app's native hook, or window-focused key/mouse listeners in a browser.
export function usePushToTalkKeys() {
  const { inputMode, pttKey } = useVoiceSettings();
  const enabled = inputMode === "ptt";

  useEffect(() => {
    const d = getDesktop();
    if (d?.setPushToTalk && d.onPushToTalk) {
      d.setPushToTalk({ enabled, code: pttKey });
      const off = d.onPushToTalk(setPushToTalkHeld);
      return () => {
        off();
        d.setPushToTalk?.({ enabled: false, code: "" });
        setPushToTalkHeld(false);
      };
    }
    if (!enabled) return;
    const mouse = /^Mouse([3-5])$/.exec(pttKey);
    // Web MouseEvent.button: 3 = back (Mouse4), 4 = forward (Mouse5).
    const webButton = mouse ? Number(mouse[1]) - 1 : null;
    const down = (e: KeyboardEvent) => {
      if (e.code === pttKey && !e.repeat && !isTypingTarget(e.target)) setPushToTalkHeld(true);
    };
    const up = (e: KeyboardEvent) => e.code === pttKey && setPushToTalkHeld(false);
    const mdown = (e: MouseEvent) => webButton !== null && e.button === webButton && setPushToTalkHeld(true);
    const mup = (e: MouseEvent) => webButton !== null && e.button === webButton && setPushToTalkHeld(false);
    const blur = () => setPushToTalkHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("mousedown", mdown);
    window.addEventListener("mouseup", mup);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("mousedown", mdown);
      window.removeEventListener("mouseup", mup);
      window.removeEventListener("blur", blur);
      setPushToTalkHeld(false);
    };
  }, [enabled, pttKey]);
}

export function prettyKey(code: string) {
  if (code === "Mouse4") return "Mouse 4 (voltar)";
  if (code === "Mouse5") return "Mouse 5 (avançar)";
  if (code === "Mouse3") return "Botão do meio";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  const names: Record<string, string> = {
    Backquote: "` (acento grave)",
    ControlLeft: "Ctrl esquerdo",
    ControlRight: "Ctrl direito",
    AltLeft: "Alt",
    AltRight: "Alt Gr",
    ShiftLeft: "Shift esquerdo",
    ShiftRight: "Shift direito",
    CapsLock: "Caps Lock",
    Space: "Espaço",
  };
  return names[code] ?? code;
}
