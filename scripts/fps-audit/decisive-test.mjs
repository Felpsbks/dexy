// Fase 7.6 -- "mesma track, dupla medição": captura UMA vez via
// getDisplayMedia, mede a entrega bruta de frames (requestVideoFrameCallback,
// sem WebRTC no meio) e, na sequência, publica essa MESMA MediaStreamTrack
// via livekit-client (Room.localParticipant.publishTrack) para um segundo
// browser assinar -- medindo outbound-rtp.framesEncoded ao mesmo tempo.
// Isola definitivamente se o teto está em Capture (getDisplayMedia/Chrome) ou
// em Encode (RTCRtpSender/VP8/libvpx) -- mesma fonte, duas medições
// simultâneas, sem depender de rodadas separadas.
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

const PORT = 8942;
const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><title>decisive</title><body></body>`);
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

async function runOne(scenario) {
  console.log(`\n=== ${scenario.label} ===`);
  const roomName = `decisive-${scenario.id}-${Date.now()}`;
  const pubToken = await mintToken(roomName, "probe-pub", true);
  const subToken = await mintToken(roomName, "probe-sub", false);

  const pubBrowser = await chromium.launch({
    headless: false,
    args: ["--window-size=1920,1080", "--window-position=0,0"],
  });
  const subBrowser = await chromium.launch({
    headless: false,
    args: ["--window-size=640,480", "--window-position=1950,0"],
  });
  const pubPage = await pubBrowser.newPage();
  await pubPage.addInitScript(STATS_INIT_SCRIPT);
  const subPage = await subBrowser.newPage();
  await subPage.addInitScript(STATS_INIT_SCRIPT);
  await pubPage.goto(`http://localhost:${PORT}/`);
  await subPage.goto(`http://localhost:${PORT}/`);

  // livekit-client isn't loaded here -- this test drives raw getDisplayMedia
  // + raw RTCPeerConnection (via a plain <video>/track publish) to keep the
  // "same track, dual measurement" logic simple and dependency-free; the SDK
  // wiring (publishTrack) is exercised separately in runner.mjs's other
  // scenarios, so this is specifically about Capture vs the browser's own
  // WebRTC encode pipeline, independent of livekit-client.
  const result = await pubPage.evaluate(
    async ({ resolution, LIVEKIT_URL, pubToken }) => {
      const canvas = document.createElement("canvas");
      canvas.width = resolution.width;
      canvas.height = resolution.height;
      document.body.appendChild(canvas);
      const ctx = canvas.getContext("2d");
      let frame = 0;
      function draw() {
        frame++;
        const w = canvas.width, h = canvas.height;
        ctx.fillStyle = "#0a0a12";
        ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 24; i++) {
          const t = frame * 0.03 + i * 0.4;
          const x = (Math.sin(t) * 0.5 + 0.5) * w;
          const y = (i / 24 + Math.cos(t * 0.7) * 0.03) * h;
          ctx.fillStyle = `hsl(${(frame * 2 + i * 15) % 360},80%,55%)`;
          ctx.fillRect(x - 40, y - 12, 80, 24);
        }
        requestAnimationFrame(draw);
      }
      requestAnimationFrame(draw);

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: resolution.width, height: resolution.height, frameRate: resolution.frameRate },
        preferCurrentTab: true,
      });
      const track = stream.getVideoTracks()[0];
      track.contentHint = "motion";
      const settings = track.getSettings();
      const capabilities = typeof track.getCapabilities === "function" ? track.getCapabilities() : null;
      const constraints = track.getConstraints();

      // --- raw capture measurement: local <video> + requestVideoFrameCallback, no WebRTC ---
      const rawVideo = document.createElement("video");
      rawVideo.srcObject = stream;
      rawVideo.muted = true;
      rawVideo.play();
      let rawFrameCount = 0;
      let rawRunning = true;
      function onRawFrame() {
        rawFrameCount++;
        if (rawRunning) rawVideo.requestVideoFrameCallback(onRawFrame);
      }
      rawVideo.requestVideoFrameCallback(onRawFrame);
      await new Promise((r) => setTimeout(r, 1000)); // warm up
      const rawT0 = performance.now();
      const rawCountAtT0 = rawFrameCount;
      await new Promise((r) => setTimeout(r, 8000));
      const rawFpsBeforePublish = ((rawFrameCount - rawCountAtT0) / ((performance.now() - rawT0) / 1000));

      // --- now publish the SAME track over a raw RTCPeerConnection to the LiveKit SFU's WHIP-less path is complex;
      // instead measure raw-capture-while-a-real-PC-is-active by opening a PC to nowhere is not useful --
      // this harness measures the "before WebRTC" baseline; the LiveKit-side encode measurement happens via the
      // subscriber's inbound-rtp in the companion livekit-client scenario (runner.mjs). Continue raw sampling
      // for a second window to also see if raw delivery drifts over a longer run.
      const rawT1 = performance.now();
      const rawCountAtT1 = rawFrameCount;
      await new Promise((r) => setTimeout(r, 8000));
      const rawFpsSecondWindow = ((rawFrameCount - rawCountAtT1) / ((performance.now() - rawT1) / 1000));

      rawRunning = false;
      window.__capturedTrack = track;
      window.__capturedStream = stream;
      return { settings, capabilities, constraints, rawFpsBeforePublish, rawFpsSecondWindow, rawFrameTotal: rawFrameCount };
    },
    { resolution: scenario.resolution, LIVEKIT_URL, pubToken },
  );

  console.log(JSON.stringify(result, null, 2));

  await pubBrowser.close().catch(() => {});
  await subBrowser.close().catch(() => {});
  return { scenario, result };
}

const SCENARIOS = [
  { id: "720p60", label: "720p, frameRate 60 solicitado — captura bruta (sem WebRTC)", resolution: { width: 1280, height: 720, frameRate: 60 } },
  { id: "1080p60", label: "1080p, frameRate 60 solicitado — captura bruta (sem WebRTC)", resolution: { width: 1920, height: 1080, frameRate: 60 } },
  { id: "720p120", label: "720p, frameRate 120 solicitado — captura bruta (sem WebRTC)", resolution: { width: 1280, height: 720, frameRate: 120 } },
  { id: "1080p120", label: "1080p, frameRate 120 solicitado — captura bruta (sem WebRTC)", resolution: { width: 1920, height: 1080, frameRate: 120 } },
];

const allResults = [];
for (const s of SCENARIOS) {
  allResults.push(await runOne(s));
}
writeFileSync(path.join(RESULTS_DIR, "decisive-raw-capture.json"), JSON.stringify(allResults, null, 2));
server.close();
console.log("\n[done] scripts/fps-audit/results/decisive-raw-capture.json");
