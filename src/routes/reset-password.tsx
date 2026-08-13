import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Eye, EyeOff, Loader2, Lock } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { MfaChallengeForm } from "@/components/MfaChallenge";
import { isAal2RequiredError, isCurrentPasswordRequiredError } from "@/lib/mfa";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [{ title: "DEXY — Redefinir senha" }],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [linkInvalid, setLinkInvalid] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // A recovery session is only AAL1 even though it proves the user opened
  // the emailed link -- if the account has a verified MFA factor, they
  // still have to prove they hold the authenticator before updateUser will
  // accept a new password (Supabase enforces this server-side).
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaChecked, setMfaChecked] = useState(false);

  // The emailed recovery link lands here with a token in the URL that
  // supabase-js exchanges for a temporary session automatically on load
  // (firing a PASSWORD_RECOVERY auth event) — this just waits for that
  // before showing the form. If nothing shows up in a few seconds the link
  // was invalid or expired.
  useEffect(() => {
    let settled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        settled = true;
        setReady(true);
      }
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) {
        settled = true;
        setReady(true);
      }
    });
    const timeout = setTimeout(() => {
      if (!settled) setLinkInvalid(true);
    }, 4000);
    return () => {
      data.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  // Once the recovery session is up, check whether it needs a step-up
  // before the password form is usable at all -- checking once here (rather
  // than only reacting to the eventual updateUser error) means someone with
  // their authenticator handy never even sees the plain form flash by.
  useEffect(() => {
    if (!ready) return;
    let active = true;
    supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(async ({ data: aalData }) => {
      if (!active) return;
      if (aalData && aalData.nextLevel === "aal2" && aalData.currentLevel !== aalData.nextLevel) {
        const { data: factorsData } = await supabase.auth.mfa.listFactors();
        if (!active) return;
        const factor = factorsData?.totp.find((f) => f.status === "verified");
        if (factor) setMfaFactorId(factor.id);
      }
      if (active) setMfaChecked(true);
    });
    return () => {
      active = false;
    };
  }, [ready]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setDone(true);
      setTimeout(() => router.navigate({ to: "/app" }), 1500);
    } catch (err) {
      // Defense in depth: the useEffect above should already have caught
      // this and shown the code prompt first, but if a verified factor got
      // added in another tab mid-flow, GoTrue still rejects the update here.
      if (isAal2RequiredError(err)) {
        const { data: factorsData } = await supabase.auth.mfa.listFactors();
        const factor = factorsData?.totp.find((f) => f.status === "verified");
        if (factor) {
          setMfaFactorId(factor.id);
          setError(null);
          return;
        }
      }
      // Also defense in depth: a genuine PASSWORD_RECOVERY session is
      // exempt from "Require current password when updating" server-side,
      // so this shouldn't normally fire here -- but surfaces a clear
      // message instead of the raw English string if it ever does (e.g.
      // the link somehow granted a plain signed-in session instead).
      if (isCurrentPasswordRequiredError(err)) {
        setError("Não foi possível confirmar essa sessão de recuperação. Peça um novo link na tela de login.");
        return;
      }
      setError(err instanceof Error ? err.message : "Algo deu errado. Tente de novo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#05070d] text-white flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="relative rounded-[2rem] p-px overflow-hidden">
          <div className="absolute inset-0 bg-linear-to-br from-[#00e5ff]/50 via-gray-800/20 to-[#00ff9d]/50 opacity-70" />
          <div className="relative bg-[#0c101a] rounded-[2rem] p-8 sm:p-10 shadow-2xl">
            <div className="flex flex-col items-center mb-8">
              <img src="/logo-wordmark.webp" alt="Dexy" className="h-8 object-contain mb-6" />
              <h2 className="text-2xl font-bold text-white">Redefinir senha</h2>
              <p className="text-sm text-gray-400 mt-2 text-center">
                Escolha uma nova senha para sua conta.
              </p>
            </div>

            {linkInvalid ? (
              <div className="text-center py-4">
                <p className="text-sm text-red-400">
                  Esse link de recuperação é inválido ou expirou. Peça um novo na tela de login.
                </p>
                <a
                  href="/login"
                  className="inline-block mt-4 text-sm text-[#00e5ff] hover:text-white transition"
                >
                  ← Voltar para o login
                </a>
              </div>
            ) : !ready || !mfaChecked ? (
              <div className="flex flex-col items-center gap-3 py-6 text-sm text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin" />
                Verificando o link de recuperação...
              </div>
            ) : mfaFactorId ? (
              <div>
                <MfaChallengeForm
                  factorId={mfaFactorId}
                  onVerified={() => setMfaFactorId(null)}
                  description="Essa conta tem autenticação de dois fatores. Confirme com seu autenticador antes de definir a nova senha."
                />
                <p className="text-xs text-gray-500 text-center mt-4">
                  Perdeu acesso ao autenticador? Entre em contato com quem administra o Dexy pra
                  recuperar o acesso.
                </p>
              </div>
            ) : done ? (
              <p className="text-sm text-[#00ff9d] text-center py-6">
                Senha atualizada! Redirecionando...
              </p>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                    <Lock className="w-5 h-5 text-gray-500" />
                  </div>
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={6}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Nova senha"
                    className="w-full bg-[#131924] border border-gray-800 focus:border-[#00e5ff] rounded-xl py-3.5 pl-11 pr-11 text-sm text-white placeholder-gray-500 outline-none transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-gray-500 hover:text-white transition"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                    <Lock className="w-5 h-5 text-gray-500" />
                  </div>
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={6}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirmar nova senha"
                    className="w-full bg-[#131924] border border-gray-800 focus:border-[#00e5ff] rounded-xl py-3.5 pl-11 pr-4 text-sm text-white placeholder-gray-500 outline-none transition-colors"
                  />
                </div>

                <AnimatePresence>
                  {error && (
                    <motion.p
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="text-sm text-red-400"
                    >
                      {error}
                    </motion.p>
                  )}
                </AnimatePresence>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full relative group overflow-hidden rounded-xl font-bold text-black py-3.5 mt-2 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-2"
                >
                  <div className="absolute inset-0 bg-linear-to-r from-[#00e5ff] to-[#ccff00]" />
                  <span className="relative flex items-center gap-2">
                    {loading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>
                        Salvar nova senha
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </span>
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
