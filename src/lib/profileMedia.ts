export type BannerPosition = "top" | "center" | "bottom";

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const BANNER_MAX_BYTES = 10 * 1024 * 1024;

const AVATAR_MIME_TO_EXT: Record<string, string[]> = {
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
  "image/gif": ["gif"],
};

const BANNER_MIME_TO_EXT: Record<string, string[]> = {
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
  "image/gif": ["gif"],
};

export const AVATAR_ACCEPT = Object.keys(AVATAR_MIME_TO_EXT).join(",");
export const BANNER_ACCEPT = Object.keys(BANNER_MIME_TO_EXT).join(",");

function extensionOf(filename: string): string {
  return filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
}

// Checked against both the browser-reported MIME type and the filename
// extension — a mismatch (e.g. a renamed .svg or .exe) is rejected even if
// one of the two looks fine on its own. Storage bucket MIME allowlists back
// this up server-side.
function validateImage(
  file: File,
  maxBytes: number,
  mimeToExt: Record<string, string[]>,
): { ok: true } | { ok: false; error: string } {
  if (file.size > maxBytes) {
    return {
      ok: false,
      error: `Arquivo muito grande (máx. ${Math.round(maxBytes / (1024 * 1024))}MB).`,
    };
  }
  const allowedExts = mimeToExt[file.type];
  if (!allowedExts) {
    return { ok: false, error: "Formato não suportado." };
  }
  if (!allowedExts.includes(extensionOf(file.name))) {
    return { ok: false, error: "A extensão do arquivo não corresponde ao seu tipo." };
  }
  return { ok: true };
}

export function validateAvatarFile(file: File) {
  return validateImage(file, AVATAR_MAX_BYTES, AVATAR_MIME_TO_EXT);
}

export function validateBannerFile(file: File) {
  return validateImage(file, BANNER_MAX_BYTES, BANNER_MIME_TO_EXT);
}

export const OBJECT_POSITION: Record<BannerPosition, string> = {
  top: "center top",
  center: "center center",
  bottom: "center bottom",
};

export type BannerPreset = { id: string; label: string; emoji: string; gradient: string };

// Predefined banners are CSS gradients, not stock photos — no external image
// host to depend on, and they stay on-brand with Dexy's teal/petrol palette.
// Selecting one stores "preset:<id>" in profiles.banner_url; resolveBanner()
// below turns that back into the gradient at render time.
export const BANNER_PRESETS: BannerPreset[] = [
  {
    id: "space",
    label: "Espaço",
    emoji: "🌌",
    gradient:
      "radial-gradient(1.5px 1.5px at 20% 30%, oklch(1 0 0 / 0.8), transparent 60%), radial-gradient(1px 1px at 60% 15%, oklch(1 0 0 / 0.6), transparent 60%), radial-gradient(1.2px 1.2px at 80% 55%, oklch(1 0 0 / 0.7), transparent 60%), radial-gradient(1px 1px at 35% 70%, oklch(1 0 0 / 0.5), transparent 60%), linear-gradient(160deg, oklch(0.22 0.09 300) 0%, oklch(0.13 0.05 260) 60%, oklch(0.08 0.02 250) 100%)",
  },
  {
    id: "night",
    label: "Noite",
    emoji: "🌙",
    gradient:
      "linear-gradient(160deg, oklch(0.28 0.06 265) 0%, oklch(0.14 0.03 255) 55%, oklch(0.07 0.015 250) 100%)",
  },
  {
    id: "mountains",
    label: "Montanhas",
    emoji: "🏔️",
    gradient:
      "linear-gradient(180deg, oklch(0.55 0.09 255) 0%, oklch(0.4 0.1 230) 35%, oklch(0.25 0.06 210) 65%, oklch(0.12 0.03 220) 100%)",
  },
  {
    id: "ocean",
    label: "Oceano",
    emoji: "🌊",
    gradient:
      "linear-gradient(160deg, oklch(0.6 0.13 200) 0%, oklch(0.4 0.12 200) 45%, oklch(0.18 0.06 220) 100%)",
  },
  {
    id: "city",
    label: "Cidade",
    emoji: "🌃",
    gradient:
      "linear-gradient(160deg, oklch(0.5 0.14 320) 0%, oklch(0.32 0.12 280) 40%, oklch(0.16 0.06 260) 75%, oklch(0.08 0.02 250) 100%)",
  },
  {
    id: "forest",
    label: "Floresta",
    emoji: "🌲",
    gradient:
      "linear-gradient(160deg, oklch(0.45 0.1 150) 0%, oklch(0.28 0.07 155) 50%, oklch(0.1 0.03 160) 100%)",
  },
];

const PRESET_PREFIX = "preset:";

export function toPresetRef(presetId: string): string {
  return `${PRESET_PREFIX}${presetId}`;
}

export function isPresetBanner(bannerUrl: string | null | undefined): boolean {
  return !!bannerUrl && bannerUrl.startsWith(PRESET_PREFIX);
}

export function presetById(bannerUrl: string | null | undefined): BannerPreset | undefined {
  if (!isPresetBanner(bannerUrl)) return undefined;
  const id = bannerUrl!.slice(PRESET_PREFIX.length);
  return BANNER_PRESETS.find((p) => p.id === id);
}

export type ThemeColor = { id: string; label: string; color: string };

// Sentinel stored in profiles.accent_color when the user picks the
// "Gradiente" swatch instead of a flat color — resolved back to the brand
// gradient (var(--gradient-dexy)) at render time, see themeColorStyle().
export const GRADIENT_THEME = "gradient";

export function isGradientTheme(color: string | null | undefined): boolean {
  return color === GRADIENT_THEME;
}

// A background-* style for whatever the user picked as their profile theme —
// a flat color everywhere, or the brand gradient for the "Gradiente" option.
export function themeColorStyle(color: string): {
  backgroundColor?: string;
  backgroundImage?: string;
} {
  return isGradientTheme(color)
    ? { backgroundImage: "var(--gradient-dexy)" }
    : { backgroundColor: color };
}

// "Tema do perfil" — a small accent used for a handful of profile-facing
// details (avatar ring, selection indicators, the preview card's border
// tint). Distinct from the app's own theme and from the banner's flat-color
// option below: this never repaints the whole profile.
export const THEME_COLORS: ThemeColor[] = [
  { id: "teal", label: "Ciano", color: "#24D5C4" },
  { id: "blue", label: "Azul", color: "#4C8DFF" },
  { id: "purple", label: "Roxo", color: "#8B5CF6" },
  { id: "pink", label: "Rosa", color: "#F472B6" },
  { id: "orange", label: "Laranja", color: "#FB923C" },
  { id: "yellow", label: "Amarelo", color: "#FACC15" },
  { id: "green", label: "Verde", color: "#34D399" },
  { id: "gradient", label: "Gradiente", color: GRADIENT_THEME },
];

export const DEFAULT_THEME_COLOR = THEME_COLORS[0].color;

// Flat-color swatches for the banner's "Escolher cor" picker — the same
// palette as the theme colors, minus the "Gradiente" entry (a banner needs
// an actual flat color to composite the darkness overlay on top of).
export const BANNER_COLOR_SWATCHES = THEME_COLORS.filter((t) => !isGradientTheme(t.color)).map(
  (t) => t.color,
);

// Resolves whatever is stored on the profile (a real Storage URL, a
// "preset:<id>" sentinel, a flat banner color, or nothing) into the CSS the
// banner should render. Priority: uploaded/preset image, then flat color,
// then caller's own default (e.g. the brand gradient).
export function resolveBannerBackground(
  bannerUrl: string | null | undefined,
  bannerColor?: string | null,
): { backgroundImage?: string; backgroundColor?: string } {
  const preset = presetById(bannerUrl);
  if (preset) return { backgroundImage: preset.gradient };
  if (bannerUrl) return { backgroundImage: `url(${bannerUrl})` };
  if (bannerColor) return { backgroundColor: bannerColor };
  return {};
}
