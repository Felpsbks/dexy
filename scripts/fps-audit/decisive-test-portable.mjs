// Fase 7.6 -- teste decisivo Capture vs WebRTC, versão portátil (roda fora
// do repo, sem Supabase/Auth/banco -- só precisa das 3 credenciais LiveKit).
// Mede a MESMA MediaStreamTrack em 5 pontos, sem recriar a captura entre
// eles: (1) crua antes de qualquer WebRTC, (2) a mesma track enquanto
// publicada, (3) outbound-rtp.framesEncoded, (4) inbound-rtp.framesDecoded,
// (5) FPS renderizado (getVideoPlaybackQuality) do lado que assina.
//
// IMPORTANTE sobre a flag --use-fake-ui-for-media-stream: ela faz
// preferCurrentTab cair sempre em "tela inteira" (confirmado empiricamente
// na Máquina A) -- por isso os cenários de AUTOMATIC evitam essa flag pros
// modos de aba (preferCurrentTab funciona sozinho, sem picker, sem clique
// humano) e só a usam no modo "tela inteira" (onde ela autosseleciona
// screen:0:0 de forma confiável e também sem picker).
import { createServer } from "node:http";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { AccessToken } from "livekit-server-sdk";

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
let envPath = path.join(__dirname, ".env");
try {
  readFileSync(envPath);
} catch {
  envPath = path.join(ROOT, ".env");
}
const env = loadEnv(envPath);
const LIVEKIT_URL = env.VITE_LIVEKIT_URL;
const LIVEKIT_API_KEY = env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = env.LIVEKIT_API_SECRET;
if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  throw new Error("Faltam credenciais LiveKit -- copie .env.example para .env e preencha.");
}

const PORT = 8945;
const server = createServer((req, res) => {
  let p = (req.url === "/" ? "/index.html" : req.url).split("?")[0];
  const filePath = path.join(__dirname, p);
  try {
    const data = readFileSync(filePath);
    res.writeHead(200, { "content-type": p.endsWith(".js") ? "application/javascript" : "text/html" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(PORT, r));

async function mintToken(room, identity, canPublish) {
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity, ttl: "10m" });
  at.addGrant({ room, roomJoin: true, canPublish, canSubscribe: true });
  return at.toJwt();
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

async function samplePCStats(page) {
  return page.evaluate(async () => {
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
  }).catch(() => []);
}
function findVideoRTP(statsArrOfArrays, type) {
  let best = null;
  for (const items of statsArrOfArrays) {
    for (const item of items) {
      if (item.type !== type || item.kind !== "video") continue;
      const score = (item.framesPerSecond ?? 0) * 1e9 + (item.bytesSent ?? item.bytesReceived ?? 0);
      if (!best || score > best.score) best = item;
    }
  }
  return best;
}
function findCodecMime(statsArrOfArrays, codecId) {
  for (const items of statsArrOfArrays) {
    const c = items.find((i) => i.type === "codec" && i.id === codecId);
    if (c) return c.mimeType;
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

async function runOne(scenario) {
  console.log(`\n=== ${scenario.label} ===`);
  const roomName = `decisiveB-${scenario.id}-${Date.now()}`;
  const pubToken = await mintToken(roomName, "probe-pub", true);
  const subToken = await mintToken(roomName, "probe-sub", false);

  const pubArgs = ["--window-size=1920,1080", "--window-position=0,0"];
  if (scenario.mode === "screen") pubArgs.push("--use-fake-ui-for-media-stream");
  const pubBrowser = await chromium.launch({ headless: false, args: pubArgs });
  const subBrowser = await chromium.launch({
    headless: false,
    args: ["--autoplay-policy=no-user-gesture-required", "--window-size=640,480", "--window-position=1950,0"],
  });
  const pubPage = await pubBrowser.newPage();
  await pubPage.addInitScript(STATS_INIT_SCRIPT);
  const subPage = await subBrowser.newPage();
  await subPage.addInitScript(STATS_INIT_SCRIPT);
  await pubPage.goto(`http://localhost:${PORT}/index.html`);
  await pubPage.waitForFunction("window.__harnessReady === true");
  await subPage.goto(`http://localhost:${PORT}/index.html`);
  await subPage.waitForFunction("window.__harnessReady === true");

  await subPage.evaluate(([url, token]) => window.__harness.connect(url, token), [LIVEKIT_URL, subToken]);

  const rawBaseline = await pubPage.evaluate(
    async ({ resolution, preferCurrentTab }) => {
      window.__harness.startAnimatedCanvas();
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: resolution.width, height: resolution.height, frameRate: resolution.frameRate },
        preferCurrentTab,
      });
      const track = stream.getVideoTracks()[0];
      track.contentHint = "motion";
      window.__rawTrack = track;
      window.__rawStream = stream;

      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      video.play();
      window.__rawFrameCount = 0;
      window.__rawRunning = true;
      function onFrame() {
        window.__rawFrameCount++;
        if (window.__rawRunning) video.requestVideoFrameCallback(onFrame);
      }
      video.requestVideoFrameCallback(onFrame);

      await new Promise((r) => setTimeout(r, 1000));
      const t0 = performance.now();
      const c0 = window.__rawFrameCount;
      await new Promise((r) => setTimeout(r, 6000));
      const fps = (window.__rawFrameCount - c0) / ((performance.now() - t0) / 1000);
      return { settings: track.getSettings(), rawFpsBaseline: fps };
    },
    { resolution: scenario.resolution, preferCurrentTab: scenario.mode === "tab" },
  );
  console.log(
    "  Capture antes do RTCPeerConnection:", rawBaseline.rawFpsBaseline.toFixed(2), "fps  |  deviceId:",
    rawBaseline.settings.deviceId, "| displaySurface:", rawBaseline.settings.displaySurface,
  );

  await pubPage.evaluate(([url, token]) => window.__harness.connect(url, token), [LIVEKIT_URL, pubToken]);
  await pubPage.evaluate(
    ({ encoding }) => window.__harness.publishRawTrack(window.__rawTrack, encoding),
    { encoding: scenario.encoding },
  );

  await pubPage.waitForTimeout(6000); // ramp-up

  const rawT0 = await pubPage.evaluate(() => ({ t: performance.now(), c: window.__rawFrameCount }));
  const samples = [];
  for (let i = 0; i < 8; i++) {
    const t = Date.now();
    const [pubStats, subStats, renderStats] = await Promise.all([
      samplePCStats(pubPage),
      samplePCStats(subPage),
      subPage.evaluate(() => window.__harness.getRenderStats()).catch(() => null),
    ]);
    samples.push({ t, pubStats, subStats, renderStats });
    await pubPage.waitForTimeout(2000);
  }
  const rawT1 = await pubPage.evaluate(() => ({ t: performance.now(), c: window.__rawFrameCount }));
  const rawFpsWhilePublishing = (rawT1.c - rawT0.c) / ((rawT1.t - rawT0.t) / 1000);

  const outFirst = findVideoRTP(samples[0].pubStats, "outbound-rtp");
  const outLast = findVideoRTP(samples[samples.length - 1].pubStats, "outbound-rtp");
  const inFirst = findVideoRTP(samples[0].subStats, "inbound-rtp");
  const inLast = findVideoRTP(samples[samples.length - 1].subStats, "inbound-rtp");
  const dt = (samples[samples.length - 1].t - samples[0].t) / 1000;
  const encodeFps = outFirst && outLast ? (outLast.framesEncoded - outFirst.framesEncoded) / dt : null;
  const decodeFps = inFirst && inLast ? (inLast.framesDecoded - inFirst.framesDecoded) / dt : null;

  const renderFirst = samples.find((s) => s.renderStats?.totalVideoFrames != null)?.renderStats;
  const renderLast = [...samples].reverse().find((s) => s.renderStats?.totalVideoFrames != null)?.renderStats;
  const renderFps = renderFirst && renderLast ? (renderLast.totalVideoFrames - renderFirst.totalVideoFrames) / dt : null;

  const jitterVals = samples.map((s) => findVideoRTP(s.subStats, "inbound-rtp")?.jitter).filter((v) => typeof v === "number");
  const rttVals = samples.map((s) => findActiveRTT(s.pubStats)).filter((v) => typeof v === "number");

  const result = {
    scenario: scenario.id,
    label: scenario.label,
    deviceId: rawBaseline.settings.deviceId,
    displaySurface: rawBaseline.settings.displaySurface,
    captureFpsBeforeWebRTC: rawBaseline.rawFpsBaseline,
    sameTrackFpsWhilePublished: rawFpsWhilePublishing,
    outboundEncodeFps: encodeFps,
    inboundDecodeFps: decodeFps,
    renderFps,
    resolutionSent: outLast ? `${outLast.frameWidth}x${outLast.frameHeight}` : null,
    bitrateKbps: outFirst && outLast ? ((outLast.bytesSent - outFirst.bytesSent) * 8) / dt / 1000 : null,
    codec: findCodecMime(samples[samples.length - 1].pubStats, outLast?.codecId),
    qualityLimitationReason: outLast?.qualityLimitationReason,
    packetsLost: inLast?.packetsLost,
    jitterMs: jitterVals.length ? (jitterVals.reduce((a, b) => a + b, 0) / jitterVals.length) * 1000 : null,
    rttMs: rttVals.length ? rttVals.reduce((a, b) => a + b, 0) / rttVals.length : null,
  };
  console.log("  " + JSON.stringify(result, null, 2).replace(/\n/g, "\n  "));

  await pubBrowser.close().catch(() => {});
  await subBrowser.close().catch(() => {});
  return result;
}

const SCENARIOS = [
  {
    id: "tab_1080p60",
    label: "Aba + canvas, 1080p60",
    mode: "tab",
    resolution: { width: 1920, height: 1080, frameRate: 60 },
    encoding: { maxBitrate: 8_000_000, maxFramerate: 60 },
  },
  {
    id: "tab_720p60",
    label: "Aba + canvas, 720p60",
    mode: "tab",
    resolution: { width: 1280, height: 720, frameRate: 60 },
    encoding: { maxBitrate: 5_000_000, maxFramerate: 60 },
  },
  {
    id: "tab_1080p120",
    label: "Aba + canvas, 1080p120",
    mode: "tab",
    resolution: { width: 1920, height: 1080, frameRate: 120 },
    encoding: { maxBitrate: 12_000_000, maxFramerate: 120 },
  },
  {
    id: "screen_1080p60",
    label: "Tela inteira + canvas, 1080p60",
    mode: "screen",
    resolution: { width: 1920, height: 1080, frameRate: 60 },
    encoding: { maxBitrate: 8_000_000, maxFramerate: 60 },
  },
];

const all = [];
for (const s of SCENARIOS) all.push(await runOne(s));
writeFileSync(path.join(RESULTS_DIR, "decisive-maquinaB.json"), JSON.stringify(all, null, 2));
server.close();

console.log("\n\n=== RESUMO (a tabela que importa) ===");
console.log(
  "cenário".padEnd(18),
  "capture".padEnd(10),
  "track+webrtc".padEnd(14),
  "outbound".padEnd(10),
  "inbound".padEnd(10),
  "render",
);
for (const r of all) {
  console.log(
    r.scenario.padEnd(18),
    r.captureFpsBeforeWebRTC.toFixed(1).padEnd(10),
    r.sameTrackFpsWhilePublished.toFixed(1).padEnd(14),
    (r.outboundEncodeFps?.toFixed(1) ?? "?").padEnd(10),
    (r.inboundDecodeFps?.toFixed(1) ?? "?").padEnd(10),
    r.renderFps?.toFixed(1) ?? "?",
  );
}
console.log("\n[done] scripts/fps-audit/results/decisive-maquinaB.json (ou pasta results/ na exportação)");
