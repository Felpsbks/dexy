import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Loader2,
  Lock,
  Mail,
  Phone,
  User,
  ShieldCheck,
  CheckCircle2,
  MessageSquare,
  Headphones,
  QrCode,
  Eye,
  EyeOff,
  Users,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/auth";
import { MfaChallengeForm } from "@/components/MfaChallenge";
import { getGuestBlockRemainingMs } from "@/lib/guestDevice";

export const Route = createFileRoute("/login")({
  // Only ever an internal path (must start with "/") -- never navigated to
  // via window.location, always via router.navigate below, and validated
  // here so a crafted `?redirect=https://evil.example` can't be used as an
  // open redirect even if something upstream forwarded it unchecked.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect:
      typeof search.redirect === "string" && search.redirect.startsWith("/")
        ? search.redirect
        : undefined,
  }),
  head: () => ({
    meta: [{ title: "DEXY — Entrar" }],
  }),
  component: LoginPage,
});

type Mode = "signin" | "signup" | "forgot" | "email-verify";

function randomGuestName(): string {
  return `Convidado${Math.floor(1000 + Math.random() * 9000)}`;
}

function normalizePhone(raw: string): string {
  return raw.replace(/[^\d+]/g, "");
}

function isValidPhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

function LoginPage() {
  const router = useRouter();
  const session = useSession();
  const { redirect } = Route.useSearch();
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // OTP email verification
  const [otpCode, setOtpCode] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  // Set once signInWithPassword succeeds but the resulting session is only
  // AAL1 while the account has a verified MFA factor (nextLevel === aal2) --
  // swaps the form for a code-entry step instead of navigating straight in.
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  // True only for the brief window between signInWithPassword resolving and
  // the AAL check below deciding navigate-vs-challenge. Needed as its own
  // flag rather than reusing `loading`: a `return` inside submit()'s try
  // block still runs the `finally` that clears `loading`, so guarding on
  // `loading` alone flips back to "safe to redirect" immediately after
  // setMfaFactorId runs, racing the very state update meant to stop it.
  const [postSignInCheck, setPostSignInCheck] = useState(false);
  const [guestBlockMsg, setGuestBlockMsg] = useState<string | null>(null);
  const [guestError, setGuestError] = useState<string | null>(null);
  const [guestLoading, setGuestLoading] = useState(false);

  // `onAuthStateChange` (and so `session`) flips truthy the instant
  // signInWithPassword resolves, regardless of AAL -- suppressing on
  // postSignInCheck/mfaFactorId stops this effect from racing ahead and
  // navigating to /app before the post-login AAL check has had a chance to
  // redirect into the MFA challenge instead. This still auto-redirects the
  // normal case: landing on /login with an already-authenticated session
  // from a previous visit.
  useEffect(() => {
    if (session && !postSignInCheck && !mfaFactorId) router.navigate({ to: redirect ?? "/app" });
  }, [session, postSignInCheck, mfaFactorId, router, redirect]);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  if (session && !postSignInCheck && !mfaFactorId) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      if (mode === "signin") {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;

        // signInWithPassword alone never reaches aal2 -- if the account has
        // a verified MFA factor, nextLevel comes back "aal2" and the user
        // still needs to prove they hold the authenticator before landing
        // in the app.
        setPostSignInCheck(true);
        try {
          const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
          if (aalData && aalData.nextLevel === "aal2" && aalData.currentLevel !== aalData.nextLevel) {
            const { data: factorsData } = await supabase.auth.mfa.listFactors();
            const factor = factorsData?.totp.find((f) => f.status === "verified");
            if (factor) {
              setMfaFactorId(factor.id);
              return;
            }
          }
          router.navigate({ to: redirect ?? "/app" });
        } finally {
          setPostSignInCheck(false);
        }
      } else if (mode === "signup") {
        if (!isValidPhone(phone)) {
          setError("Informe um telefone válido, com DDD.");
          return;
        }
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { name: name || email.split("@")[0], phone: normalizePhone(phone) },
            emailRedirectTo: `${window.location.origin}${redirect ?? "/app"}`,
          },
        });
        if (signUpError) throw signUpError;
        if (data.session) {
          router.navigate({ to: redirect ?? "/app" });
        } else if (data.user && data.user.identities && data.user.identities.length === 0) {
          // Supabase returns a fake-success response for an email that already
          // has a confirmed account (anti-enumeration) -- identities is the
          // one field left to tell the two cases apart.
          setError("Esse e-mail já tem uma conta. Tente entrar ou recuperar sua senha.");
        } else {
          // Switch to OTP verification screen
          setMode("email-verify");
          setError(null);
          setInfo(null);
          setResendCooldown(60);
        }
      } else if (mode === "email-verify") {
        if (otpCode.trim().length !== 8) {
          setError("Informe o código de 8 dígitos.");
          return;
        }
        const { error: verifyError } = await supabase.auth.verifyOtp({
          email,
          token: otpCode.trim(),
          type: "signup",
        });
        if (verifyError) throw verifyError;
        router.navigate({ to: redirect ?? "/app" });
      } else {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (resetError) throw resetError;
        setInfo("Enviamos um link de recuperação para o seu e-mail.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Algo deu errado. Tente de novo.");
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    setMode((m) => (m === "signin" ? "signup" : "signin"));
    setError(null);
    setInfo(null);
  };

  const handleGuestEntry = async () => {
    const remainingMs = getGuestBlockRemainingMs();
    if (remainingMs > 0) {
      const days = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
      setGuestBlockMsg(
        `Você saiu de uma conta convidada recentemente neste dispositivo. Tente de novo em ${days} dia${days === 1 ? "" : "s"}, ou crie/entre numa conta normal.`,
      );
      return;
    }
    setGuestBlockMsg(null);
    setGuestError(null);
    setGuestLoading(true);
    try {
      const { error: signInError } = await supabase.auth.signInAnonymously({
        options: { data: { name: randomGuestName() } },
      });
      if (signInError) throw signInError;
      router.navigate({ to: redirect ?? "/app" });
    } catch (err) {
      setGuestError(err instanceof Error ? err.message : "Não foi possível entrar. Tente de novo.");
    } finally {
      setGuestLoading(false);
    }
  };

  const goToForgotPassword = () => {
    setMode("forgot");
    setError(null);
    setInfo(null);
  };

  const backToSignIn = () => {
    setMode("signin");
    setError(null);
    setInfo(null);
  };

  const cancelMfaChallenge = async () => {
    // The AAL1 session by itself already succeeded at signInWithPassword,
    // so simply abandoning the code prompt would leave a live (if limited)
    // session behind -- sign out to return cleanly to a logged-out state.
    await supabase.auth.signOut();
    setMfaFactorId(null);
  };

  return (
    <div className="min-h-dvh bg-[#05070d] text-white flex flex-col lg:flex-row overflow-hidden font-sans relative">
      {/* Left Panel - Visual/Brand */}
      <div className="hidden lg:flex w-full lg:w-[55%] xl:w-[60%] flex-col relative z-10 p-12 justify-between overflow-visible">
        {/* Background photo */}
        <div
          className="absolute inset-0 -z-10 bg-cover bg-center"
          style={{ backgroundImage: "url(/login-bg.webp)" }}
        />
        <div className="absolute inset-0 -z-10 bg-linear-to-r from-[#05070d] via-[#05070d]/40 to-[#05070d]/70" />
        <div className="absolute inset-0 -z-10 bg-linear-to-t from-[#05070d] via-transparent to-[#05070d]/50" />

        {/* Brand Header */}
        <div className="flex items-center">
          <img src="/logo-wordmark.webp" alt="Dexy" className="h-11 object-contain" />
        </div>

        {/* Hero Content */}
        <div className="flex-1 relative flex items-center justify-center mt-8 overflow-visible">
          {/* Hero Text */}
          <div className="absolute top-0 left-0 max-w-lg z-20">
            <motion.h1
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="text-4xl xl:text-5xl font-bold leading-tight"
            >
              Conecte pessoas.
              <br />
              Crie comunidades.
              <br />
              Tudo em{" "}
              <span className="text-transparent bg-clip-text bg-linear-to-r from-[#00e5ff] to-[#ccff00]">
                tempo real.
              </span>
            </motion.h1>
            <motion.p
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="mt-6 text-gray-400 text-base max-w-md"
            >
              Comunicação sem limites para gamers, amigos e equipes que vão além.
            </motion.p>
          </div>

          {/* Floating Card: Comunidade Alpha */}
          <motion.div
            className="absolute -left-5 xl:left-5 top-[40%] z-30 bg-[#0c101a]/80 backdrop-blur-xl border border-white/5 rounded-2xl p-4 shadow-2xl flex flex-col gap-3 w-64"
            animate={{ y: [0, -10, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-purple-600 rounded-xl flex items-center justify-center shadow-lg">
                <Users className="text-white w-6 h-6" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-1">
                  <span className="font-semibold text-sm">Comunidade Alpha</span>
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />
                </div>
                <div className="text-xs text-gray-400">1.234 membros</div>
                <div className="text-[10px] text-[#00ff9d] font-medium mt-0.5">
                  Comunidade ativa
                </div>
              </div>
            </div>
            <div className="flex items-center -space-x-2 pl-1">
              {[1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="w-7 h-7 rounded-full border-2 border-[#0c101a] bg-gray-700 overflow-hidden"
                >
                  <img src={`https://i.pravatar.cc/100?img=${i + 10}`} alt="avatar" />
                </div>
              ))}
              <div className="w-7 h-7 rounded-full border-2 border-[#0c101a] bg-gray-800 flex items-center justify-center text-[10px] font-medium z-10">
                +120
              </div>
            </div>
          </motion.div>

          {/* Floating Card: # geral */}
          <motion.div
            className="absolute left-[10%] xl:left-[25%] bottom-[10%] z-30 bg-[#0c101a]/90 backdrop-blur-xl border border-[#00ff9d]/20 rounded-2xl p-4 shadow-[0_10px_40px_rgba(0,255,157,0.1)] w-72"
            animate={{ y: [0, 15, 0] }}
            transition={{ duration: 8, repeat: Infinity, ease: "easeInOut", delay: 1 }}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="font-bold text-sm flex items-center gap-1">
                <span className="text-gray-500">#</span> geral
              </span>
              <span className="text-[10px] text-gray-500">agora</span>
            </div>
            <div className="space-y-3">
              <div className="flex gap-2">
                <img
                  src="https://i.pravatar.cc/100?img=33"
                  className="w-6 h-6 rounded-full mt-0.5"
                />
                <div>
                  <div className="text-xs font-semibold">Lucas</div>
                  <div className="text-[11px] text-gray-300">Bora jogar hoje à noite! 🎮</div>
                </div>
              </div>
              <div className="flex gap-2">
                <img
                  src="https://i.pravatar.cc/100?img=47"
                  className="w-6 h-6 rounded-full mt-0.5"
                />
                <div>
                  <div className="text-xs font-semibold">Marina</div>
                  <div className="text-[11px] text-gray-300">Partiu! Chama mais gente!</div>
                </div>
              </div>
              <div className="flex gap-2 items-center bg-[#00ff9d]/10 rounded-lg p-2 border border-[#00ff9d]/20">
                <img src="/logo.webp" className="w-5 h-5" />
                <div className="flex-1">
                  <div className="text-[10px] font-bold text-[#00e5ff] flex items-center gap-1">
                    Dexy{" "}
                    <span className="bg-[#00e5ff] text-black text-[8px] px-1 rounded-sm">BOT</span>
                  </div>
                  <div className="text-[10px] text-gray-300">
                    Evento criado:{" "}
                    <span className="text-white font-medium">Sexta Game Night 🎉</span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Floating Card: Sala de Voz */}
          <motion.div
            className="absolute right-[5%] xl:right-[15%] top-[10%] z-30 bg-[#0c101a]/80 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-2xl w-60"
            animate={{ y: [0, -15, 0] }}
            transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <div className="bg-gray-800 p-1.5 rounded-lg">
                <Headphones className="w-4 h-4 text-white" />
              </div>
              <span className="font-semibold text-sm">Sala de Voz</span>
            </div>

            {/* Audio Waves Simulation */}
            <div className="flex items-end gap-1 h-6 my-3 px-1">
              {[40, 70, 40, 100, 60, 30, 80, 50, 90, 40, 60, 30, 80, 50, 100, 70, 40, 60].map(
                (h, i) => (
                  <motion.div
                    key={i}
                    className="w-1 bg-[#00ff9d] rounded-t-sm opacity-80"
                    animate={{
                      height: [`${Math.max(20, h - 30)}%`, `${h}%`, `${Math.max(20, h - 30)}%`],
                    }}
                    transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.1 }}
                  />
                ),
              )}
            </div>

            <div className="flex items-center justify-between text-xs text-gray-400 mt-2">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-[#00ff9d] animate-pulse" />
                <span>Conectados agora</span>
              </div>
              <div className="flex items-center gap-1">
                <span>12</span>
                <Users className="w-3.5 h-3.5" />
              </div>
            </div>
          </motion.div>
        </div>

        {/* Footer Stats */}
        <div className="flex items-center gap-12 mt-auto border-t border-white/5 pt-6 z-20">
          <div className="flex items-center gap-3">
            <Users className="w-8 h-8 text-[#00e5ff]" />
            <div>
              <div className="text-xl font-bold text-white">120K+</div>
              <div className="text-xs text-gray-400">
                usuários ativos
                <br />
                todo mês
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <MessageSquare className="w-8 h-8 text-[#00ff9d]" />
            <div>
              <div className="text-xl font-bold text-white">2.500+</div>
              <div className="text-xs text-gray-400">
                comunidades
                <br />
                criadas
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-8 h-8 text-yellow-400" />
            <div>
              <div className="text-xl font-bold text-white">99,9%</div>
              <div className="text-xs text-gray-400">
                uptime e estabilidade
                <br />
                garantidos
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel - Form */}
      <div className="w-full lg:w-[45%] xl:w-[40%] flex items-center justify-center p-6 sm:p-12 z-20 relative">
        <div className="w-full max-w-105">
          {/* Form Container with Gradient Border */}
          <div className="relative rounded-[2rem] p-px overflow-hidden group">
            {/* The Gradient Border */}
            <div className="absolute inset-0 bg-linear-to-br from-[#00e5ff]/50 via-gray-800/20 to-[#00ff9d]/50 opacity-70" />

            {/* Form Inner Content */}
            <div className="relative bg-[#0c101a] rounded-[2rem] p-8 sm:p-10 shadow-2xl backdrop-blur-xl h-full w-full">
              {mfaFactorId ? (
                <MfaChallengeForm
                  factorId={mfaFactorId}
                  onVerified={() => router.navigate({ to: redirect ?? "/app" })}
                  onCancel={() => void cancelMfaChallenge()}
                  cancelLabel="Voltar para o login"
                />
              ) : mode === "email-verify" ? (
                <form onSubmit={submit} className="space-y-4">
                  <div className="flex flex-col items-center text-center gap-2 mb-2">
                    <div className="w-11 h-11 rounded-full bg-[#00e5ff]/10 text-[#00e5ff] flex items-center justify-center">
                      <Mail className="w-5 h-5" />
                    </div>
                    <h3 className="text-lg font-semibold text-white">Verifique seu e-mail</h3>
                    <p className="text-sm text-gray-400">
                      Enviamos um código de 8 dígitos para{" "}
                      <span className="text-white font-medium">{email}</span>
                    </p>
                  </div>

                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    maxLength={8}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                    placeholder="000000"
                    className="w-full text-center tracking-[0.5em] text-lg bg-[#131924] border border-gray-800 focus:border-[#00e5ff] rounded-xl py-3.5 px-4 text-white outline-none transition-colors"
                  />

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
                    disabled={loading || otpCode.length !== 8}
                    className="w-full relative group overflow-hidden rounded-xl font-bold text-black py-3.5 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-2"
                  >
                    <div className="absolute inset-0 bg-linear-to-r from-[#00e5ff] to-[#ccff00] transition-opacity" />
                    <span className="relative flex items-center gap-2">
                      {loading ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <>
                          Confirmar
                          <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </span>
                  </button>

                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setMode("signup");
                        setOtpCode("");
                        setError(null);
                      }}
                      className="text-xs text-gray-400 hover:text-white transition"
                    >
                      ← Voltar
                    </button>
                    <button
                      type="button"
                      disabled={resendCooldown > 0}
                      onClick={async () => {
                        setError(null);
                        const { error: resendError } = await supabase.auth.resend({
                          type: "signup",
                          email,
                        });
                        if (resendError) {
                          setError(resendError.message);
                        } else {
                          setResendCooldown(60);
                          setInfo("Código reenviado!");
                          setTimeout(() => setInfo(null), 3000);
                        }
                      }}
                      className="text-xs text-[#00e5ff] hover:text-white transition disabled:text-gray-600 disabled:cursor-default"
                    >
                      {resendCooldown > 0 ? `Reenviar em ${resendCooldown}s` : "Reenviar código"}
                    </button>
                  </div>

                  <AnimatePresence>
                    {info && (
                      <motion.p
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="text-sm text-[#00ff9d] text-center"
                      >
                        {info}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </form>
              ) : (
                <>
              <div className="flex flex-col items-center mb-8">
                <img src="/logo-wordmark.webp" alt="Dexy" className="h-8 object-contain mb-6" />
                <h2 className="text-2xl font-bold text-white">
                  {mode === "signin"
                    ? "Bem-vindo de volta!"
                    : mode === "signup"
                      ? "Criar uma conta"
                      : "Recuperar acesso"}
                </h2>
                <p className="text-sm text-gray-400 mt-2 text-center">
                  {mode === "signin"
                    ? "Faça login para continuar"
                    : mode === "signup"
                      ? "Junte-se a milhares de comunidades"
                      : "Informe seu e-mail e enviaremos um link para redefinir sua senha."}
                </p>
              </div>

              <form onSubmit={submit} className="space-y-4">
                {mode === "signup" && (
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                      <User className="w-5 h-5 text-gray-500" />
                    </div>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Nome de exibição"
                      className="w-full bg-[#131924] border border-gray-800 focus:border-[#00e5ff] rounded-xl py-3.5 pl-11 pr-4 text-sm text-white placeholder-gray-500 outline-none transition-colors"
                    />
                  </div>
                )}

                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                    <Mail className="w-5 h-5 text-gray-500" />
                  </div>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="E-mail ou nome de usuário"
                    className="w-full bg-[#131924] border border-gray-800 focus:border-[#00e5ff] rounded-xl py-3.5 pl-11 pr-4 text-sm text-white placeholder-gray-500 outline-none transition-colors"
                  />
                </div>

                {mode === "signup" && (
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                      <Phone className="w-5 h-5 text-gray-500" />
                    </div>
                    <input
                      type="tel"
                      required
                      autoComplete="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="Telefone, com DDD"
                      className="w-full bg-[#131924] border border-gray-800 focus:border-[#00e5ff] rounded-xl py-3.5 pl-11 pr-4 text-sm text-white placeholder-gray-500 outline-none transition-colors"
                    />
                  </div>
                )}

                {mode !== "forgot" && (
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                      <Lock className="w-5 h-5 text-gray-500" />
                    </div>
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      minLength={6}
                      autoComplete={mode === "signin" ? "current-password" : "new-password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Senha"
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
                )}

                {mode === "signin" && (
                  <div className="flex items-center justify-between pt-1">
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <div className="w-4 h-4 rounded border border-gray-600 group-hover:border-[#00e5ff] flex items-center justify-center transition-colors bg-[#131924]">
                        <input type="checkbox" className="hidden peer" />
                        <CheckCircle2 className="w-3 h-3 text-[#00e5ff] opacity-0 peer-checked:opacity-100 transition-opacity" />
                      </div>
                      <span className="text-xs text-gray-400 group-hover:text-gray-300">
                        Lembrar de mim
                      </span>
                    </label>
                    <button
                      type="button"
                      onClick={goToForgotPassword}
                      className="text-xs text-[#00e5ff] hover:text-white transition"
                    >
                      Esqueceu sua senha?
                    </button>
                  </div>
                )}

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
                  {info && (
                    <motion.p
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="text-sm text-[#00ff9d]"
                    >
                      {info}
                    </motion.p>
                  )}
                </AnimatePresence>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full relative group overflow-hidden rounded-xl font-bold text-black py-3.5 mt-2 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-2"
                >
                  <div className="absolute inset-0 bg-linear-to-r from-[#00e5ff] to-[#ccff00] transition-opacity" />
                  <span className="relative flex items-center gap-2">
                    {loading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>
                        {mode === "signin"
                          ? "Entrar"
                          : mode === "signup"
                            ? "Criar conta"
                            : "Enviar link de recuperação"}
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </span>
                </button>
              </form>

              {mode !== "forgot" && (
                <>
                  <button
                    type="button"
                    disabled={guestLoading}
                    onClick={() => void handleGuestEntry()}
                    className="w-full mt-3 bg-transparent hover:bg-[#131924] border border-gray-800 transition-colors py-2.5 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {guestLoading ? (
                      <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
                    ) : (
                      <span className="text-sm text-gray-400">Entrar sem conta</span>
                    )}
                  </button>
                  {guestBlockMsg && (
                    <p className="mt-2 text-xs text-red-400 text-center max-w-xs mx-auto">{guestBlockMsg}</p>
                  )}
                  {!guestBlockMsg && guestError && (
                    <p className="mt-2 text-xs text-red-400 text-center max-w-xs mx-auto">{guestError}</p>
                  )}

                  <div className="relative my-8">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-gray-800"></div>
                    </div>
                    <div className="relative flex justify-center text-xs">
                      <span className="bg-[#0c101a] px-3 text-gray-500">ou continue com</span>
                    </div>
                  </div>

                  <div className="flex gap-3 mb-6">
                    <button
                      title="Entrar com Google"
                      className="flex-1 bg-[#131924] hover:bg-[#1a2233] border border-gray-800 transition-colors py-2.5 rounded-xl flex items-center justify-center"
                    >
                      <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                        <path
                          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                          fill="#4285F4"
                        />
                        <path
                          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                          fill="#34A853"
                        />
                        <path
                          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                          fill="#FBBC05"
                        />
                        <path
                          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                          fill="#EA4335"
                        />
                      </svg>
                      <span className="ml-2 text-sm font-medium hidden sm:inline">Google</span>
                    </button>
                    <button
                      title="Entrar com GitHub"
                      className="flex-1 bg-[#131924] hover:bg-[#1a2233] border border-gray-800 transition-colors py-2.5 rounded-xl flex items-center justify-center"
                    >
                      <svg className="w-5 h-5 shrink-0 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path
                          fillRule="evenodd"
                          d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <span className="ml-2 text-sm font-medium hidden sm:inline">GitHub</span>
                    </button>
                    <button
                      title="Entrar com Microsoft"
                      className="flex-1 bg-[#131924] hover:bg-[#1a2233] border border-gray-800 transition-colors py-2.5 rounded-xl flex items-center justify-center"
                    >
                      <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                        <path fill="#F25022" d="M1 1h10.5v10.5H1z" />
                        <path fill="#7FBA00" d="M12.5 1H23v10.5H12.5z" />
                        <path fill="#00A4EF" d="M1 12.5h10.5V23H1z" />
                        <path fill="#FFB900" d="M12.5 12.5H23V23H12.5z" />
                      </svg>
                      <span className="ml-2 text-sm font-medium hidden sm:inline">Microsoft</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    className="w-full bg-[#131924] hover:bg-[#1a2233] border border-gray-800 transition-colors py-2.5 rounded-xl flex items-center justify-center gap-2"
                  >
                    <QrCode className="w-4 h-4 text-[#00e5ff]" />
                    <span className="text-sm text-gray-300">Entrar com QR Code</span>
                  </button>
                </>
              )}

              <div className="mt-8 text-center">
                {mode === "forgot" ? (
                  <button
                    onClick={backToSignIn}
                    className="text-xs text-gray-400 hover:text-white transition"
                  >
                    <span className="text-[#00e5ff] font-medium">← Voltar para o login</span>
                  </button>
                ) : (
                  <button
                    onClick={switchMode}
                    className="text-xs text-gray-400 hover:text-white transition"
                  >
                    {mode === "signin" ? (
                      <>
                        Não tem uma conta?{" "}
                        <span className="text-[#00e5ff] font-medium ml-1">Criar uma conta →</span>
                      </>
                    ) : (
                      <>
                        Já tem conta?{" "}
                        <span className="text-[#00e5ff] font-medium ml-1">Entrar →</span>
                      </>
                    )}
                  </button>
                )}
              </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
