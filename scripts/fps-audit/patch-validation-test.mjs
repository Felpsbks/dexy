// Fase 7.6 -- validação funcional completa do patch (fixScreenShareEncoding
// em src/lib/livekit.ts, NÃO commitado) através do app real (dev server),
// login real, chamada de vídeo real, botão "Compartilhar tela" real.
//
// --use-fake-ui-for-media-stream fica ligado desta vez (diferente do teste
// anterior): sem preferCurrentTab no código do Dexy, isso faz o picker
// nativo se resolver sozinho pra "tela inteira" -- automatiza start/stop/
// restart/swap sem precisar de clique humano repetido. Já confirmamos numa
// rodada anterior que o fix não depende do modo de captura (aba vs tela),
// então isso é uma escolha de velocidade, não de validade.
//
// Rode com NEGATIVE_TEST=1 pra validar o fallback: força
// RTCRtpSender.prototype.setParameters a rejeitar sempre, e confirma que o
// screen share ainda assim inicia e funciona (só sem a correção de FPS).
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const RESULTS_DIR = path.join(__dirname, "results");
mkdirSync(RESULTS_DIR, { recursive: true });
const NEGATIVE_TEST = !!process.env.NEGATIVE_TEST;

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
const BASE_URL = "http://localhost:8081";

const TS = Date.now();
const A = {
  email: `fps-audit-a-${TS}@example.com`,
  password: `FpsAudit!2026a${TS}`,
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
  function Wrapped(...args) { const pc = new OrigPC(...args); window.__pcs.push(pc); return pc; }
  Wrapped.prototype = OrigPC.prototype;
  window.RTCPeerConnection = Wrapped;
})();
`;
// Negative-test fault injection: RTCRtpSender.setParameters always rejects,
// simulating "the API isn't available/fails" -- installed BEFORE any app
// code runs, so it's in effect for the real fixScreenShareEncoding() call.
const GDM_TRACE_SCRIPT = `
(() => {
  window.__gdmCallCount = 0;
  window.__gdmLog = [];
  const orig = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getDisplayMedia = function(opts) {
    window.__gdmCallCount++;
    window.__gdmLog.push({ event: "called", opts: JSON.stringify(opts) });
    console.log("[GDM-TRACE] called with", JSON.stringify(opts));
    const p = orig(opts);
    p.then(
      (s) => { window.__gdmLog.push({ event: "resolved", tracks: s.getTracks().map(t => t.kind) }); console.log("[GDM-TRACE] resolved"); },
      (e) => { window.__gdmLog.push({ event: "rejected", name: e && e.name, message: e && e.message }); console.log("[GDM-TRACE] rejected:", e && e.name, e && e.message); },
    );
    return p;
  };
  window.__gdmWrapped = true;
})();
`;
const FAULT_INJECT_SCRIPT = `
(() => {
  const orig = RTCRtpSender.prototype.setParameters;
  RTCRtpSender.prototype.setParameters = function(...args) {
    return Promise.reject(new Error("[injected fault] setParameters disabled for negative test"));
  };
  window.__faultInjected = true;
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
        out.push(items);
      }
      return out;
    });
  } catch {
    return [];
  }
}
// Video call + screen share means TWO video streams exist simultaneously
// (camera and screen share) -- screen share is requested at 1920x1080
// while the fake camera device delivers its own (much smaller) native
// resolution regardless of what's requested, so frameWidth is a reliable
// discriminator here, unlike a pure fps/bytes score which can grab
// whichever stream happens to be active in a given sample.
function findVideoRTP(statsArrOfArrays, type, { wideOnly = false } = {}) {
  let best = null;
  for (const items of statsArrOfArrays) {
    for (const item of items) {
      if (item.type !== type || item.kind !== "video") continue;
      if (wideOnly && (!item.frameWidth || item.frameWidth < 1500)) continue;
      const score = (item.framesPerSecond ?? 0) * 1e9 + (item.bytesSent ?? item.bytesReceived ?? 0);
      if (!best || score > best.score) best = item;
    }
  }
  return best;
}
// Native DOM click -- Playwright's synthetic pointer-event click() didn't
// register with these specific React handlers (confirmed: button visible +
// enabled, click() resolved with no error, but the onClick never fired and
// getDisplayMedia was never called). Dispatching el.click() directly via
// page.evaluate works reliably instead.
async function nativeClick(page, title) {
  const clicked = await page.evaluate((t) => {
    const el = document.querySelector(`[title="${t}"]`);
    if (!el) return false;
    el.click();
    return true;
  }, title);
  if (!clicked) throw new Error(`nativeClick: nenhum elemento com title="${title}" encontrado`);
}
function findAudioOutbound(statsArrOfArrays) {
  for (const items of statsArrOfArrays) {
    const a = items.find((i) => i.type === "outbound-rtp" && i.kind === "audio");
    if (a) return a;
  }
  return null;
}
function findActiveRTT(statsArrOfArrays) {
  for (const items of statsArrOfArrays) {
    for (const item of items) {
      if (item.type === "candidate-pair" && item.state === "succeeded" && typeof item.currentRoundTripTime === "number") {
        return item.currentRoundTripTime * 1000;
      }
    }
  }
  return null;
}
async function getSenderParams(page) {
  return page.evaluate(() => {
    // Camera + screen share are two separate video senders once a video
    // call is active with both published -- return every video sender's
    // params (labeled by track) rather than guessing which is which here.
    const all = [];
    for (const pc of window.__pcs || []) {
      for (const sender of pc.getSenders()) {
        if (!sender.track || sender.track.kind !== "video") continue;
        try {
          const p = sender.getParameters();
          all.push({ trackLabel: sender.track.label, encodings: p.encodings });
        } catch (e) {
          all.push({ trackLabel: sender.track?.label, error: String(e) });
        }
      }
    }
    return all;
  });
}
async function measureWindow(pageA, pageB, seconds = 12) {
  const n = Math.max(2, Math.round(seconds / 2));
  const samples = [];
  for (let i = 0; i < n; i++) {
    const t = Date.now();
    const [statsA, statsB] = await Promise.all([samplePCStats(pageA), samplePCStats(pageB)]);
    samples.push({ t, statsA, statsB });
    await pageA.waitForTimeout(2000);
  }
  // wideOnly=true picks the screen-share stream specifically (1920px+),
  // not whichever of camera/screen-share happens to score higher.
  const outFirst = findVideoRTP(samples[0].statsA, "outbound-rtp", { wideOnly: true });
  const outLast = findVideoRTP(samples[samples.length - 1].statsA, "outbound-rtp", { wideOnly: true });
  const inFirst = findVideoRTP(samples[0].statsB, "inbound-rtp", { wideOnly: true });
  const inLast = findVideoRTP(samples[samples.length - 1].statsB, "inbound-rtp", { wideOnly: true });
  const dt = (samples[samples.length - 1].t - samples[0].t) / 1000;
  const jitterVals = samples.map((s) => findVideoRTP(s.statsB, "inbound-rtp", { wideOnly: true })?.jitter).filter((v) => typeof v === "number");
  const rttVals = samples.map((s) => findActiveRTT(s.statsA)).filter((v) => typeof v === "number");
  const audioOut = findAudioOutbound(samples[samples.length - 1].statsA);
  return {
    encodeFps: outFirst && outLast ? (outLast.framesEncoded - outFirst.framesEncoded) / dt : null,
    decodeFps: inFirst && inLast ? (inLast.framesDecoded - inFirst.framesDecoded) / dt : null,
    resSent: outLast ? `${outLast.frameWidth}x${outLast.frameHeight}` : null,
    bitrateKbps: outFirst && outLast ? ((outLast.bytesSent - outFirst.bytesSent) * 8) / dt / 1000 : null,
    qualityLimitationReason: outLast?.qualityLimitationReason ?? null,
    packetsLost: inLast?.packetsLost ?? null,
    jitterMs: jitterVals.length ? (jitterVals.reduce((a, b) => a + b, 0) / jitterVals.length) * 1000 : null,
    rttMs: rttVals.length ? rttVals.reduce((a, b) => a + b, 0) / rttVals.length : null,
    audioFlowing: !!audioOut && audioOut.bytesSent > 0,
    audioPacketsSent: audioOut?.packetsSent ?? null,
  };
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
  await page.getByText(otherName, { exact: true }).first().click();
  await page.getByTitle("Chamada de voz").waitFor({ state: "visible", timeout: 10000 });
}

async function main() {
  console.log(`Modo: ${NEGATIVE_TEST ? "TESTE NEGATIVO (setParameters forçado a falhar)" : "TESTE POSITIVO COMPLETO"}`);
  console.log("[1] Login de B via API...");
  const { id: bId, name: bName, sb: sbB } = await signIn(B);
  B.name = bName;

  console.log("[2] Abrindo janelas Chromium reais (fake device p/ mic+câmera, fake-ui p/ tela inteira automática)...");
  // fake-ui + audio:true works fine in isolation (verified separately,
  // resolves in ~250ms) -- restored here with console/pageerror listeners
  // added below to find out what's different about the real app's context.
  const pubArgs = [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--window-size=1280,900",
    "--window-position=0,0",
  ];
  const browserA = await chromium.launch({ headless: false, args: pubArgs });
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
  await ctxA.addInitScript(GDM_TRACE_SCRIPT);
  if (NEGATIVE_TEST) await ctxA.addInitScript(FAULT_INJECT_SCRIPT);
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  pageA.on("console", (msg) => {
    if (msg.type() === "error" || /screenshare|screen.?share|setParameters|sender|GDM-TRACE/i.test(msg.text())) {
      console.log(`  [pageA console:${msg.type()}]`, msg.text());
    }
  });
  pageA.on("pageerror", (err) => console.log("  [pageA pageerror]", err.message));

  console.log("[3] Cadastro real (UI) para a conta A...");
  const signupResult = await signUpViaUI(pageA, A);
  if (signupResult.outcome !== "session-immediate") {
    throw new Error(`Cadastro não completou (${signupResult.outcome}: ${signupResult.errorText ?? ""})`);
  }
  const authEntry = await pageA.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.includes("auth-token"));
    return key ? localStorage.getItem(key) : null;
  });
  const sessionObj = JSON.parse(authEntry);
  const sbA = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  await sbA.auth.setSession({ access_token: sessionObj.access_token, refresh_token: sessionObj.refresh_token });
  const { data: { user: aUser } } = await sbA.auth.getUser();
  const aId = aUser.id;
  await ensureFriendship(sbA, aId, sbB, bId);
  console.log(`  A=${A.name}  B=${B.name} -- amizade ok`);

  console.log("[4] Login de B + abrir DM dos dois lados...");
  await login(pageB, B);
  await pageA.reload();
  await pageA.waitForTimeout(1500);
  await openDmWith(pageA, B.name);
  await openDmWith(pageB, A.name);

  console.log("[5] Aba com conteúdo em movimento (fonte real da tela compartilhada)...");
  const contentPage = await ctxA.newPage();
  await contentPage.setContent(`<!doctype html><title>conteudo-movimento</title>
  <body style="margin:0;background:#0a0a12"><canvas id="c" style="width:100vw;height:100vh;display:block"></canvas>
  <script>
    const c=document.getElementById('c'); c.width=1920; c.height=1080;
    const ctx=c.getContext('2d'); let f=0;
    function draw(){ f++; ctx.fillStyle='#0a0a12'; ctx.fillRect(0,0,c.width,c.height);
      for(let i=0;i<24;i++){ const t=f*0.03+i*0.4; const x=(Math.sin(t)*0.5+0.5)*c.width; const y=(i/24+Math.cos(t*0.7)*0.03)*c.height;
        ctx.fillStyle='hsl('+((f*2+i*15)%360)+',80%,55%)'; ctx.fillRect(x-40,y-12,80,24); }
      requestAnimationFrame(draw); }
    requestAnimationFrame(draw);
  <\/script>`);
  await contentPage.bringToFront();
  await pageA.bringToFront();

  console.log("[6] A inicia chamada de VÍDEO; B aceita...");
  await pageA.getByTitle("Chamada de vídeo").click();
  const bannerText = pageB.getByText(/recebida/);
  await bannerText.waitFor({ state: "visible", timeout: 20000 });
  await bannerText.locator("..").locator("..").locator("button").last().click();
  await pageA.getByTitle("Compartilhar tela").waitFor({ state: "visible", timeout: 20000 });
  console.log("  chamada de vídeo ativa nos dois lados (câmera fake publicando). Aguardando UI estabilizar...");
  await pageA.waitForTimeout(4000);

  const report = { negativeTest: NEGATIVE_TEST, steps: {} };

  console.log("[7] Iniciando compartilhamento de tela (1080p, padrão)...");
  await nativeClick(pageA, "Compartilhar tela");
  await pageA.waitForTimeout(500);
  const gdmAfterClick = await pageA.evaluate(() => window.__gdmLog);
  console.log("  gdmLog imediatamente após o clique:", JSON.stringify(gdmAfterClick));
  try {
    await pageA.getByTitle("Parar de compartilhar").waitFor({ state: "visible", timeout: 20000 });
  } catch (err) {
    await pageA.screenshot({ path: path.join(RESULTS_DIR, "debug-screenshare-timeout.png") });
    const allTitles = await pageA.evaluate(() =>
      Array.from(document.querySelectorAll("[title]")).map((el) => el.getAttribute("title")),
    );
    const bodyText = await pageA.evaluate(() => document.body.innerText);
    const errorish = bodyText.split("\n").filter((l) => /erro|permiss|não foi poss|bloque/i.test(l));
    console.log("  todos os [title] na página:", JSON.stringify(allTitles));
    console.log("  linhas suspeitas de erro no texto da página:", JSON.stringify(errorish));
    console.log("  screenshot salvo em results/debug-screenshare-timeout.png pra diagnóstico");
    throw err;
  }
  console.log("  screen share iniciou normalmente. Aguardando estabilização (8s)...");
  await pageA.waitForTimeout(8000);

  console.log("[8] Medindo por ~12s (primeira publicação)...");
  report.steps.firstShare = await measureWindow(pageA, pageB, 12);
  report.steps.firstShareSenderParams = await getSenderParams(pageA);
  console.log("  " + JSON.stringify(report.steps.firstShare, null, 2).replace(/\n/g, "\n  "));
  console.log("  sender params (todas as tracks de vídeo):", JSON.stringify(report.steps.firstShareSenderParams));

  console.log("[9] Parando o compartilhamento...");
  await nativeClick(pageA, "Parar de compartilhar");
  await pageA.getByTitle("Compartilhar tela").waitFor({ state: "visible", timeout: 10000 });
  report.steps.stoppedOk = true;
  console.log("  parou normalmente (botão voltou a 'Compartilhar tela').");

  console.log("[10] Iniciando de novo...");
  await nativeClick(pageA, "Compartilhar tela");
  await pageA.getByTitle("Parar de compartilhar").waitFor({ state: "visible", timeout: 20000 });
  await pageA.waitForTimeout(6000);
  report.steps.restarted = await measureWindow(pageA, pageB, 10);
  console.log("  reiniciar: encodeFps=" + report.steps.restarted.encodeFps?.toFixed(1));

  console.log("[11] Trocando de tela (swap) enquanto já compartilha...");
  const swapClicked = await pageA.getByText("Trocar tela").isVisible().catch(() => false);
  if (swapClicked) {
    await pageA.evaluate(() => {
      const el = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Trocar tela");
      el?.click();
    });
    await pageA.waitForTimeout(2000);
    await pageA.getByTitle("Parar de compartilhar").waitFor({ state: "visible", timeout: 20000 });
    await pageA.waitForTimeout(6000);
    report.steps.afterSwap = await measureWindow(pageA, pageB, 10);
    console.log("  troca de tela: encodeFps=" + report.steps.afterSwap.encodeFps?.toFixed(1));
  } else {
    report.steps.afterSwap = { skipped: true, reason: "botão 'Trocar tela' não encontrado" };
    console.log("  AVISO: botão 'Trocar tela' não encontrado, pulando esse passo.");
  }

  console.log("[12] Testando câmera OFF/ON e mic OFF/ON durante o compartilhamento...");
  await nativeClick(pageA, "Câmera");
  await pageA.waitForTimeout(1500);
  await nativeClick(pageA, "Câmera");
  await pageA.waitForTimeout(1500);
  await nativeClick(pageA, "Microfone");
  await pageA.waitForTimeout(1500);
  await nativeClick(pageA, "Microfone");
  await pageA.waitForTimeout(1500);
  const stillSharing = await pageA.getByTitle("Parar de compartilhar").isVisible().catch(() => false);
  const stillInCall = await pageA.getByTitle("Encerrar").isVisible().catch(() => false);
  report.steps.toggleCameraMicNoRegression = { stillSharing, stillInCall };
  console.log("  depois de togglar câmera/mic: aindaCompartilhando=" + stillSharing + " aindaEmChamada=" + stillInCall);

  writeFileSync(
    path.join(RESULTS_DIR, NEGATIVE_TEST ? "patch-validation-negative.json" : "patch-validation-positive.json"),
    JSON.stringify(report, null, 2),
  );
  console.log("\n[done] resultado salvo em scripts/fps-audit/results/");

  await nativeClick(pageA, "Encerrar").catch(() => {});
  await pageA.waitForTimeout(1500);
  await browserA.close();
  await browserB.close();
}

main().catch((err) => {
  console.error("ERRO:", err);
  process.exit(1);
});
