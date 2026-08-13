export type ReactionAnimationVariant = {
  id: string;
  particles: string[];
  particleCount: number;
};

const DEFAULT_VARIANT: ReactionAnimationVariant = {
  id: "default",
  particles: ["✦", "✧", "✦"],
  particleCount: 5,
};

// Emoji -> animation variant. Every entry currently reuses the same
// pop/tilt/glow/particle motion (DEFAULT_VARIANT) — this map is the seam for
// giving a specific reaction its own particle glyphs/count later (e.g. a
// fire-pop with embers, a rocket-pop with a trail) without ReactionPill or
// ReactionList needing to change at all.
const REACTION_VARIANTS: Record<string, ReactionAnimationVariant> = {
  "❤️": { ...DEFAULT_VARIANT, id: "heart-pop" },
  "😂": { ...DEFAULT_VARIANT, id: "laugh-pop" },
  "🔥": { ...DEFAULT_VARIANT, id: "fire-pop" },
  "🎉": { ...DEFAULT_VARIANT, id: "celebration" },
  "🚀": { ...DEFAULT_VARIANT, id: "rocket" },
};

export function getReactionVariant(emoji: string): ReactionAnimationVariant {
  return REACTION_VARIANTS[emoji] ?? DEFAULT_VARIANT;
}
