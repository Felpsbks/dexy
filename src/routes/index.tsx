import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  MessageSquare,
  Mic,
  Sparkles,
  ShieldCheck,
  Zap,
  Users,
  ArrowRight,
} from "lucide-react";
import { DexyLogo } from "@/components/DexyLogo";
import { useSession } from "@/lib/auth";

export const Route = createFileRoute("/")({
  component: Index,
});

const features = [
  { icon: MessageSquare, title: "Canais vivos", desc: "Texto, voz e fóruns organizados por categorias, prontos para qualquer comunidade." },
  { icon: Mic, title: "Voz cristalina", desc: "Salas de voz com baixa latência e áudio adaptativo, sem instalar plugins." },
  { icon: Sparkles, title: "Design em alta voltagem", desc: "Interface original, animações suaves e um dark mode feito para longas sessões." },
  { icon: ShieldCheck, title: "Moderação afiada", desc: "Ferramentas de moderação, papéis granulares e trilhas de auditoria." },
  { icon: Zap, title: "Rápido de verdade", desc: "Construído com stack moderna. Abre em milissegundos, sincroniza em tempo real." },
  { icon: Users, title: "Comunidades primeiro", desc: "Perfis expressivos, reações, respostas em thread e presença ao vivo." },
];

function Index() {
  const session = useSession();
  const appHref = session ? "/app" : "/login";

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      {/* Nav */}
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/60 border-b border-border/50">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2">
            <DexyLogo size={28} />
            <span className="text-lg font-semibold tracking-tight">Dexy</span>
          </Link>
          <nav className="hidden md:flex items-center gap-8 text-sm text-muted-foreground">
            <a href="#features" className="hover:text-foreground transition">Recursos</a>
            <a href="#preview" className="hover:text-foreground transition">Preview</a>
            <a href="#footer" className="hover:text-foreground transition">Comunidade</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link
              to={appHref}
              className="hidden sm:inline-flex items-center rounded-full px-4 py-2 text-sm font-medium text-foreground/80 hover:text-foreground transition"
            >
              {session ? "Abrir app" : "Entrar"}
            </Link>
            <Link
              to={appHref}
              className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:brightness-110"
              style={{ backgroundImage: "var(--gradient-dexy)" }}
            >
              Abrir aplicação <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative">
        <div
          className="absolute inset-0 -z-10"
          style={{ backgroundImage: "var(--gradient-glow)" }}
        />
        <div className="max-w-7xl mx-auto px-6 pt-24 pb-32 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card/50 px-4 py-1.5 text-xs text-muted-foreground"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            Beta pública aberta — junte-se hoje
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="mt-6 text-5xl md:text-7xl font-bold tracking-tight leading-[1.05]"
          >
            Onde comunidades <br />
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: "var(--gradient-dexy)" }}
            >
              ganham vida em neon.
            </span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="mt-6 max-w-2xl mx-auto text-lg text-muted-foreground"
          >
            Dexy reúne conversas por texto, voz e fóruns em uma única interface
            desenhada para pessoas criativas. Sem ruído. Sem fricção.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5 }}
            className="mt-10 flex flex-wrap items-center justify-center gap-3"
          >
            <Link
              to={appHref}
              className="inline-flex items-center gap-2 rounded-full px-6 py-3 font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:brightness-110"
              style={{ backgroundImage: "var(--gradient-dexy)" }}
            >
              Abrir aplicação <ArrowRight className="w-4 h-4" />
            </Link>
            <a
              href="#preview"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-6 py-3 font-medium hover:bg-card transition"
            >
              Ver preview
            </a>
          </motion.div>

          {/* Preview card */}
          <motion.div
            id="preview"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.6 }}
            className="mt-20 mx-auto max-w-5xl rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-2 shadow-[var(--shadow-glow)]"
          >
            <div className="rounded-2xl overflow-hidden bg-sidebar aspect-[16/9] grid grid-cols-[64px_220px_1fr]">
              <div className="bg-sidebar border-r border-border flex flex-col items-center gap-2 py-4">
                {["D", "E", "N", "P"].map((l, i) => (
                  <div
                    key={i}
                    className="w-10 h-10 rounded-2xl grid place-items-center text-sm font-bold bg-gradient-to-br from-[#00D8FF] to-[#8DFF2F] text-[#121417]"
                  >
                    {l}
                  </div>
                ))}
              </div>
              <div className="border-r border-border p-3 space-y-2 text-left">
                <div className="text-xs uppercase text-muted-foreground px-2">Geral</div>
                {["boas-vindas", "anúncios"].map((n) => (
                  <div key={n} className="text-sm px-2 py-1 rounded text-muted-foreground"># {n}</div>
                ))}
                <div className="text-xs uppercase text-muted-foreground px-2 pt-2">Comunidade</div>
                <div className="text-sm px-2 py-1 rounded bg-secondary text-foreground"># conversa-geral</div>
              </div>
              <div className="p-6 space-y-4 text-left">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-accent" />
                    <div className="flex-1">
                      <div className="h-2 w-24 bg-muted rounded" />
                      <div className="mt-2 h-2 w-3/4 bg-muted/60 rounded" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="max-w-7xl mx-auto px-6 py-24">
        <div className="max-w-2xl">
          <h2 className="text-4xl font-bold tracking-tight">Feito para conversas que importam.</h2>
          <p className="mt-3 text-muted-foreground">
            Todo detalhe pensado para reduzir ruído e manter o foco na sua comunidade.
          </p>
        </div>
        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
              className="rounded-2xl border border-border bg-card/50 p-6 hover:border-primary/50 transition group"
            >
              <div
                className="w-11 h-11 rounded-xl grid place-items-center text-primary-foreground"
                style={{ backgroundImage: "var(--gradient-dexy)" }}
              >
                <f.icon className="w-5 h-5" />
              </div>
              <h3 className="mt-4 font-semibold text-lg">{f.title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer id="footer" className="border-t border-border">
        <div className="max-w-7xl mx-auto px-6 py-12 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2">
              <DexyLogo size={24} />
              <span className="font-semibold">Dexy</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground max-w-sm">
              Uma plataforma independente para comunidades criativas.
              © {new Date().getFullYear()} Dexy Labs.
            </p>
          </div>
          <div className="flex flex-wrap gap-6 text-sm text-muted-foreground">
            <a href="#" className="hover:text-foreground">Sobre</a>
            <a href="#" className="hover:text-foreground">Blog</a>
            <a href="#" className="hover:text-foreground">Status</a>
            <a href="#" className="hover:text-foreground">Privacidade</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
