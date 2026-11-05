import { useEffect } from "react";
import { Music2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SOUNDS, setSoundboardMuted, type SoundId } from "@/lib/soundboard";

export function SoundboardButton({ onPlay, deafened }: { onPlay: (id: SoundId) => void; deafened?: boolean }) {
  useEffect(() => {
    setSoundboardMuted(!!deafened);
    return () => setSoundboardMuted(false);
  }, [deafened]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          title="Soundboard"
          aria-label="Soundboard"
          className="w-10 h-10 rounded-full grid place-items-center bg-secondary text-foreground hover:bg-secondary/70 transition"
        >
          <Music2 className="w-4 h-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" className="w-64 space-y-2">
        <div className="text-xs font-semibold uppercase text-muted-foreground">Soundboard</div>
        <div className="grid grid-cols-2 gap-1.5">
          {SOUNDS.map((s) => (
            <button
              key={s.id}
              onClick={() => onPlay(s.id)}
              className="flex items-center gap-2 rounded-lg bg-secondary px-2 py-2 text-left text-xs font-medium hover:bg-secondary/70 transition"
            >
              <span aria-hidden>{s.emoji}</span>
              <span className="truncate">{s.label}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
