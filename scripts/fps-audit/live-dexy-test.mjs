// Fase 7.6 -- live test through the REAL Dexy app (dev server, same
// Supabase/LiveKit project as .env), not the bypass harness used earlier.
// Creates two disposable throwaway accounts, logs both into real Chromium
// windows, starts a real DM call, and drives the real "Compartilhar tela"
// button. getDisplayMedia's tab picker is native OS/browser UI (not part of
// the page DOM) -- Playwright cannot click it, so this pauses and waits for
// a human to pick "Chrome Tab" -> the video-content tab once. Everything
// else (login, navigation, call, stats collection, math) is automated.
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const RESULTS_DIR = path.join(__dirname, "results");
mkdirSync(RESULTS_DIR, { recursive: true });

function loadEnv(file) {
  const text = readFileSync(file, "utf8");
  const out = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}
const env = loadEnv(path.join(ROOT, ".env"));
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY;
const BASE_URL = "http://localhost:8081"; // 8080 had a stuck listener from an earlier session; this dev server instance is on 8081

// dm-bot account doesn't exist/isn't confirmed (signIn fails). B is a real
// account the user provided directly. A is created fresh through the REAL
// signup UI (not the raw API -- the earlier raw signUp() attempt failed with
// "Error sending confirmation email"; driving the actual form doubles as a
// live test of the signup flow itself).
const TS = Date.now();
const A = {
  email: `fps-audit-a-${TS}@example.com`,
  password: `FpsAudit!2026a${TS}`,
  // Unique per run -- earlier failed runs left behind several same-named
  // throwaway accounts already friended with B; a fixed name would make
  // openDmWith's text match ambiguous (or worse, silently pick a stale one).
  name: `FPS Audit A ${TS}`,
  phone: "11999999999",
};
const B = { email: "ferepetido@gmail.com", password: "Felps@2712" };

async function signIn(acc) {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await sb.auth.signInWithPassword({ email: acc.email, password: acc.password });
  if (error) throw new Error(`signIn ${acc.email}: ${error.message}`);
  const { data: profile } = await sb.from("profiles").select("name").eq("id", data.user.id).single();
  return { id: data.user.id, name: profile?.name ?? acc.email, sb };
}

// Drives the real /login signup form (mode=signup) instead of calling
// supabase.auth.signUp() directly -- this IS the signup-flow test the user
// asked for, not just a means to an account. Returns which of the 3 real
// outcomes actually happened (immediate session / OTP email step / error)
// so the caller can react correctly instead of assuming success.
async function signUpViaUI(page, acc) {
  await page.goto(`${BASE_URL}/login`);
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: /Criar uma conta/ }).click();
  await page.waitForTimeout(500);
  await page.getByPlaceholder("Nome de exibição").fill(acc.name);
  await page.getByPlaceholder("E-mail ou nome de usuário").fill(acc.email);
  await page.getByPlaceholder("Telefone, com DDD").fill(acc.phone);
  await page.getByPlaceholder("Senha").fill(acc.password);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await page.waitForTimeout(4000);
  if (page.url().startsWith(`${BASE_URL}/app`)) return { outcome: "session-immediate" };
  const otpVisible = await page.getByText("Verifique seu e-mail").isVisible().catch(() => false);
  if (otpVisible) return { outcome: "otp-required" };
  const errorEl = page.locator("p.text-destructive, p.text-red-400");
  const errorText = await errorEl.first().textContent().catch(() => null);
  return { outcome: "error", errorText };
}

// RLS (supabase/migrations/20260808200000_fix_friendships_rls.sql) closed
// the direct-insert-as-accepted hole dm-bot.mjs's version of this relied on:
// INSERT now requires status='pending' AND auth.uid()=user_id, and flipping
// to 'accepted' requires auth.uid()=friend_id (i.e. only the recipient can
// accept) -- so this needs both sides' authenticated clients, request-then-accept.
async function ensureFriendship(sbA, aId, sbB, bId) {
  const { data: existing } = await sbA
    .from("friendships")
    .select("user_id, friend_id, status")
    .or(`and(user_id.eq.${aId},friend_id.eq.${bId}),and(user_id.eq.${bId},friend_id.eq.${aId})`)
    .maybeSingle();
  if (existing?.status === "accepted") return;
  if (!existing) {
    const { error } = await sbA.from("friendships").insert({ user_id: aId, friend_id: bId, status: "pending" });
    if (error) throw new Error(`friendship insert (pending): ${error.message}`);
  }
  // Whoever is friend_id on the row is the one allowed to accept it.
  const row = existing ?? { user_id: aId, friend_id: bId };
  const sbRecipient = row.friend_id === bId ? sbB : sbA;
  const { error } = await sbRecipient
    .from("friendships")
    .update({ status: "accepted" })
    .eq("user_id", row.user_id)
    .eq("friend_id", row.friend_id);
  if (error) throw new Error(`friendship accept: ${error.message}`);
}

const STATS_INIT_SCRIPT = `
(() => {
  window.__pcs = [];
  const OrigPC = window.RTCPeerConnection;
  function Wrapped(...args) {
    const pc = new OrigPC(...args);
    window.__pcs.push(pc);
    return pc;
  }
  Wrapped.prototype = OrigPC.prototype;
  window.RTCPeerConnection = Wrapped;
})();
`;

async function samplePCStats(page) {
  try {
    return await page.evaluate(async () => {
      const pcs = window.__pcs || [];
      const out = [];
      for (const pc of pcs) {
        if (pc.connectionState === "closed") continue;
        const report = await pc.getStats();
        const items = [];
        report.forEach((r) => items.push(r));
        out.push({ connectionState: pc.connectionState, items });
      }
      return out;
    });
  } catch {
    return [];
  }
}

async function login(page, acc) {
  await page.goto(`${BASE_URL}/login`);
  await page.waitForTimeout(1000);
  await page.getByPlaceholder("E-mail ou nome de usuário").fill(acc.email);
  await page.getByPlaceholder("Senha").fill(acc.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(`${BASE_URL}/app`, { timeout: 20000 });
}

async function openDmWith(page, otherName) {
  await page.getByRole("button", { name: "Amigos", exact: true }).click();
  // Earlier failed runs of this script left behind several same-named
  // throwaway "FPS Audit A" accounts already friended with B -- any of them
  // is fine, they're interchangeable, so just take the first match.
  await page.getByText(otherName, { exact: true }).first().click();
  // DmChatView header only renders once the conversation is actually open.
  await page.getByTitle("Chamada de voz").waitFor({ state: "visible", timeout: 10000 });
}

async function main() {
  console.log("[1/8] Login de B (conta existente) via API...");
  const { id: bId, name: bName, sb: sbB } = await signIn(B);
  B.name = bName;

  console.log("[2/8] Abrindo 2 janelas Chromium reais (fake device p/ mic, SEM fake-ui de tela)...");
  const browserA = await chromium.launch({
    headless: false,
    args: ["--use-fake-device-for-media-stream", "--window-size=1280,900", "--window-position=0,0"],
  });
  const browserB = await chromium.launch({
    headless: false,
    args: ["--use-fake-device-for-media-stream", "--window-size=1280,900", "--window-position=1300,0"],
  });
  const ctxA = await browserA.newContext();
  const ctxB = await browserB.newContext();
  await ctxA.grantPermissions(["camera", "microphone"], { origin: BASE_URL });
  await ctxB.grantPermissions(["camera", "microphone"], { origin: BASE_URL });
  await ctxA.addInitScript(STATS_INIT_SCRIPT);
  await ctxB.addInitScript(STATS_INIT_SCRIPT);
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  console.log("[3/8] Testando o cadastro real (UI) para a conta A...");
  const signupResult = await signUpViaUI(pageA, A);
  console.log("  resultado do cadastro:", signupResult);
  if (signupResult.outcome !== "session-immediate") {
    throw new Error(
      `Cadastro não completou automaticamente (${signupResult.outcome}${
        signupResult.errorText ? ": " + signupResult.errorText : ""
      }) -- sem acesso à caixa de entrada pra confirmar OTP por e-mail.`,
    );
  }
  // Bridge the browser's real signup session into a Node-side Supabase
  // client, so ensureFriendship can run authenticated as A (RLS requires
  // the inserting session to be one of the two friendship parties).
  const authEntry = await pageA.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.includes("auth-token"));
    return key ? localStorage.getItem(key) : null;
  });
  if (!authEntry) throw new Error("Sessão de A não encontrada no localStorage após o cadastro.");
  const sessionObj = JSON.parse(authEntry);
  const sbA = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  await sbA.auth.setSession({ access_token: sessionObj.access_token, refresh_token: sessionObj.refresh_token });
  const {
    data: { user: aUser },
  } = await sbA.auth.getUser();
  const aId = aUser.id;
  console.log(`  cadastro de A concluído com sessão imediata (sem OTP). id=${aId}`);

  await ensureFriendship(sbA, aId, sbB, bId);
  console.log(`  A=${A.name} (${aId})  B=${B.name} (${bId}) -- amizade ok`);

  console.log("[3.5/8] Logando B na segunda janela (A já está logada pelo cadastro)...");
  await login(pageB, B);

  console.log("[4/8] Abrindo a conversa DM dos dois lados...");
  // pageA's friends list was fetched at signup time, before the friendship
  // existed -- reload so both sides start from a fresh query that sees it.
  await pageA.reload();
  await pageA.waitForTimeout(1500);
  await openDmWith(pageA, B.name);
  await openDmWith(pageB, A.name);

  console.log("[5/8] A abre uma aba com vídeo em movimento (será a fonte do compartilhamento)...");
  const contentPage = await ctxA.newPage();
  await contentPage.setContent(`<!doctype html><html><head><title>PEGUE ESTA ABA -- video em movimento</title></head>
  <body style="margin:0;background:#0a0a12"><canvas id="c" style="width:100vw;height:100vh;display:block"></canvas>
  <script>
    const c=document.getElementById('c'); c.width=1920; c.height=1080;
    const ctx=c.getContext('2d'); let f=0;
    function draw(){ f++; ctx.fillStyle='#0a0a12'; ctx.fillRect(0,0,c.width,c.height);
      for(let i=0;i<24;i++){ const t=f*0.03+i*0.4; const x=(Math.sin(t)*0.5+0.5)*c.width; const y=(i/24+Math.cos(t*0.7)*0.03)*c.height;
        ctx.fillStyle='hsl('+((f*2+i*15)%360)+',80%,55%)'; ctx.fillRect(x-40,y-12,80,24); }
      const bx=(Math.sin(f*0.05)*0.5+0.5)*c.width, by=(Math.cos(f*0.08)*0.5+0.5)*c.height;
      ctx.beginPath(); ctx.arc(bx,by,40,0,Math.PI*2); ctx.fillStyle='#fff'; ctx.fill();
      ctx.fillStyle='#fff'; ctx.font='48px sans-serif'; ctx.fillText('frame '+f+' t='+(performance.now()/1000).toFixed(2)+'s',20,c.height-30);
      requestAnimationFrame(draw); }
    requestAnimationFrame(draw);
  <\/script></body></html>`);
  await pageA.bringToFront();

  console.log("[6/8] A inicia a chamada de voz; B aceita...");
  await pageA.getByTitle("Chamada de voz").click();
  const bannerText = pageB.getByText(/recebida/);
  await bannerText.waitFor({ state: "visible", timeout: 20000 });
  const bannerDiv = bannerText.locator("..").locator("..");
  await bannerDiv.locator("button").last().click();
  await pageA.getByTitle("Compartilhar tela").waitFor({ state: "visible", timeout: 20000 });
  console.log("  chamada ativa nos dois lados.");

  console.log("[7/8] A clica 'Compartilhar tela' -- PRECISO QUE VOCÊ escolha 'Chrome Tab' -> a aba 'PEGUE ESTA ABA...' no picker nativo que vai abrir na janela da ESQUERDA.");
  await pageA.getByTitle("Compartilhar tela").click();
  console.log("  >>> aguardando você selecionar a aba no picker nativo (até 2 minutos)...");
  // No app-internal global to poll (unlike the bypass harness) -- the same
  // UI signal a human would see: the button's own title flips once
  // setScreenShareEnabled(true) actually resolves.
  await pageA.getByTitle("Parar de compartilhar").waitFor({ state: "visible", timeout: 120000 });
  console.log("  screen share ativo! aguardando 30s de estabilização...");
  await pageA.waitForTimeout(30000);

  console.log("[8/8] Coletando getStats() por ~30s (amostra a cada 2s)...");
  const samples = [];
  for (let i = 0; i < 15; i++) {
    const t = Date.now();
    const [statsA, statsB] = await Promise.all([samplePCStats(pageA), samplePCStats(pageB)]);
    samples.push({ t, statsA, statsB });
    await pageA.waitForTimeout(2000);
  }

  writeFileSync(path.join(RESULTS_DIR, "live-dexy-test.json"), JSON.stringify(samples, null, 2));
  console.log(`\n[done] ${samples.length} amostras salvas em scripts/fps-audit/results/live-dexy-test.json`);
  console.log("Encerrando a chamada pelo botão real e fechando os navegadores...");
  await pageA.getByTitle("Encerrar").click().catch(() => {});
  await pageA.waitForTimeout(1500);
  await browserA.close();
  await browserB.close();
}

main().catch((err) => {
  console.error("ERRO:", err);
  process.exit(1);
});
