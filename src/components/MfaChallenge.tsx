import { useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Loader2, ShieldCheck } from "lucide-react";
import { challengeAndVerify } from "@/lib/mfa";

/** Shared "enter your 6-digit authenticator code" step-up form — used
 * wherever a session needs to go from AAL1 to AAL2 (post-login, and on the
 * password-recovery page, since a recovery session is AAL1 too). Each
 * submit runs a brand new challenge, so a wrong code just lets the user
 * retry without a stale/consumed challengeId. */
export function MfaChallengeForm({
  factorId,
  onVerified,
  onCancel,
  cancelLabel = "Cancelar",
  title = "Verificação em duas etapas",
  description = "Digite o código de 6 dígitos do seu aplicativo autenticador.",
}: {
  factorId: string;
  onVerified: () => void;
  onCancel?: () => void;
  cancelLabel?: string;
  title?: string;
  description?: string;
}) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (code.trim().length !== 6) {
      setError("Informe os 6 dígitos do código.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await challengeAndVerify(factorId, code.trim());
      onVerified();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Código inválido. Tente de novo.");
      setCode("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex flex-col items-center text-center gap-2 mb-2">
        <div className="w-11 h-11 rounded-full bg-primary/10 text-primary flex items-center justify-center">
          <ShieldCheck className="w-5 h-5" />
        </div>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      <input
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        placeholder="000000"
        className="w-full text-center tracking-[0.5em] text-lg bg-secondary border border-border focus:border-primary rounded-xl py-3 px-4 outline-none transition-colors"
      />

      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="text-sm text-destructive"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      <button
        type="submit"
        disabled={loading || code.length !== 6}
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl py-3 font-semibold text-primary-foreground disabled:opacity-40 transition hover:brightness-110"
        style={{ backgroundImage: "var(--gradient-dexy)" }}
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
        Confirmar
      </button>

      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="w-full text-sm text-muted-foreground hover:text-foreground transition"
        >
          {cancelLabel}
        </button>
      )}
    </form>
  );
}
