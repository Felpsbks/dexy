import { motion } from "framer-motion";
import { ArrowRight, Loader2, User } from "lucide-react";
import { DexyLogo } from "@/components/DexyLogo";

export function DisplayNameStep({
  value,
  onChange,
  onContinue,
  onBack,
  title = "Como podemos te chamar?",
  subtitle = "Esse é o nome que outras pessoas vão ver no Dexy.",
  ctaLabel,
  loading = false,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  onContinue: () => void;
  onBack: () => void;
  title?: string;
  subtitle?: string;
  ctaLabel?: string;
  loading?: boolean;
  error?: string | null;
}) {
  const trimmed = value.trim();
  const canContinue = trimmed.length >= 2;
  const initial = trimmed.slice(0, 1).toUpperCase();

  return (
    <div className="min-h-dvh bg-[#05070d] text-white relative overflow-hidden flex flex-col items-center justify-center px-6">
      <div className="absolute inset-0 dm-starfield" />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 900px 600px at 50% 20%, oklch(0.787 0.134 184.5 / 0.16), transparent 70%)",
        }}
      />

      <div className="relative z-10 flex flex-col items-center w-full max-w-md">
        <DexyLogo size={56} />

        <motion.div
          className="mt-10 bg-[#0c101a]/80 backdrop-blur-xl border border-white/5 rounded-2xl p-5 shadow-2xl flex items-center gap-3 w-72"
          animate={{ y: [0, -10, 0] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        >
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center shrink-0 relative"
            style={{ backgroundImage: "linear-gradient(135deg, #00e5ff, #ccff00)" }}
          >
            {initial ? (
              <span className="text-lg font-bold text-black">{initial}</span>
            ) : (
              <User className="w-5 h-5 text-black" />
            )}
            <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-[#00ff9d] border-2 border-[#0c101a]" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate">
              {trimmed || <span className="text-gray-500">Seu nome</span>}
            </div>
            <div className="text-[10px] text-[#00ff9d] font-medium mt-0.5">Online</div>
          </div>
        </motion.div>

        <h1 className="mt-8 text-3xl sm:text-4xl font-bold text-center text-balance">{title}</h1>
        <p className="mt-2 text-gray-400 text-sm text-center max-w-xs">{subtitle}</p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canContinue && !loading) onContinue();
          }}
          className="mt-8 w-full relative"
        >
          <input
            autoFocus
            value={value}
            onChange={(e) => onChange(e.target.value)}
            maxLength={32}
            placeholder="Insira um nome de exibição"
            className="w-full bg-white/95 text-[#05070d] placeholder-gray-500 rounded-full py-4 pl-6 pr-16 text-base outline-none focus:ring-2 focus:ring-[#00e5ff] transition"
          />
          <button
            type="submit"
            aria-label={ctaLabel ?? "Continuar"}
            disabled={!canContinue || loading}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full flex items-center justify-center disabled:opacity-40 transition hover:scale-105 active:scale-95 disabled:hover:scale-100"
            style={{ backgroundImage: "linear-gradient(90deg, #00e5ff, #ccff00)" }}
          >
            {loading ? (
              <Loader2 className="w-5 h-5 text-black animate-spin" />
            ) : (
              <ArrowRight className="w-5 h-5 text-black" />
            )}
          </button>
        </form>

        {error && <p className="mt-3 text-sm text-red-400 text-center">{error}</p>}

        <button
          type="button"
          onClick={onBack}
          className="mt-6 text-xs text-gray-400 hover:text-white transition"
        >
          ← Voltar
        </button>
      </div>
    </div>
  );
}
