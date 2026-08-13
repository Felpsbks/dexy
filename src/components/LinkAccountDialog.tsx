import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function LinkAccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  const close = (o: boolean) => {
    if (!o && !sent) {
      toast.error("Conta não vinculada. Você pode perder o acesso se ficar muito tempo sem entrar.");
    }
    onOpenChange(o);
    if (!o) {
      setEmail("");
      setPassword("");
      setError(null);
      setSent(false);
    }
  };

  const handleSubmit = async () => {
    if (!email.trim() || password.length < 6 || pending) return;
    setError(null);
    setPending(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        email: email.trim(),
        password,
      });
      if (updateError) throw updateError;
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível vincular a conta.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-sm rounded-2xl border-border bg-card p-6">
        {sent ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-lg font-bold">Sua conta ainda não foi confirmada</DialogTitle>
              <DialogDescription>
                Enviamos um e-mail de confirmação para {email}. Clique no link para confirmar e
                vincular sua conta de vez — até lá, ela continua como convidada, e os dados podem
                ser apagados se você ficar muito tempo sem entrar.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-4">
              <button
                onClick={() => close(false)}
                className="inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:brightness-110"
                style={{ backgroundImage: "var(--gradient-dexy)" }}
              >
                Entendi
              </button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-lg font-bold">Vincular conta</DialogTitle>
              <DialogDescription>
                Adicione um e-mail e senha para não perder sua conta e seus dados.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-2 space-y-3">
              <input
                autoFocus
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Seu e-mail"
                className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-primary"
              />
              <input
                type="password"
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSubmit();
                }}
                placeholder="Escolha uma senha"
                className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-primary"
              />
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
            <DialogFooter className="mt-4">
              <button
                onClick={() => void handleSubmit()}
                disabled={!email.trim() || password.length < 6 || pending}
                className="inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40 transition hover:brightness-110"
                style={{ backgroundImage: "var(--gradient-dexy)" }}
              >
                {pending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Vincular conta
              </button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
