import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AuthMFAListFactorsResponse } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type TotpFactor = NonNullable<AuthMFAListFactorsResponse["data"]>["totp"][number];

export function useMfaFactors() {
  return useQuery({
    queryKey: ["mfa-factors"],
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      return data;
    },
  });
}

export function useAuthenticatorAssuranceLevel() {
  return useQuery({
    queryKey: ["mfa-aal"],
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (error) throw error;
      return data;
    },
  });
}

export function useInvalidateMfaQueries() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["mfa-factors"] });
    queryClient.invalidateQueries({ queryKey: ["mfa-aal"] });
  };
}

export async function enrollTotp() {
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
  if (error) throw error;
  return data;
}

export async function unenrollFactor(factorId: string) {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw error;
}

/** Runs a fresh challenge + verify in one step — a challenge is single-use,
 * so retries after a wrong code need a brand new one rather than reusing an
 * expired/consumed challengeId. */
export async function challengeAndVerify(factorId: string, code: string) {
  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
  if (challengeError) throw challengeError;
  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code,
  });
  if (verifyError) throw verifyError;
}

/** Supabase returns a distinct, consistently "AAL2"-prefixed error whenever
 * a sensitive operation (password/email change, factor enroll/unenroll) is
 * blocked because the current session is only AAL1 and the account has a
 * verified MFA factor — this is enforced server-side by GoTrue itself, not
 * something the app opts into, so all we do here is recognize it to show a
 * step-up prompt instead of a raw error string. */
export function isAal2RequiredError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("AAL2");
}

/** Set independently of MFA via the "Require current password when
 * updating" project setting (Authentication → Sign In / Providers →
 * Email) -- GoTrue rejects updateUser({ password }) with this unless a
 * matching `current_password` is supplied, except for a genuine
 * PASSWORD_RECOVERY session, which is exempt. */
export function isCurrentPasswordRequiredError(error: unknown): boolean {
  const code = (error as { code?: string } | undefined)?.code;
  if (code === "current_password_required" || code === "current_password_invalid") return true;
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("current password");
}

/** First verified TOTP factor, if any — the only factor type Dexy enrolls today. */
export function firstVerifiedTotpFactor(factors: AuthMFAListFactorsResponse["data"] | undefined) {
  return factors?.totp.find((f) => f.status === "verified") ?? null;
}
