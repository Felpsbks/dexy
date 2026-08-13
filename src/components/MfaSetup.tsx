import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, ShieldCheck, ShieldOff, ShieldQuestion } from "lucide-react";
import { MfaChallengeForm } from "./MfaChallenge";
import {
  enrollTotp,
  firstVerifiedTotpFactor,
  unenrollFactor,
  useAuthenticatorAssuranceLevel,
  useInvalidateMfaQueries,
  useMfaFactors,
} from "@/lib/mfa";

type Step =
  | { kind: "idle" }
  | { kind: "enrolling"; factorId: string; qrCode: string; secret: string }
  | { kind: "disabling"; factorId: string };

export function MfaSetup() {
  const { data: factors, isLoading: factorsLoading } = useMfaFactors();
  const { data: aal } = useAuthenticatorAssuranceLevel();
  const invalidate = useInvalidateMfaQueries();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeFactor = firstVerifiedTotpFactor(factors);
  const sessionIsStepUp = aal?.currentLevel === "aal2";

  const startEnroll = async () => {
    setError(null);
    setStarting(true);
    try {
      const data = await enrollTotp();
      setStep({ kind: "enrolling", factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível iniciar a ativação.");
    } finally {
      setStarting(false);
    }
  };

  const onEnrolled = () => {
    setStep({ kind: "idle" });
    invalidate();
  };

  const startDisable = () => {
    if (!activeFactor) return;
    setError(null);
    if (sessionIsStepUp) {
      void doUnenroll(activeFactor.id);
    } else {
      setStep({ kind: "disabling", factorId: activeFactor.id });
    }
  };

  const doUnenroll = async (factorId: string) => {
    setError(null);
    setStarting(true);
    try {
      await unenrollFactor(factorId);
      setStep({ kind: "idle" });
      invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível desativar.");
    } finally {
      setStarting(false);
    }
  };

  if (factorsLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando…
      </div>
    );
  }

  if (step.kind === "enrolling") {
    return (
      <div className="rounded-xl border border-border bg-secondary/40 p-4">
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-muted-foreground">
            Escaneie o QR code com seu aplicativo autenticador (Google Authenticator, Authy, 1Password…)
            ou digite o código manualmente.
          </p>
          {/* qr_code is an SVG data URI returned directly by Supabase Auth — not user content. */}
          <img
            src={step.qrCode}
            alt="QR code para configurar o autenticador"
            className="w-40 h-40 bg-white rounded-lg p-2"
          />
          <code className="text-xs bg-secondary px-2 py-1 rounded select-all break-all">{step.secret}</code>
        </div>
        <div className="mt-4">
          <MfaChallengeForm
            factorId={step.factorId}
            onVerified={onEnrolled}
            onCancel={() => setStep({ kind: "idle" })}
            title="Confirme a ativação"
            description="Digite o código gerado pelo app pra confirmar."
          />
        </div>
      </div>
    );
  }

  if (step.kind === "disabling") {
    return (
      <div className="rounded-xl border border-border bg-secondary/40 p-4">
        <MfaChallengeForm
          factorId={step.factorId}
          onVerified={() => void doUnenroll(step.factorId)}
          onCancel={() => setStep({ kind: "idle" })}
          title="Confirme a desativação"
          description="Por segurança, informe o código do autenticador antes de desativar."
        />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-secondary/40 p-4">
      <div className="flex items-start gap-3">
        <div
          className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center ${
            activeFactor ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
          }`}
        >
          {activeFactor ? <ShieldCheck className="w-4.5 h-4.5" /> : <ShieldQuestion className="w-4.5 h-4.5" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground">
            {activeFactor ? "Autenticação de dois fatores ativada" : "Autenticação de dois fatores desativada"}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {activeFactor
              ? "Trocar sua senha ou desativar isso aqui exige o código do autenticador."
              : "Adicione uma camada extra de segurança usando um app autenticador."}
          </p>
          {activeFactor && (
            <p className="text-[11px] text-muted-foreground/70 mt-1.5">
              Sessão atual {sessionIsStepUp ? "verificada com dois fatores" : "verificada só por senha"}.
            </p>
          )}
        </div>
      </div>

      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="text-sm text-destructive mt-3"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      <div className="mt-3">
        {activeFactor ? (
          <button
            onClick={startDisable}
            disabled={starting}
            className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium border border-destructive/30 text-destructive hover:bg-destructive/10 disabled:opacity-40 transition"
          >
            {starting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldOff className="w-3.5 h-3.5" />}
            Desativar
          </button>
        ) : (
          <button
            onClick={() => void startEnroll()}
            disabled={starting}
            className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-40 transition hover:brightness-110"
            style={{ backgroundImage: "var(--gradient-dexy)" }}
          >
            {starting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
            Ativar
          </button>
        )}
      </div>
    </div>
  );
}
