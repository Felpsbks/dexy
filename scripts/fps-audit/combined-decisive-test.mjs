// Fase 7.6 -- teste definitivo Capture vs Encode: UMA MESMA MediaStreamTrack
// é medida (a) crua, via requestVideoFrameCallback, ANTES de qualquer WebRTC
// existir, e (b) através do pipeline real do livekit-client (publishTrack +
// outbound-rtp/inbound-rtp) DEPOIS, na mesma track, no mesmo processo, sem
// gap de tempo relevante. Se (a) ficar alto e (b) cair, o teto está no
// Encode/publish (RTCRtpSender/VP8), não na Captura.
// IMPORTANTE: sem --use-fake-ui-for-media-stream -- essa flag força a
// captura a cair em "screen:0:0" mesmo com preferCurrentTab (confirmado
// empiricamente nesta sessão), então fica de fora para preservar uma
// captura de ABA genuína e automatizada.
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
const env = loadEnv(path.join(ROOT, ".env"));
const LIVEKIT_URL = env.VITE_LIVEKIT_URL;
const LIVEKIT_API_KEY = env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = env.LIVEKIT_API_SECRET;

const PORT = 8944;
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

async function runOne(scenario) {
  console.log(`\n=== ${scenario.label} ===`);
  const roomName = `combined-${scenario.id}-${Date.now()}`;
  const pubToken = await mintToken(roomName, "probe-pub", true);
  const subToken = await mintToken(roomName, "probe-sub", false);

  // NOTE: no --use-fake-ui-for-media-stream (see file header).
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

  // Kick off: canvas content + raw capture + baseline raw measurement,
  // entirely inside the page (no WebRTC touched yet).
  const rawBaseline = await pubPage.evaluate(
    async ({ resolution }) => {
      window.__harness.startAnimatedCanvas();
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: resolution.width, height: resolution.height, frameRate: resolution.frameRate },
        preferCurrentTab: true,
      });
      const track = stream.getVideoTracks()[0];
      track.contentHint = resolution.contentHint ?? "motion";
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

      // WebCodecs path candidate: does a MediaStreamTrackProcessor reading
      // the SAME track see the same throttle once RTCRtpSender attaches, or
      // does it keep reading at full rate (would mean bypassing the built-in
      // RTCRtpSender encoder via Insertable Streams is a real option)?
      window.__mstpFrameCount = 0;
      window.__mstpRunning = true;
      if (typeof MediaStreamTrackProcessor !== "undefined") {
        const processor = new MediaStreamTrackProcessor({ track });
        const reader = processor.readable.getReader();
        (async () => {
          while (window.__mstpRunning) {
            const { done, value } = await reader.read();
            if (done) break;
            window.__mstpFrameCount++;
            value.close();
          }
        })();
        window.__mstpSupported = true;
      } else {
        window.__mstpSupported = false;
      }

      await new Promise((r) => setTimeout(r, 1000));
      const t0 = performance.now();
      const c0 = window.__rawFrameCount;
      const m0 = window.__mstpFrameCount;
      await new Promise((r) => setTimeout(r, 6000));
      const fps = (window.__rawFrameCount - c0) / ((performance.now() - t0) / 1000);
      const mstpFps = (window.__mstpFrameCount - m0) / ((performance.now() - t0) / 1000);
      return { settings: track.getSettings(), rawFpsBaseline: fps, mstpFpsBaseline: mstpFps, mstpSupported: window.__mstpSupported };
    },
    { resolution: scenario.resolution },
  );
  console.log(
    "  raw baseline (antes de publicar):", rawBaseline.rawFpsBaseline.toFixed(2), "fps  |  MSTP baseline:",
    rawBaseline.mstpSupported ? rawBaseline.mstpFpsBaseline.toFixed(2) + " fps" : "não suportado",
    " |  deviceId:", rawBaseline.settings.deviceId, "displaySurface:", rawBaseline.settings.displaySurface,
  );

  // Now connect + publish that SAME track over LiveKit, and keep measuring
  // raw delivery in parallel while sampling outbound/inbound-rtp.
  await pubPage.evaluate(([url, token]) => window.__harness.connect(url, token), [LIVEKIT_URL, pubToken]);
  await pubPage.evaluate(
    ({ encoding, videoCodec }) => window.__harness.publishRawTrack(window.__rawTrack, encoding, videoCodec),
    { encoding: scenario.encoding, videoCodec: scenario.videoCodec },
  );

  await pubPage.waitForTimeout(3000); // ramp-up

  if (scenario.reapplyConstraints) {
    const reapplied = await pubPage.evaluate(async ({ resolution }) => {
      try {
        await window.__rawTrack.applyConstraints({
          frameRate: resolution.frameRate,
          width: resolution.width,
          height: resolution.height,
        });
        return { ok: true, settingsAfter: window.__rawTrack.getSettings() };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    }, { resolution: scenario.resolution });
    console.log("  applyConstraints() pós-publish:", JSON.stringify(reapplied));
  }

  await pubPage.waitForTimeout(3000); // let it settle post-reapply

  const rawT0 = await pubPage.evaluate(() => ({ t: performance.now(), c: window.__rawFrameCount, m: window.__mstpFrameCount }));
  const samples = [];
  for (let i = 0; i < 8; i++) {
    const t = Date.now();
    const [pubStats, subStats] = await Promise.all([samplePCStats(pubPage), samplePCStats(subPage)]);
    samples.push({ t, pubStats, subStats });
    await pubPage.waitForTimeout(2000);
  }
  const rawT1 = await pubPage.evaluate(() => ({ t: performance.now(), c: window.__rawFrameCount, m: window.__mstpFrameCount }));
  const rawFpsWhilePublishing = (rawT1.c - rawT0.c) / ((rawT1.t - rawT0.t) / 1000);
  const mstpFpsWhilePublishing = (rawT1.m - rawT0.m) / ((rawT1.t - rawT0.t) / 1000);

  const outFirst = findVideoRTP(samples[0].pubStats, "outbound-rtp");
  const outLast = findVideoRTP(samples[samples.length - 1].pubStats, "outbound-rtp");
  const inFirst = findVideoRTP(samples[0].subStats, "inbound-rtp");
  const inLast = findVideoRTP(samples[samples.length - 1].subStats, "inbound-rtp");
  const dt = (samples[samples.length - 1].t - samples[0].t) / 1000;
  const encodeFps = outFirst && outLast ? (outLast.framesEncoded - outFirst.framesEncoded) / dt : null;
  const decodeFps = inFirst && inLast ? (inLast.framesDecoded - inFirst.framesDecoded) / dt : null;
  const qlr = outLast?.qualityLimitationReason;

  const result = {
    scenario,
    deviceId: rawBaseline.settings.deviceId,
    displaySurface: rawBaseline.settings.displaySurface,
    rawFpsBaseline: rawBaseline.rawFpsBaseline,
    mstpSupported: rawBaseline.mstpSupported,
    mstpFpsBaseline: rawBaseline.mstpFpsBaseline,
    mstpFpsWhilePublishing,
    rawFpsWhilePublishing,
    encodeFps,
    decodeFps,
    resSent: outLast ? `${outLast.frameWidth}x${outLast.frameHeight}` : null,
    bitrateKbps: outFirst && outLast ? ((outLast.bytesSent - outFirst.bytesSent) * 8) / dt / 1000 : null,
    qualityLimitationReason: qlr,
    packetsLost: inLast?.packetsLost,
  };
  console.log("  " + JSON.stringify(result, null, 2).replace(/\n/g, "\n  "));

  await pubBrowser.close().catch(() => {});
  await subBrowser.close().catch(() => {});
  return result;
}

const SCENARIOS = [
  {
    id: "1080p60_mstp",
    label: "1080p60 -- MediaStreamTrackProcessor lendo a mesma track (candidato a pipeline WebCodecs)",
    resolution: { width: 1920, height: 1080, frameRate: 60 },
    encoding: { maxBitrate: 8_000_000, maxFramerate: 60 },
  },
];

const all = [];
for (const s of SCENARIOS) all.push(await runOne(s));
writeFileSync(path.join(RESULTS_DIR, "combined-decisive.json"), JSON.stringify(all, null, 2));
server.close();
console.log("\n[done] scripts/fps-audit/results/combined-decisive.json");
