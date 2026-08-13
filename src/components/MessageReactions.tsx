import { forwardRef, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Smile } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { EMOJI_CATEGORIES, QUICK_EMOJIS, findEmojiEntry, type EmojiEntry } from "@/lib/emojiData";
import { getRecentEmojis, pushRecentEmoji } from "@/lib/recentEmojis";
import { getReactionVariant, type ReactionAnimationVariant } from "@/lib/reactionAnimations";

// --- Trigger button (the smiley icon in a message's hover action bar) ---

export const ReactionButton = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(function ReactionButton({ className, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label="Adicionar reação"
      className={cn(
        "p-2 transition text-muted-foreground hover:bg-secondary hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        className,
      )}
      {...props}
    >
      <Smile className="w-4 h-4" />
    </button>
  );
});

// --- Picker: compact, searchable, categorized, with recents ---

export function ReactionPicker({
  children,
  onSelect,
  align = "start",
}: {
  children: ReactNode;
  onSelect: (emoji: string) => void;
  align?: "start" | "center" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);

  useEffect(() => {
    if (open) setRecents(getRecentEmojis());
  }, [open]);

  const handleSelect = (emoji: string) => {
    onSelect(emoji);
    setRecents(pushRecentEmoji(emoji));
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} sideOffset={8} className="w-72 sm:w-80 p-0 overflow-hidden">
        <Command className="bg-popover">
          <CommandInput placeholder="Buscar emoji…" />
          <CommandList className="max-h-64">
            <CommandEmpty>Nenhum emoji encontrado.</CommandEmpty>
            <CommandGroup heading="Rápidas">
              <EmojiGrid emojis={QUICK_EMOJIS.map(findEmojiEntry)} onSelect={handleSelect} />
            </CommandGroup>
            {recents.length > 0 && (
              <CommandGroup heading="Recentes">
                <EmojiGrid emojis={recents.map(findEmojiEntry)} onSelect={handleSelect} />
              </CommandGroup>
            )}
            {EMOJI_CATEGORIES.map((cat) => (
              <CommandGroup key={cat.name} heading={cat.name}>
                <EmojiGrid emojis={cat.emojis} onSelect={handleSelect} />
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function EmojiGrid({
  emojis,
  onSelect,
}: {
  emojis: EmojiEntry[];
  onSelect: (emoji: string) => void;
}) {
  return (
    <div className="grid grid-cols-8 gap-0.5 p-1">
      {emojis.map((e) => (
        <CommandItem
          key={e.emoji}
          value={`${e.name} ${e.keywords} ${e.emoji}`}
          onSelect={() => onSelect(e.emoji)}
          aria-label={`Reagir com ${e.name}`}
          className="justify-center text-lg leading-none rounded-md aspect-square h-8 w-8 p-0 data-[selected=true]:bg-primary/15"
        >
          {e.emoji}
        </CommandItem>
      ))}
    </div>
  );
}

// --- Pill list rendered under a message ---

type RawReaction = { emoji: string; user_id: string };
type AggregatedReaction = { emoji: string; count: number; reacted: boolean };
type ReactionPopMode = "full" | "change" | null;

function aggregateReactions(rows: RawReaction[], myId: string | undefined): AggregatedReaction[] {
  const map = new Map<string, AggregatedReaction>();
  for (const r of rows) {
    const existing = map.get(r.emoji);
    if (existing) {
      existing.count += 1;
      if (r.user_id === myId) existing.reacted = true;
    } else {
      map.set(r.emoji, { emoji: r.emoji, count: 1, reacted: r.user_id === myId });
    }
  }
  return Array.from(map.values());
}

export function ReactionList({
  reactions,
  myId,
  onToggle,
  className,
}: {
  reactions: RawReaction[];
  myId: string | undefined;
  onToggle: (emoji: string) => void;
  className?: string;
}) {
  const aggregated = useMemo(() => aggregateReactions(reactions, myId), [reactions, myId]);

  // Seeded lazily so reactions already present on mount (e.g. right after a
  // page reload) render statically — only emoji that appear or change count
  // *after* mount get a pop animation.
  const prevCountsRef = useRef<Map<string, number> | null>(null);
  if (prevCountsRef.current === null) {
    prevCountsRef.current = new Map(aggregated.map((r) => [r.emoji, r.count]));
  }

  const modes = useMemo(() => {
    const prev = prevCountsRef.current!;
    const m = new Map<string, ReactionPopMode>();
    for (const r of aggregated) {
      const prevCount = prev.get(r.emoji);
      if (prevCount === undefined) m.set(r.emoji, "full");
      else if (prevCount !== r.count) m.set(r.emoji, "change");
      else m.set(r.emoji, null);
    }
    return m;
  }, [aggregated]);

  useEffect(() => {
    prevCountsRef.current = new Map(aggregated.map((r) => [r.emoji, r.count]));
  }, [aggregated]);

  if (aggregated.length === 0) return null;

  return (
    <div className={cn("mt-1.5 flex flex-wrap gap-1", className)}>
      <AnimatePresence initial={false}>
        {aggregated.map((r) => (
          <ReactionPill
            key={r.emoji}
            emoji={r.emoji}
            count={r.count}
            reacted={r.reacted}
            mode={modes.get(r.emoji) ?? null}
            onToggle={() => onToggle(r.emoji)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

const LONG_PRESS_MS = 380;

// Press-and-hold detector shared by mouse and touch. A short click still
// fires the browser's native click event afterward, so callers must check
// `wasLongPress()` inside their onClick and swallow it when true.
function useLongPress(onLongPress: () => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);

  const start = () => {
    firedRef.current = false;
    timerRef.current = setTimeout(() => {
      firedRef.current = true;
      onLongPress();
    }, LONG_PRESS_MS);
  };
  const cancel = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  };
  const consumeIfFired = () => {
    const fired = firedRef.current;
    firedRef.current = false;
    return fired;
  };

  return {
    onMouseDown: start,
    onMouseUp: cancel,
    onMouseLeave: cancel,
    onTouchStart: start,
    onTouchEnd: cancel,
    consumeIfFired,
  };
}

function ReactionPill({
  emoji,
  count,
  reacted,
  mode,
  onToggle,
}: {
  emoji: string;
  count: number;
  reacted: boolean;
  mode: ReactionPopMode;
  onToggle: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const variant = getReactionVariant(emoji);
  const [burst, setBurst] = useState(false);
  const [superBurst, setSuperBurst] = useState(false);

  useEffect(() => {
    if (mode !== "full" || reduceMotion) return;
    setBurst(true);
    const t = setTimeout(() => setBurst(false), 650);
    return () => clearTimeout(t);
  }, [mode, reduceMotion]);

  const triggerSuper = () => {
    if (reduceMotion) return;
    setSuperBurst(true);
  };
  const longPress = useLongPress(triggerSuper);

  const name = entryName(emoji);

  return (
    <motion.button
      type="button"
      layout
      onMouseDown={longPress.onMouseDown}
      onMouseUp={longPress.onMouseUp}
      onMouseLeave={longPress.onMouseLeave}
      onTouchStart={longPress.onTouchStart}
      onTouchEnd={longPress.onTouchEnd}
      onClick={() => {
        // A held press already celebrated with the super burst — don't also
        // toggle the reaction off on release.
        if (longPress.consumeIfFired()) return;
        onToggle();
      }}
      aria-pressed={reacted}
      aria-label={`Reagir com ${name}, ${count} ${count === 1 ? "pessoa reagiu" : "pessoas reagiram"}. Segure para uma reação especial.`}
      title="Segure para uma reação especial"
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.5, transition: { duration: 0.15 } }}
      className={cn(
        "relative text-xs flex items-center gap-1 px-2 py-0.5 rounded-full border transition cursor-pointer",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        reacted
          ? "bg-primary/15 border-primary/50 text-primary"
          : "bg-secondary border-border hover:border-primary/40",
      )}
    >
      {!reduceMotion && mode === "full" && (
        <motion.span
          aria-hidden
          initial={{ opacity: 0.9, scale: 0.6 }}
          animate={{ opacity: 0, scale: 2.2 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{ backgroundColor: "var(--primary)" }}
        />
      )}
      <motion.span
        className="inline-block leading-none"
        initial={mode === "full" && !reduceMotion ? { scale: 0, rotate: 0 } : false}
        animate={
          reduceMotion
            ? {}
            : mode === "full"
              ? { scale: [0, 1.25, 1], rotate: [0, -8, 8, 0] }
              : mode === "change"
                ? { scale: [1, 1.2, 1] }
                : {}
        }
        transition={
          mode === "full"
            ? { duration: 0.5, times: [0, 0.55, 1], ease: "easeOut" }
            : { duration: 0.28, ease: "easeOut" }
        }
      >
        {emoji}
      </motion.span>
      <span className="font-semibold tabular-nums">{count}</span>
      <AnimatePresence>
        {burst && <ParticleBurst glyphs={variant.particles} count={variant.particleCount} />}
      </AnimatePresence>
      <AnimatePresence>
        {superBurst && (
          <SuperReactionBurst emoji={emoji} variant={variant} onDone={() => setSuperBurst(false)} />
        )}
      </AnimatePresence>
    </motion.button>
  );
}

function SuperReactionBurst({
  emoji,
  variant,
  onDone,
}: {
  emoji: string;
  variant: ReactionAnimationVariant;
  onDone: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onDone, 1000);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <motion.div
      aria-hidden
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute left-1/2 bottom-full -translate-x-1/2 mb-2 pointer-events-none z-20"
    >
      <motion.span
        className="absolute left-1/2 top-1/2 rounded-full"
        style={{
          backgroundColor: "var(--primary)",
          width: 12,
          height: 12,
          marginLeft: -6,
          marginTop: -6,
        }}
        initial={{ opacity: 0.55, scale: 1 }}
        animate={{ opacity: 0, scale: 6 }}
        transition={{ duration: 0.85, ease: "easeOut" }}
      />
      <motion.span
        className="block text-4xl leading-none select-none"
        initial={{ scale: 0, rotate: 0, y: 0 }}
        animate={{ scale: [0, 1.6, 1.25], rotate: [0, -10, 10, -4, 0], y: [0, -10, 0] }}
        transition={{ duration: 0.7, times: [0, 0.5, 1], ease: "easeOut" }}
      >
        {emoji}
      </motion.span>
      <ParticleBurst
        glyphs={variant.particles}
        count={variant.particleCount * 3}
        spread={2.6}
        size="text-sm"
      />
    </motion.div>
  );
}

function ParticleBurst({
  glyphs,
  count,
  spread = 1,
  size = "text-[9px]",
}: {
  glyphs: string[];
  count: number;
  spread?: number;
  size?: string;
}) {
  const particles = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
        const distance = (14 + Math.random() * 8) * spread;
        return {
          glyph: glyphs[i % glyphs.length],
          dx: Math.cos(angle) * distance,
          dy: Math.sin(angle) * distance,
          delay: Math.random() * 0.05,
        };
      }),
    [glyphs, count, spread],
  );

  return (
    <>
      {particles.map((p, i) => (
        <motion.span
          key={i}
          aria-hidden
          initial={{ opacity: 0, x: 0, y: 0, scale: 0.4 }}
          animate={{ opacity: [0, 1, 0], x: p.dx, y: p.dy, scale: [0.4, 1, 0.6] }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, delay: p.delay, ease: "easeOut" }}
          className={cn(
            "absolute left-1/2 top-1/2 text-primary pointer-events-none select-none",
            size,
          )}
        >
          {p.glyph}
        </motion.span>
      ))}
    </>
  );
}

function entryName(emoji: string): string {
  return findEmojiEntry(emoji).name;
}
