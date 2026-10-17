import { useEffect, useState } from "react";
import { Monitor, AppWindow, X } from "lucide-react";
import { getDesktop, type PickerSource } from "@/lib/desktop";

// Discord-style custom title bar for the desktop app: the native window
// buttons are drawn by Electron's titleBarOverlay on the right; this paints
// the rest of the strip with Dexy's own logo and makes it draggable.
export function DesktopTitleBar() {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const d = getDesktop();
    if (!d) return;
    setDesktop(true);
    document.documentElement.classList.add("dexy-desktop");
    return () => document.documentElement.classList.remove("dexy-desktop");
  }, []);
  if (!desktop) return null;
  return (
    <div
      className="fixed inset-x-0 top-0 z-100 h-8 flex items-center gap-2 pl-3 pr-36 select-none"
      style={{ backgroundColor: "#05070d", WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <img src="/icon-192.png" alt="" className="w-4 h-4 rounded-sm" draggable={false} />
      <img src="/logo-wordmark.webp" alt="Dexy" className="h-3.5 object-contain opacity-90" draggable={false} />
    </div>
  );
}

// In-app source picker (screens + windows with thumbnails), shown when a
// screen share starts inside the desktop app.
export function DesktopSourcePicker() {
  const [sources, setSources] = useState<PickerSource[] | null>(null);
  const [tab, setTab] = useState<"screen" | "window">("screen");

  useEffect(() => {
    const d = getDesktop();
    if (!d) return;
    return d.onPickSource((s) => {
      setTab("screen");
      setSources(s);
    });
  }, []);

  if (!sources) return null;
  const close = (id: string | null) => {
    getDesktop()?.pickSourceResult(id);
    setSources(null);
  };
  const list = sources.filter((s) => s.kind === tab);

  return (
    <div
      className="fixed inset-0 z-90 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={() => close(null)}
      onKeyDown={(e) => e.key === "Escape" && close(null)}
    >
      <div
        role="dialog"
        aria-label="Compartilhar tela"
        className="w-full max-w-3xl max-h-[80vh] flex flex-col rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5">
          <h2 className="text-lg font-bold">Compartilhar tela</h2>
          <button onClick={() => close(null)} aria-label="Cancelar" className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 pt-3 flex gap-2">
          {(
            [
              ["screen", "Telas", Monitor],
              ["window", "Aplicativos", AppWindow],
            ] as const
          ).map(([k, label, Icon]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`h-9 px-4 rounded-lg flex items-center gap-2 text-sm font-medium transition ${
                tab === k ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
        <div className="p-5 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-4">
          {list.map((s) => (
            <button
              key={s.id}
              onClick={() => close(s.id)}
              className="group text-left rounded-xl border border-border bg-background/40 p-2 hover:border-primary transition"
            >
              <div className="aspect-video rounded-lg overflow-hidden bg-black grid place-items-center">
                <img src={s.thumbnail} alt="" className="w-full h-full object-contain" />
              </div>
              <div className="mt-2 flex items-center gap-2 min-w-0">
                {s.appIcon && <img src={s.appIcon} alt="" className="w-4 h-4 shrink-0" />}
                <span className="text-sm truncate group-hover:text-foreground text-muted-foreground">{s.name}</span>
              </div>
            </button>
          ))}
          {list.length === 0 && <div className="col-span-full text-sm text-muted-foreground">Nada para mostrar aqui.</div>}
        </div>
      </div>
    </div>
  );
}
