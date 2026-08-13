import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Camera,
  Eye,
  ImageIcon,
  Loader2,
  Palette,
  Plus,
  RotateCcw,
  Sun,
  Trash2,
  Upload,
  X,
  AlertTriangle,
} from "lucide-react";
import { MfaSetup } from "./MfaSetup";
import { avatarFor, statusColor, statusLabel, type UserStatus } from "@/lib/format";
import {
  AVATAR_ACCEPT,
  BANNER_ACCEPT,
  BANNER_COLOR_SWATCHES,
  BANNER_PRESETS,
  DEFAULT_THEME_COLOR,
  OBJECT_POSITION,
  THEME_COLORS,
  isGradientTheme,
  isPresetBanner,
  presetById,
  resolveBannerBackground,
  themeColorStyle,
  toPresetRef,
  validateAvatarFile,
  validateBannerFile,
  type BannerPosition,
} from "@/lib/profileMedia";
import { supabase } from "@/lib/supabase";
import { markGuestSignedOut } from "@/lib/guestDevice";
import { deleteProfileImage, uploadProfileImage, useProfileStats } from "@/lib/queries";
import type { Database } from "@/lib/database.types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

type ProfilePatch = Partial<
  Pick<
    Profile,
    | "name"
    | "bio"
    | "status"
    | "avatar_url"
    | "banner_url"
    | "banner_position"
    | "banner_overlay"
    | "banner_color"
    | "accent_color"
  >
>;

type PendingAvatar =
  { kind: "unchanged" } | { kind: "file"; file: File; previewUrl: string } | { kind: "removed" };

type PendingBanner =
  | { kind: "unchanged" }
  | { kind: "file"; file: File; previewUrl: string }
  | { kind: "preset"; id: string }
  | { kind: "color"; color: string }
  | { kind: "removed" };

const NAME_MAX = 32;
const BIO_MAX = 120;

export function ProfileEditor({
  profile,
  userId,
  onSave,
  onSignOut,
  onClose,
}: {
  profile: Profile;
  userId: string;
  onSave: (patch: ProfilePatch) => Promise<void>;
  onSignOut: () => void;
  onClose: () => void;
}) {
  const { data: stats } = useProfileStats(profile.id);
  const previewRef = useRef<HTMLDivElement>(null);

  const [name, setName] = useState(profile.name);
  const [bio, setBio] = useState(profile.bio);
  const [status, setStatus] = useState<UserStatus>(profile.status as UserStatus);
  const [position, setPosition] = useState<BannerPosition>(
    (profile.banner_position as BannerPosition) || "center",
  );
  const [overlay, setOverlay] = useState(profile.banner_overlay ?? 0);
  const [themeColor, setThemeColor] = useState(profile.accent_color || DEFAULT_THEME_COLOR);

  const [pendingAvatar, setPendingAvatar] = useState<PendingAvatar>({ kind: "unchanged" });

  // Delete account state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pendingBanner, setPendingBanner] = useState<PendingBanner>({ kind: "unchanged" });
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [showPresets, setShowPresets] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showThemeCustom, setShowThemeCustom] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (pendingAvatar.kind === "file") URL.revokeObjectURL(pendingAvatar.previewUrl);
      if (pendingBanner.kind === "file") URL.revokeObjectURL(pendingBanner.previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty =
    name !== profile.name ||
    bio !== profile.bio ||
    status !== profile.status ||
    position !== profile.banner_position ||
    overlay !== profile.banner_overlay ||
    themeColor !== (profile.accent_color || DEFAULT_THEME_COLOR) ||
    pendingAvatar.kind !== "unchanged" ||
    pendingBanner.kind !== "unchanged";

  const avatarDisplaySrc = avatarFor({
    id: profile.id,
    avatar_url:
      pendingAvatar.kind === "file"
        ? pendingAvatar.previewUrl
        : pendingAvatar.kind === "removed"
          ? null
          : profile.avatar_url,
  });
  const hasAvatarToRemove =
    pendingAvatar.kind === "file" || (pendingAvatar.kind === "unchanged" && !!profile.avatar_url);
  const avatarUploading = saving && pendingAvatar.kind === "file";

  const bannerStyle: CSSProperties =
    pendingBanner.kind === "file"
      ? { backgroundImage: `url(${pendingBanner.previewUrl})` }
      : pendingBanner.kind === "preset"
        ? { backgroundImage: BANNER_PRESETS.find((p) => p.id === pendingBanner.id)!.gradient }
        : pendingBanner.kind === "color"
          ? { backgroundColor: pendingBanner.color }
          : pendingBanner.kind === "removed"
            ? {}
            : resolveBannerBackground(profile.banner_url, profile.banner_color);
  const hasBannerImage =
    pendingBanner.kind !== "removed" &&
    (pendingBanner.kind !== "unchanged" || !!profile.banner_url || !!profile.banner_color);
  const hasBannerToRemove =
    pendingBanner.kind === "file" ||
    pendingBanner.kind === "preset" ||
    pendingBanner.kind === "color" ||
    (pendingBanner.kind === "unchanged" && (!!profile.banner_url || !!profile.banner_color));
  const bannerUploading = saving && pendingBanner.kind === "file";

  const selectedPresetId =
    pendingBanner.kind === "preset"
      ? pendingBanner.id
      : pendingBanner.kind === "unchanged"
        ? presetById(profile.banner_url)?.id
        : undefined;

  const handlePickAvatar = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const result = validateAvatarFile(file);
    if (!result.ok) {
      setAvatarError(result.error);
      return;
    }
    setAvatarError(null);
    if (pendingAvatar.kind === "file") URL.revokeObjectURL(pendingAvatar.previewUrl);
    setPendingAvatar({ kind: "file", file, previewUrl: URL.createObjectURL(file) });
  };

  const removeAvatar = () => {
    if (pendingAvatar.kind === "file") URL.revokeObjectURL(pendingAvatar.previewUrl);
    setPendingAvatar({ kind: "removed" });
    setAvatarError(null);
  };

  const handlePickBanner = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const result = validateBannerFile(file);
    if (!result.ok) {
      setBannerError(result.error);
      return;
    }
    setBannerError(null);
    if (pendingBanner.kind === "file") URL.revokeObjectURL(pendingBanner.previewUrl);
    setPendingBanner({ kind: "file", file, previewUrl: URL.createObjectURL(file) });
    setShowPresets(false);
    setShowColorPicker(false);
  };

  const pickPreset = (id: string) => {
    if (pendingBanner.kind === "file") URL.revokeObjectURL(pendingBanner.previewUrl);
    setPendingBanner({ kind: "preset", id });
    setBannerError(null);
    setShowPresets(false);
    setShowColorPicker(false);
  };

  const pickBannerColor = (color: string) => {
    if (pendingBanner.kind === "file") URL.revokeObjectURL(pendingBanner.previewUrl);
    setPendingBanner({ kind: "color", color });
    setBannerError(null);
  };

  const removeBanner = () => {
    if (pendingBanner.kind === "file") URL.revokeObjectURL(pendingBanner.previewUrl);
    setPendingBanner({ kind: "removed" });
    setBannerError(null);
    setShowPresets(false);
    setShowColorPicker(false);
  };

  const resetAll = () => {
    setName(profile.name);
    setBio(profile.bio);
    setStatus(profile.status as UserStatus);
    setPosition((profile.banner_position as BannerPosition) || "center");
    setOverlay(profile.banner_overlay ?? 0);
    setThemeColor(profile.accent_color || DEFAULT_THEME_COLOR);
    if (pendingAvatar.kind === "file") URL.revokeObjectURL(pendingAvatar.previewUrl);
    setPendingAvatar({ kind: "unchanged" });
    if (pendingBanner.kind === "file") URL.revokeObjectURL(pendingBanner.previewUrl);
    setPendingBanner({ kind: "unchanged" });
    setAvatarError(null);
    setBannerError(null);
    setShowPresets(false);
    setShowColorPicker(false);
    setShowThemeCustom(false);
    setSaveError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const patch: ProfilePatch = {
        name,
        bio,
        status,
        banner_position: position,
        banner_overlay: overlay,
        accent_color: themeColor,
      };
      const prevBannerWasCustom = !isPresetBanner(profile.banner_url);

      if (pendingAvatar.kind === "file") {
        patch.avatar_url = await uploadProfileImage(userId, pendingAvatar.file, "avatar");
        await deleteProfileImage("avatar", profile.avatar_url);
      } else if (pendingAvatar.kind === "removed") {
        patch.avatar_url = null;
        await deleteProfileImage("avatar", profile.avatar_url);
      }

      if (pendingBanner.kind === "file") {
        patch.banner_url = await uploadProfileImage(userId, pendingBanner.file, "banner");
        patch.banner_color = null;
        if (prevBannerWasCustom) await deleteProfileImage("banner", profile.banner_url);
      } else if (pendingBanner.kind === "preset") {
        patch.banner_url = toPresetRef(pendingBanner.id);
        patch.banner_color = null;
        if (prevBannerWasCustom) await deleteProfileImage("banner", profile.banner_url);
      } else if (pendingBanner.kind === "color") {
        patch.banner_url = null;
        patch.banner_color = pendingBanner.color;
        if (prevBannerWasCustom) await deleteProfileImage("banner", profile.banner_url);
      } else if (pendingBanner.kind === "removed") {
        patch.banner_url = null;
        patch.banner_color = null;
        if (prevBannerWasCustom) await deleteProfileImage("banner", profile.banner_url);
      }

      await onSave(patch);
      setPendingAvatar({ kind: "unchanged" });
      setPendingBanner({ kind: "unchanged" });
    } catch (err) {
      const detail = err instanceof Error ? err.message : undefined;
      setSaveError(
        detail
          ? `Não foi possível salvar: ${detail}`
          : "Não foi possível salvar as alterações. Tente novamente.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="flex-1 flex flex-col min-h-0 overflow-hidden"
    >
      <div className="h-14 shrink-0 flex items-center gap-1 px-4 sm:px-6 border-b border-border/60">
        <button
          onClick={onClose}
          className="p-2 rounded-full hover:bg-secondary text-muted-foreground transition"
          aria-label="Voltar"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h2 className="font-semibold ml-1">Editar perfil</h2>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() =>
              previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
            className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary transition"
          >
            <Eye className="w-3.5 h-3.5" />
            Ver perfil público
          </button>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-secondary text-muted-foreground transition"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-y-auto lg:overflow-hidden">
        {/* Settings — ~45% on desktop, scrolls independently */}
        <div className="lg:w-[45%] lg:h-full lg:overflow-y-auto px-6 sm:px-10 py-8">
          <SectionLabel>Personalização</SectionLabel>
          <div className="mt-4 space-y-6">
            <Field label="Foto de perfil">
              <div className="flex items-start gap-3">
                <div className="relative shrink-0">
                  <img
                    src={avatarDisplaySrc}
                    alt=""
                    className="w-20 h-20 rounded-full object-cover bg-card border border-border"
                  />
                  {avatarUploading && (
                    <div className="absolute inset-0 rounded-full bg-black/55 grid place-items-center">
                      <Loader2 className="w-5 h-5 text-white animate-spin" />
                    </div>
                  )}
                </div>
                <label className="flex-1 min-w-0 max-w-[168px] h-20 rounded-xl border border-dashed border-border hover:border-primary/50 hover:bg-secondary/40 transition cursor-pointer flex flex-col items-center justify-center gap-1 text-center px-2">
                  <Upload className="w-4 h-4 text-muted-foreground" />
                  <span className="text-xs font-medium">Alterar foto</span>
                  <span className="text-[10px] text-muted-foreground/70 leading-tight">
                    PNG, JPG, WebP ou GIF · 5MB
                  </span>
                  <input
                    type="file"
                    accept={AVATAR_ACCEPT}
                    className="hidden"
                    onChange={handlePickAvatar}
                  />
                </label>
                {hasAvatarToRemove && (
                  <button
                    onClick={removeAvatar}
                    className="shrink-0 w-20 h-20 rounded-xl border border-dashed border-destructive/30 hover:border-destructive/60 hover:bg-destructive/5 transition flex flex-col items-center justify-center gap-1 text-destructive"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span className="text-xs font-medium">Remover</span>
                  </button>
                )}
              </div>
              {avatarError && <p className="text-xs text-destructive mt-1.5">{avatarError}</p>}
            </Field>

            <Field label="Plano de fundo do perfil">
              <div
                className="relative h-36 sm:h-44 rounded-xl overflow-hidden border border-border"
                style={{
                  ...bannerStyle,
                  backgroundSize: "cover",
                  backgroundPosition: OBJECT_POSITION[position],
                }}
              >
                {!hasBannerImage && (
                  <div
                    className="absolute inset-0"
                    style={{ backgroundImage: "var(--gradient-dexy)" }}
                  />
                )}
                {overlay > 0 && (
                  <div className="absolute inset-0 bg-black" style={{ opacity: overlay / 100 }} />
                )}
                {bannerUploading && (
                  <div className="absolute inset-0 bg-black/55 grid place-items-center">
                    <Loader2 className="w-6 h-6 text-white animate-spin" />
                  </div>
                )}
                <label className="absolute inset-0 flex items-center justify-center cursor-pointer group">
                  <div className="flex flex-col items-center gap-1 px-5 py-4 rounded-xl bg-black/45 group-hover:bg-black/60 border border-white/10 transition">
                    <Upload className="w-4 h-4 text-white" />
                    <span className="text-xs font-medium text-white">Alterar plano de fundo</span>
                    <span className="text-[10px] text-white/70">PNG, JPG, WebP ou GIF · 10MB</span>
                  </div>
                  <input
                    type="file"
                    accept={BANNER_ACCEPT}
                    className="hidden"
                    onChange={handlePickBanner}
                  />
                </label>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <label className="cursor-pointer inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-secondary transition">
                  <ImageIcon className="w-3.5 h-3.5" />
                  Alterar fundo
                  <input
                    type="file"
                    accept={BANNER_ACCEPT}
                    className="hidden"
                    onChange={handlePickBanner}
                  />
                </label>
                <button
                  onClick={() => {
                    setShowPresets((v) => !v);
                    setShowColorPicker(false);
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition ${showPresets ? "border-primary text-primary" : "border-border hover:bg-secondary"}`}
                >
                  Escolher fundos
                </button>
                <button
                  onClick={() => {
                    setShowColorPicker((v) => !v);
                    setShowPresets(false);
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition ${showColorPicker ? "border-primary text-primary" : "border-border hover:bg-secondary"}`}
                >
                  <Palette className="w-3.5 h-3.5" />
                  Escolher cor
                </button>
                {hasBannerToRemove && (
                  <button
                    onClick={removeBanner}
                    className="text-sm text-muted-foreground hover:text-destructive transition px-1"
                  >
                    Remover fundo
                  </button>
                )}
              </div>
              {bannerError && <p className="text-xs text-destructive mt-1.5">{bannerError}</p>}

              {showPresets && (
                <div className="mt-2.5 grid grid-cols-3 gap-2">
                  {BANNER_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => pickPreset(p.id)}
                      className={`h-14 rounded-lg border-2 relative overflow-hidden text-left transition ${
                        selectedPresetId === p.id
                          ? "border-primary"
                          : "border-transparent hover:border-border"
                      }`}
                      style={{ backgroundImage: p.gradient, backgroundSize: "cover" }}
                    >
                      <span className="absolute bottom-1 left-2 text-[11px] font-medium text-white drop-shadow">
                        {p.emoji} {p.label}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {showColorPicker && (
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  {BANNER_COLOR_SWATCHES.map((c) => (
                    <button
                      key={c}
                      onClick={() => pickBannerColor(c)}
                      aria-label={`Usar cor ${c}`}
                      className="w-7 h-7 rounded-full transition"
                      style={{
                        backgroundColor: c,
                        boxShadow:
                          pendingBanner.kind === "color" && pendingBanner.color === c
                            ? `0 0 0 2px var(--background), 0 0 0 4px ${c}`
                            : undefined,
                      }}
                    />
                  ))}
                  <input
                    type="color"
                    value={pendingBanner.kind === "color" ? pendingBanner.color : "#24d5c4"}
                    onChange={(e) => pickBannerColor(e.target.value)}
                    className="w-7 h-7 rounded cursor-pointer bg-transparent border border-border"
                    title="Cor personalizada"
                  />
                </div>
              )}
            </Field>

            <Field label="Posição do fundo">
              <div className="flex gap-1.5">
                {(
                  [
                    ["top", "Superior"],
                    ["center", "Centro"],
                    ["bottom", "Inferior"],
                  ] as const
                ).map(([p, label]) => (
                  <button
                    key={p}
                    onClick={() => setPosition(p)}
                    className={`px-3 py-1.5 rounded-lg text-sm border transition ${
                      position === p
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-secondary text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Escurecimento do fundo">
              <DarknessSlider value={overlay} onChange={setOverlay} themeColor={themeColor} />
            </Field>

            <Field label="Tema do perfil">
              <p className="text-xs text-muted-foreground/70 mb-2">
                Escolha uma cor para destacar seu perfil em todo o Dexy.
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                {THEME_COLORS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setThemeColor(t.color);
                      setShowThemeCustom(false);
                    }}
                    title={t.label}
                    aria-label={t.label}
                    className="w-6 h-6 rounded-full transition"
                    style={{
                      ...themeColorStyle(t.color),
                      boxShadow:
                        themeColor === t.color
                          ? `0 0 0 2px var(--background), 0 0 0 4px ${isGradientTheme(t.color) ? "var(--primary)" : t.color}`
                          : undefined,
                    }}
                  />
                ))}
                <button
                  onClick={() => setShowThemeCustom((v) => !v)}
                  aria-label="Cor personalizada"
                  title="Cor personalizada"
                  className={`w-6 h-6 rounded-full border border-dashed flex items-center justify-center transition ${
                    showThemeCustom
                      ? "border-primary text-primary"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
              {showThemeCustom && (
                <input
                  type="color"
                  value={isGradientTheme(themeColor) ? "#24d5c4" : themeColor}
                  onChange={(e) => setThemeColor(e.target.value)}
                  className="mt-2 w-8 h-8 rounded cursor-pointer bg-transparent border border-border"
                  title="Cor personalizada"
                />
              )}
            </Field>
          </div>

          <SectionLabel className="mt-8">Informações</SectionLabel>
          <div className="mt-4 space-y-5">
            <Field label="Nome de exibição" trailing={`${name.length}/${NAME_MAX}`}>
              <input
                value={name}
                maxLength={NAME_MAX}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </Field>
            <Field label="Status">
              <p className="text-xs text-muted-foreground/70 mb-2">
                Defina como você quer aparecer para os outros.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(["online", "idle", "dnd", "offline"] as UserStatus[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatus(s)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-sm transition ${
                      status === s
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-secondary text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${statusColor[s]}`} />
                    {statusLabel[s]}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Biografia" trailing={`${bio.length}/${BIO_MAX}`}>
              <textarea
                value={bio}
                maxLength={BIO_MAX}
                onChange={(e) => setBio(e.target.value)}
                rows={3}
                className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary resize-none"
              />
            </Field>
          </div>

          <SectionLabel className="mt-8">Segurança</SectionLabel>
          <div className="mt-4">
            <MfaSetup />
          </div>

          {saveError && <p className="text-sm text-destructive mt-5">{saveError}</p>}
          <div className="mt-6 flex items-center gap-2 flex-wrap">
            <button
              onClick={() => void handleSave()}
              disabled={!dirty || saving}
              className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40 transition hover:brightness-110"
              style={{ backgroundImage: "var(--gradient-dexy)" }}
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Salvar alterações
            </button>
            <button
              onClick={resetAll}
              disabled={!dirty || saving}
              className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium border border-border hover:bg-secondary disabled:opacity-40 transition"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Redefinir
            </button>
            <button
              onClick={onSignOut}
              className="ml-auto text-sm text-muted-foreground hover:text-destructive transition"
            >
              Sair da conta
            </button>
            <button
              onClick={() => setShowDeleteDialog(true)}
              className="text-sm text-destructive/70 hover:text-destructive transition"
            >
              Deletar conta
            </button>
          </div>
        </div>

        {/* Live preview — ~55% on desktop, no scroll of its own, below
            settings on small screens */}
        <div
          ref={previewRef}
          className="lg:w-[55%] flex flex-col items-center justify-center px-6 sm:px-10 py-8"
        >
          <div className="w-full max-w-[420px]">
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
              Prévia do perfil público
            </h3>
            <p className="text-xs text-muted-foreground/60 mt-1">
              A prévia atualiza automaticamente conforme você altera.
            </p>

            <div className="mt-3">
              <ProfilePreviewCard
                avatarSrc={avatarDisplaySrc}
                bannerStyle={bannerStyle}
                hasBannerImage={hasBannerImage}
                position={position}
                overlay={overlay}
                name={name}
                status={status}
                bio={bio}
                themeColor={themeColor}
                stats={stats}
              />
            </div>

            <div className="mt-4">
              <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground/70 mb-1.5">
                Como os outros verão
              </h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {[
                  "Seu nome de exibição",
                  "Seu status",
                  "Sua biografia",
                  "Sua cor de destaque",
                  "Seu fundo e foto de perfil",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-4 flex items-start gap-3 rounded-xl border border-border/60 bg-secondary/40 px-4 py-2.5">
              <span className="text-sm leading-none">💡</span>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-0.5">
                  Dica
                </div>
                <p className="text-sm text-muted-foreground">
                  Use imagens com boa resolução para que seu perfil fique incrível em qualquer tela.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Delete account confirmation dialog */}
      {showDeleteDialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-card border border-border p-6 shadow-2xl mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-destructive/15 grid place-items-center">
                <AlertTriangle className="w-5 h-5 text-destructive" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-foreground">Deletar conta</h3>
                <p className="text-sm text-muted-foreground">Esta ação é irreversível.</p>
              </div>
            </div>

            <div className="space-y-3 mb-5">
              <p className="text-sm text-muted-foreground">
                Todos os seus dados serão permanentemente removidos: perfil, mensagens,
                servidores que você é dono, amizades e histórico de chamadas.
              </p>
              <p className="text-sm text-foreground font-medium">
                Digite <span className="font-mono text-destructive">DELETAR</span> para confirmar:
              </p>
              <input
                type="text"
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder="DELETAR"
                className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-destructive/50"
                autoFocus
              />
              {deleteError && (
                <p className="text-sm text-destructive">{deleteError}</p>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setShowDeleteDialog(false);
                  setDeleteConfirm("");
                  setDeleteError(null);
                }}
                disabled={deleting}
                className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium hover:bg-secondary transition disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  if (deleteConfirm !== "DELETAR") {
                    setDeleteError("Digite DELETAR para confirmar.");
                    return;
                  }
                  setDeleting(true);
                  setDeleteError(null);
                  try {
                    const { data: userData } = await supabase.auth.getUser();
                    if (userData.user?.is_anonymous) {
                      markGuestSignedOut();
                    }
                    const { error } = await supabase.rpc("delete_own_account");
                    if (error) throw error;
                    // Account deleted — redirect to login
                    await supabase.auth.signOut();
                    window.location.href = "/login";
                  } catch (err) {
                    setDeleteError(
                      err instanceof Error ? err.message : "Não foi possível deletar a conta."
                    );
                    setDeleting(false);
                  }
                }}
                disabled={deleting || deleteConfirm !== "DELETAR"}
                className="flex-1 rounded-lg bg-destructive px-4 py-2.5 text-sm font-medium text-white hover:bg-destructive/90 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleting ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Deletando...
                  </span>
                ) : (
                  "Deletar permanentemente"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h3
      className={`text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70 ${className ?? ""}`}
    >
      {children}
    </h3>
  );
}

function Field({
  label,
  trailing,
  children,
}: {
  label: string;
  trailing?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="text-xs text-muted-foreground">{label}</label>
        {trailing && <span className="text-xs text-muted-foreground tabular-nums">{trailing}</span>}
      </div>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

// Custom dotted/segmented darkness control — not a native range input, to
// match the "technological" look requested: a row of small pills fills up to
// the current value using the profile's theme color, with a knob marker.
function DarknessSlider({
  value,
  onChange,
  themeColor,
}: {
  value: number;
  onChange: (v: number) => void;
  themeColor: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const SEGMENTS = 24;
  const ratio = value / 100;
  const filled = Math.round(ratio * SEGMENTS);
  const fillStyle = themeColorStyle(themeColor);

  const updateFromClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const r = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onChange(Math.round(r * 100));
  };

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    updateFromClientX(e.clientX);
  };
  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) return;
    updateFromClientX(e.clientX);
  };

  return (
    <div className="flex items-center gap-3">
      <Sun className="w-4 h-4 text-muted-foreground shrink-0" />
      <div
        ref={trackRef}
        role="slider"
        aria-label="Escurecimento do fundo"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") onChange(Math.max(0, value - 2));
          if (e.key === "ArrowRight") onChange(Math.min(100, value + 2));
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        className="relative flex-1 h-6 flex items-center gap-[3px] cursor-pointer select-none touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
      >
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span
            key={i}
            className="flex-1 h-1 rounded-full transition-colors"
            style={i < filled ? fillStyle : { backgroundColor: "var(--border)" }}
          />
        ))}
        <span
          className="absolute top-1/2 w-3.5 h-3.5 rounded-full pointer-events-none"
          style={{
            left: `${ratio * 100}%`,
            transform: "translate(-50%, -50%)",
            border: "2px solid var(--background)",
            ...fillStyle,
          }}
        />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums w-10 text-right shrink-0">
        {value}%
      </span>
    </div>
  );
}

function ProfilePreviewCard({
  avatarSrc,
  bannerStyle,
  hasBannerImage,
  position,
  overlay,
  name,
  status,
  bio,
  themeColor,
  stats,
}: {
  avatarSrc: string;
  bannerStyle: CSSProperties;
  hasBannerImage: boolean;
  position: BannerPosition;
  overlay: number;
  name: string;
  status: UserStatus;
  bio: string;
  themeColor: string;
  stats?: { messages: number; reactions: number; friends: number; servers: number };
}) {
  const ringStyle = themeColorStyle(themeColor);
  return (
    <div
      className="rounded-2xl border bg-card shadow-xl transition-colors"
      style={{ borderColor: isGradientTheme(themeColor) ? "var(--primary)" : `${themeColor}40` }}
    >
      {/* Darkness overlay is layered strictly inside the banner box — it never
          wraps the content below, so name/status/bio/avatar stay fully legible
          no matter how high the slider goes. */}
      <div
        className="relative h-36 sm:h-40 rounded-t-2xl overflow-hidden"
        style={{
          ...bannerStyle,
          backgroundSize: "cover",
          backgroundPosition: OBJECT_POSITION[position],
        }}
      >
        {!hasBannerImage && (
          <div className="absolute inset-0" style={{ backgroundImage: "var(--gradient-dexy)" }} />
        )}
        {overlay > 0 && (
          <div className="absolute inset-0 bg-black" style={{ opacity: overlay / 100 }} />
        )}
      </div>
      <div className="px-5 pb-5">
        <div className="relative z-10 -mt-10 inline-block rounded-full p-1" style={ringStyle}>
          <img
            src={avatarSrc}
            alt=""
            className="w-20 h-20 rounded-full border-[3px] border-card object-cover bg-card"
          />
        </div>
        <div className="mt-3">
          <div className="text-lg font-bold text-foreground truncate">{name || "Sem nome"}</div>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-1">
            <span className={`w-1.5 h-1.5 rounded-full ${statusColor[status]}`} />
            {statusLabel[status]}
          </div>
          {bio && (
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap break-words">
              {bio}
            </p>
          )}

          <div className="mt-4 pt-4 border-t border-white/10 grid grid-cols-4 gap-2">
            {(
              [
                ["Mensagens", stats?.messages],
                ["Reações", stats?.reactions],
                ["Amigos", stats?.friends],
                ["Grupos", stats?.servers],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="text-center">
                <div className="text-sm font-bold text-foreground tabular-nums">{value ?? "–"}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
