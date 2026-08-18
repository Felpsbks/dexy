// Fase 7.6 -- varredura final 60/75/90/120fps MANTENDO o teto de bitrate
// atual de produção (7 Mbps, igual a SCREEN_SHARE_QUALITIES["1080p"] em
// src/lib/livekit.ts) -- objetivo: descobrir se 7 Mbps é suficiente pro
// fix de FPS (sender.setParameters() pós-publish) sem precisar subir o
// teto de bitrate. Mede tudo que o teste anterior media + RTT + jitter.
import { createServer } from "node:http";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
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
const env = loadEnv(path.join(ROOT, ".env"));
const LIVEKIT_URL = env.VITE_LIVEKIT_URL;
const LIVEKIT_API_KEY = env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = env.LIVEKIT_API_SECRET;

const PROD_MAX_BITRATE = 7_000_000; // SCREEN_SHARE_QUALITIES["1080p"].encoding.maxBitrate, unchanged

const PORT = 8948;
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

function totalChromeCpuSeconds() {
  try {
    const out = execSync(
      'powershell -NoProfile -Command "(Get-Process chrome -ErrorAction SilentlyContinue | Measure-Object CPU -Sum).Sum"',
      { encoding: "utf8" },
    ).trim();
    const n = parseFloat(out);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

async function runOne(scenario) {
  console.log(`\n=== ${scenario.label} ===`);
  const roomName = `sweep7-${scenario.id}-${Date.now()}`;
  const pubToken = await mintToken(roomName, "probe-pub", true);
  const subToken = await mintToken(roomName, "probe-sub", false);

  const pubBrowser = await chromium.launch({ headless: false, args: ["--window-size=1920,1080", "--window-position=0,0"] });
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

  const captureResult = await pubPage.evaluate(
    async ({ fps }) => {
      window.__harness.startAnimatedCanvas();
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: 1920, height: 1080, frameRate: fps },
        preferCurrentTab: true,
      });
      const track = stream.getVideoTracks()[0];
      track.contentHint = "motion";
      window.__rawTrack = track;

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
      await new Promise((r) => setTimeout(r, 4000));
      const captureFps = (window.__rawFrameCount - c0) / ((performance.now() - t0) / 1000);
      return { settings: track.getSettings(), captureFps };
    },
    { fps: scenario.fps },
  );

  await pubPage.evaluate(([url, token]) => window.__harness.connect(url, token), [LIVEKIT_URL, pubToken]);
  // Publish exactly like production does: maxBitrate = 7_000_000 (unchanged).
  await pubPage.evaluate(
    ({ encoding }) => window.__harness.publishRawTrack(window.__rawTrack, encoding),
    { encoding: { maxBitrate: PROD_MAX_BITRATE, maxFramerate: scenario.fps } },
  );
  await pubPage.waitForTimeout(2000);

  // The fix under test: public API, reapply maxFramerate -- maxBitrate left
  // at the SAME 7 Mbps value (not raised), per this round's explicit ask.
  const senderFix = await pubPage.evaluate(async ({ fps, maxBitrate }) => {
    const sender = window.__harness.getScreenShareSender();
    if (!sender) return { ok: false, error: "no publication/sender found via public API" };
    const params = sender.getParameters();
    const before = { maxFramerate: params.encodings?.[0]?.maxFramerate, maxBitrate: params.encodings?.[0]?.maxBitrate };
    if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
    params.encodings[0].maxFramerate = fps;
    params.encodings[0].maxBitrate = maxBitrate; // reasserted at the SAME 7Mbps, not raised
    await sender.setParameters(params);
    const after = sender.getParameters();
    return {
      ok: true,
      before,
      after: { maxFramerate: after.encodings?.[0]?.maxFramerate, maxBitrate: after.encodings?.[0]?.maxBitrate },
    };
  }, { fps: scenario.fps, maxBitrate: PROD_MAX_BITRATE });
  console.log("  sender.setParameters() via API pública:", JSON.stringify(senderFix));

  await pubPage.waitForTimeout(5000); // settle

  const cpu0 = totalChromeCpuSeconds();
  const t0 = Date.now();
  const rawT0 = await pubPage.evaluate(() => window.__rawFrameCount);
  const samples = [];
  for (let i = 0; i < 6; i++) {
    const t = Date.now();
    const [pubStats, subStats, renderStats] = await Promise.all([
      samplePCStats(pubPage),
      samplePCStats(subPage),
      subPage.evaluate(() => window.__harness.getRenderStats()).catch(() => null),
    ]);
    samples.push({ t, pubStats, subStats, renderStats });
    await pubPage.waitForTimeout(2000);
  }
  const cpu1 = totalChromeCpuSeconds();
  const t1 = Date.now();
  const rawT1 = await pubPage.evaluate(() => window.__rawFrameCount);
  const windowSec = (t1 - t0) / 1000;
  const captureFpsDuringMeasurement = (rawT1 - rawT0) / windowSec;
  const cpuSecondsUsed = cpu0 != null && cpu1 != null ? cpu1 - cpu0 : null;

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
    requestedFps: scenario.fps,
    prodMaxBitrate: PROD_MAX_BITRATE,
    deviceId: captureResult.settings.deviceId,
    captureFpsDuringMeasurement,
    senderBeforeFix: senderFix.before,
    senderAfterFix: senderFix.after,
    encodeFps,
    decodeFps,
    renderFps,
    resSent: outLast ? `${outLast.frameWidth}x${outLast.frameHeight}` : null,
    bitrateKbps: outFirst && outLast ? ((outLast.bytesSent - outFirst.bytesSent) * 8) / dt / 1000 : null,
    codec: findCodecMime(samples[samples.length - 1].pubStats, outLast?.codecId),
    qualityLimitationReason: outLast?.qualityLimitationReason,
    qualityLimitationDurations: outLast?.qualityLimitationDurations,
    packetsLost: inLast?.packetsLost,
    jitterMs: jitterVals.length ? (jitterVals.reduce((a, b) => a + b, 0) / jitterVals.length) * 1000 : null,
    rttMs: rttVals.length ? rttVals.reduce((a, b) => a + b, 0) / rttVals.length : null,
    cpuCoresEquivalent: cpuSecondsUsed != null ? cpuSecondsUsed / windowSec : null,
  };
  console.log("  " + JSON.stringify(result, null, 2).replace(/\n/g, "\n  "));

  await pubBrowser.close().catch(() => {});
  await subBrowser.close().catch(() => {});
  return result;
}

const SCENARIOS = [60, 75, 90, 120].map((fps) => ({
  id: `sweep7_${fps}`,
  fps,
  label: `Screen share ${fps}fps + 7Mbps (teto de produção inalterado) + setParameters() pós-publish`,
}));

const all = [];
for (const s of SCENARIOS) all.push(await runOne(s));
writeFileSync(path.join(RESULTS_DIR, "fps-sweep-7mbps.json"), JSON.stringify(all, null, 2));
server.close();

console.log("\n\n=== TABELA FINAL (7 Mbps fixo) ===");
console.log(
  "pedido".padEnd(8), "capture".padEnd(9), "encode".padEnd(8), "decode".padEnd(8), "render".padEnd(8),
  "bitrate".padEnd(10), "loss".padEnd(6), "jitter".padEnd(9), "rtt".padEnd(8), "cpu".padEnd(6), "qlr",
);
for (const r of all) {
  console.log(
    String(r.requestedFps).padEnd(8),
    r.captureFpsDuringMeasurement.toFixed(1).padEnd(9),
    (r.encodeFps?.toFixed(1) ?? "?").padEnd(8),
    (r.decodeFps?.toFixed(1) ?? "?").padEnd(8),
    (r.renderFps?.toFixed(1) ?? "?").padEnd(8),
    `${r.bitrateKbps?.toFixed(0) ?? "?"}kbps`.padEnd(10),
    String(r.packetsLost ?? "?").padEnd(6),
    `${r.jitterMs?.toFixed(1) ?? "?"}ms`.padEnd(9),
    `${r.rttMs?.toFixed(1) ?? "?"}ms`.padEnd(8),
    (r.cpuCoresEquivalent?.toFixed(2) ?? "?").padEnd(6),
    r.qualityLimitationReason,
  );
}
console.log("\n[done] scripts/fps-audit/results/fps-sweep-7mbps.json");
