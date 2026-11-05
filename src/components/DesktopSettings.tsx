import { useEffect, useState } from "react";
import { getDesktop, type DesktopPrefs } from "@/lib/desktop";

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative w-11 h-6 rounded-full transition shrink-0 ${on ? "bg-primary" : "bg-muted"}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-background transition ${on ? "translate-x-5" : ""}`} />
    </button>
  );
}

function prettyAccel(a: string) {
  return a.replace("CommandOrControl", "Ctrl").split("+").join(" + ");
}

// Records the next key combo pressed (with at least one modifier) as an
// Electron accelerator string.
function ShortcutInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [recording, setRecording] = useState(false);
  return (
    <button
      onClick={() => setRecording(true)}
      onBlur={() => setRecording(false)}
      onKeyDown={(e) => {
        if (!recording) return;
        e.preventDefault();
        if (e.key === "Escape") return setRecording(false);
        if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
        const mods = [e.ctrlKey && "CommandOrControl", e.altKey && "Alt", e.shiftKey && "Shift"].filter(Boolean);
        if (!mods.length) return;
        const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
        onChange([...mods, key].join("+"));
        setRecording(false);
      }}
      className={`min-w-44 h-9 px-3 rounded-lg border text-sm font-mono transition ${
        recording ? "border-primary text-primary" : "border-border bg-background/40"
      }`}
    >
      {recording ? "Pressione a combinação…" : prettyAccel(value)}
    </button>
  );
}

export function DesktopSettings() {
  const [prefs, setPrefs] = useState<DesktopPrefs | null>(null);
  useEffect(() => {
    void getDesktop()?.getPrefs().then(setPrefs);
  }, []);
  if (!prefs) return null;
  const update = async (patch: Partial<DesktopPrefs>) => {
    const next = await getDesktop()?.setPrefs(patch);
    if (next) setPrefs(next);
  };

  const rows: { key: "minimizeToTray" | "openOnStartup" | "startMinimized"; label: string; desc: string }[] = [
    { key: "minimizeToTray", label: "Minimizar para a bandeja", desc: "Fechar a janela deixa o Dexy rodando no ícone perto do relógio." },
    { key: "openOnStartup", label: "Abrir o Dexy ao iniciar o Windows", desc: "Abre minimizado na bandeja quando você liga o computador." },
    { key: "startMinimized", label: "Iniciar minimizado", desc: "Ao abrir, o Dexy começa só na bandeja." },
  ];

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        {rows.map((r) => (
          <label key={r.key} className="flex items-start justify-between gap-4 p-4 border border-border rounded-xl bg-card">
            <div>
              <div className="font-medium">{r.label}</div>
              <div className="text-sm text-muted-foreground">{r.desc}</div>
            </div>
            <Toggle label={r.label} on={prefs[r.key]} onChange={(v) => void update({ [r.key]: v })} />
          </label>
        ))}
      </section>
      <section className="space-y-3">
        <div className="text-xs uppercase text-muted-foreground font-semibold">Atalhos globais</div>
        <p className="text-sm text-muted-foreground">Funcionam mesmo com o Dexy minimizado ou com um jogo em tela cheia.</p>
        {(
          [
            ["toggleMute", "Mutar / desmutar microfone"],
            ["toggleDeafen", "Ensurdecer / ouvir"],
            ["saveClip", "Salvar clipe"],
          ] as const
        ).map(([k, label]) => (
          <div key={k} className="flex items-center justify-between gap-4 p-4 border border-border rounded-xl bg-card">
            <div className="font-medium">{label}</div>
            <ShortcutInput value={prefs.shortcuts[k] ?? ""} onChange={(v) => void update({ shortcuts: { ...prefs.shortcuts, [k]: v } })} />
          </div>
        ))}
      </section>
      {prefs.version && <div className="text-xs text-muted-foreground">App desktop versão {prefs.version}</div>}
    </div>
  );
}
