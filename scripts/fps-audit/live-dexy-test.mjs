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
const BASE_URL = "http://localhost:8080";

// signUp() for brand-new throwaway addresses fails in this project
// ("Error sending confirmation email") -- using two already-confirmed
// accounts instead: the existing dm-bot account (already used by
// scripts/dm-bot.mjs) plus a second real account the user provided directly.
const A = { email: env.DEXY_BOT_EMAIL, password: env.DEXY_BOT_PASSWORD };
const B = { email: "ferepetido@gmail.com", password: "Felps@2712" };

async function signIn(acc) {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await sb.auth.signInWithPassword({ email: acc.email, password: acc.password });
  if (error) throw new Error(`signIn ${acc.email}: ${error.message}`);
  const { data: profile } = await sb.from("profiles").select("name").eq("id", data.user.id).single();
  return { id: data.user.id, name: profile?.name ?? acc.email, sb };
}

async function ensureFriendship(sbA, aId, bId) {
  const { data: existing } = await sbA
    .from("friendships")
    .select("user_id, friend_id, status")
    .or(`and(user_id.eq.${aId},friend_id.eq.${bId}),and(user_id.eq.${bId},friend_id.eq.${aId})`)
    .maybeSingle();
  if (existing?.status === "accepted") return;
  if (!existing) {
    const { error } = await sbA.from("friendships").insert({ user_id: aId, friend_id: bId, status: "accepted" });
    if (error) throw new Error(`friendship insert: ${error.message}`);
    return;
  }
  const { error } = await sbA
    .from("friendships")
    .update({ status: "accepted" })
    .eq("user_id", existing.user_id)
    .eq("friend_id", existing.friend_id);
  if (error) throw new Error(`friendship update: ${error.message}`);
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
  await page.getByPlaceholder("E-mail ou nome de usuário").fill(acc.email);
  await page.getByPlaceholder("Senha").fill(acc.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(`${BASE_URL}/app`, { timeout: 20000 });
}

async function openDmWith(page, otherName) {
  await page.getByRole("button", { name: "Amigos", exact: true }).click();
  await page.getByText(otherName, { exact: true }).click();
  // DmChatView header only renders once the conversation is actually open.
  await page.getByTitle("Chamada de voz").waitFor({ state: "visible", timeout: 10000 });
}

async function main() {
  console.log("[1/8] Autenticando as 2 contas existentes...");
  const { id: aId, name: aName, sb: sbA } = await signIn(A);
  const { id: bId, name: bName } = await signIn(B);
  A.name = aName;
  B.name = bName;
  await ensureFriendship(sbA, aId, bId);
  console.log(`  A=${A.name} (${aId})  B=${B.name} (${bId}) -- amizade ok`);

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

  console.log("[3/8] Logando as 2 contas...");
  await login(pageA, A);
  await login(pageB, B);

  console.log("[4/8] Abrindo a conversa DM dos dois lados...");
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
