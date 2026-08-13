import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { CheckCircle2, Loader2, Users } from "lucide-react";
import { usePreviewInvite, useAcceptInvite, type InvitePreview } from "@/lib/queries";
import { useSession } from "@/lib/auth";

export const Route = createFileRoute("/invite/$code")({
  head: () => ({
    meta: [{ title: "DEXY — Convite" }],
  }),
  component: InvitePage,
});

// Public page — reachable logged-out. Same standalone-page shell as
// login.tsx/reset-password.tsx (dark gradient-border card), not the
// app-shell design tokens used inside app.tsx's dialogs, so this stays
// visually consistent with Dexy's only other public-facing pages instead of
// introducing a third look. All invite data comes exclusively from
// usePreviewInvite (Etapa 5.2) — this file never queries server_invites,
// servers, or server_members directly, so it can only ever see the 5 fields
// that RPC exposes (name/icon_initial/color/status/already_member) — no
// server_id, created_by, use_count, max_uses, expires_at, revoked_at, or
// code ever reaches this component. Acceptance (this etapa) goes exclusively
// through useAcceptInvite(code) — no direct write to server_members, no
// client-chosen server_id (always whatever the RPC itself returns).
function InvitePage() {
  const { code } = Route.useParams();
  const session = useSession();
  const { data: preview, isLoading, isError } = usePreviewInvite(code);

  // session === undefined (auth check in flight) is folded into the
  // loading state too, so the "already a member" / "logged out" branches
  // below never render on a stale/unknown auth guess.
  const stillResolving = isLoading || session === undefined;

  return (
    <div className="min-h-screen bg-[#05070d] text-white flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="relative rounded-[2rem] p-px overflow-hidden">
          <div className="absolute inset-0 bg-linear-to-br from-[#00e5ff]/50 via-gray-800/20 to-[#00ff9d]/50 opacity-70" />
          <div className="relative bg-[#0c101a] rounded-[2rem] p-8 sm:p-10 shadow-2xl">
            <div className="flex flex-col items-center mb-6">
              <img src="/logo-wordmark.webp" alt="Dexy" className="h-8 object-contain" />
            </div>

            {stillResolving ? (
              <InvitePreviewSkeleton />
            ) : isError || !preview ? (
              <InviteStatusMessage
                title="Algo deu errado"
                description="Não foi possível carregar este convite agora. Tente novamente em instantes."
              />
            ) : preview.status === "not_found" ? (
              <InviteStatusMessage
                title="Convite não encontrado"
                description="Esse link não existe ou o código está incorreto."
              />
            ) : preview.status === "expired" ? (
              <InviteStatusMessage
                title="Convite expirado"
                description="Esse convite não é mais válido. Peça um novo link a quem te convidou."
              />
            ) : preview.status === "revoked" ? (
              <InviteStatusMessage
                title="Convite revogado"
                description="Quem criou esse convite o revogou. Peça um novo link a quem te convidou."
              />
            ) : preview.status === "exhausted" ? (
              <InviteStatusMessage
                title="Convite esgotado"
                description="Esse convite já atingiu o limite de utilizações."
              />
            ) : (
              <ValidInvite code={code} preview={preview} loggedIn={!!session} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function InvitePreviewSkeleton() {
  return (
    <div className="flex flex-col items-center gap-3 py-2 animate-pulse" aria-busy="true">
      <div className="w-20 h-20 rounded-3xl bg-white/10" />
      <div className="h-3 w-32 rounded bg-white/5 mt-1" />
      <div className="h-5 w-44 rounded bg-white/10" />
      <div className="h-11 w-full rounded-full bg-white/10 mt-5" />
    </div>
  );
}

function InviteStatusMessage({ title, description }: { title: string; description: string }) {
  return (
    <div className="text-center py-4">
      <h2 className="text-lg font-bold text-white">{title}</h2>
      <p className="mt-2 text-sm text-gray-400">{description}</p>
      <Link to="/" className="inline-block mt-6 text-sm text-[#00e5ff] hover:text-white transition">
        ← Voltar para o Dexy
      </Link>
    </div>
  );
}

function ValidInvite({
  code,
  preview,
  loggedIn,
}: {
  code: string;
  preview: InvitePreview;
  loggedIn: boolean;
}) {
  const router = useRouter();
  const acceptInvite = useAcceptInvite();
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initial = preview.icon_initial ?? preview.name?.charAt(0).toUpperCase() ?? "?";

  const goToLogin = () => {
    router.navigate({ to: "/login", search: { redirect: `/invite/${code}` } });
  };

  const handleAccept = async () => {
    // Guarded by the button's own disabled={acceptInvite.isPending} below —
    // a second click while a call is already in flight is a no-op click on
    // a disabled element, not a second mutation.
    setError(null);
    try {
      const result = await acceptInvite.mutateAsync(code);
      setAccepted(true);
      // Same "show success, then navigate" pattern already used in
      // reset-password.tsx — result.server_id is exactly (and only) what
      // accept_invite returned, never assumed by this component.
      setTimeout(() => {
        router.navigate({ to: "/app", search: { server: result.server_id } });
      }, 1200);
    } catch (err) {
      // accept_invite's own exception messages are plain English internal
      // strings (Etapa 2), not user-facing copy, and re-validate everything
      // server-side regardless of what the preview showed a moment ago
      // (expiry/revocation/limit can all change between preview and click)
      // — so this shows one generic message rather than trying to parse a
      // reason out of the RPC's error text.
      setError(
        err instanceof Error
          ? "Não foi possível aceitar este convite. Ele pode ter expirado, sido revogado ou atingido o limite de usos."
          : "Algo deu errado. Tente novamente.",
      );
    }
  };

  if (accepted) {
    return (
      <div className="flex flex-col items-center text-center py-4">
        <CheckCircle2 className="w-12 h-12 text-[#00ff9d]" />
        <h2 className="text-lg font-bold text-white mt-3">Convite aceito!</h2>
        <p className="text-sm text-gray-400 mt-1">Entrando no servidor...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center text-center">
      <div
        className={`w-20 h-20 rounded-3xl grid place-items-center text-white text-2xl font-bold bg-gradient-to-br ${
          preview.color ?? "from-[#00D8FF] to-[#8DFF2F]"
        } shadow-lg`}
      >
        {initial}
      </div>
      <p className="text-sm text-gray-400 mt-4">Você foi convidado a entrar em</p>
      <h2 className="text-xl font-bold text-white">{preview.name}</h2>

      {preview.already_member ? (
        <>
          <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1 text-xs text-gray-300">
            <Users className="w-3.5 h-3.5" />
            Você já é membro deste servidor
          </span>
          {/* Safe to navigate for real here: an existing member already has
              legitimate access, this doesn't call accept_invite or touch
              membership/use_count at all. No server id to deep-link to —
              preview_invite never returns server_id by design (Etapa 5.1),
              so this lands on /app and the user picks their server there. */}
          <Link
            to="/app"
            className="w-full mt-5 inline-flex items-center justify-center rounded-full px-4 py-3 text-sm font-bold text-black transition hover:brightness-110"
            style={{ backgroundImage: "var(--gradient-dexy)" }}
          >
            Ir para o servidor
          </Link>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={loggedIn ? () => void handleAccept() : goToLogin}
            disabled={acceptInvite.isPending}
            className="w-full mt-5 inline-flex items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-60"
            style={{ backgroundImage: "var(--gradient-dexy)" }}
          >
            {acceptInvite.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {acceptInvite.isPending
              ? "Entrando..."
              : loggedIn
                ? "Entrar no servidor"
                : "Entrar ou criar conta para continuar"}
          </button>
          {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
          {!loggedIn && !error && (
            <p className="mt-3 text-xs text-gray-500">
              Você vai precisar entrar ou criar uma conta Dexy para aceitar este convite.
            </p>
          )}
        </>
      )}
    </div>
  );
}
