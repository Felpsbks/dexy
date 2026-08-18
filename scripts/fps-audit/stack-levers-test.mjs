// Fase 7.6 -- testa as alavancas da API padrão (RTCRtpSender.setParameters,
// degradationPreference, scaleResolutionDownBy, simulcast, VP9) que ainda
// não tinham sido testadas isoladamente, antes de considerar WebCodecs.
// Mesma metodologia "mesma track, dupla medição" dos testes anteriores.
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

const PORT = 8946;
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
  const roomName = `levers-${scenario.id}-${Date.now()}`;
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

  await pubPage.evaluate(
    async ({ resolution }) => {
      window.__harness.startAnimatedCanvas();
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: resolution.width, height: resolution.height, frameRate: resolution.frameRate },
        preferCurrentTab: true,
      });
      const track = stream.getVideoTracks()[0];
      track.contentHint = "motion";
      window.__rawTrack = track;
    },
    { resolution: scenario.resolution },
  );

  await pubPage.evaluate(([url, token]) => window.__harness.connect(url, token), [LIVEKIT_URL, pubToken]);
  await pubPage.evaluate(
    ({ encoding, simulcast, videoCodec, videoSimulcastLayers }) =>
      window.__harness.publishRawTrackAdvanced(window.__rawTrack, { encoding, simulcast, videoCodec, videoSimulcastLayers }),
    { encoding: scenario.encoding, simulcast: !!scenario.simulcast, videoCodec: scenario.videoCodec, videoSimulcastLayers: scenario.videoSimulcastLayers },
  );

  await pubPage.waitForTimeout(3000);

  // The lever under test: reach into the raw RTCRtpSender and call
  // setParameters() directly -- bypasses whatever livekit-client itself
  // requested, testing the platform API surface itself.
  let senderTweak = null;
  if (scenario.senderParams) {
    senderTweak = await pubPage.evaluate(async (params) => {
      for (const pc of window.__pcs) {
        const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
        if (!sender) continue;
        try {
          const p = sender.getParameters();
          if (!p.encodings || p.encodings.length === 0) p.encodings = [{}];
          for (const enc of p.encodings) Object.assign(enc, params);
          await sender.setParameters(p);
          return { ok: true, appliedTo: p.encodings };
        } catch (e) {
          return { ok: false, error: String(e) };
        }
      }
      return { ok: false, error: "no video sender found" };
    }, scenario.senderParams);
    console.log("  setParameters():", JSON.stringify(senderTweak));
  }

  await pubPage.waitForTimeout(5000); // settle

  const samples = [];
  for (let i = 0; i < 6; i++) {
    const t = Date.now();
    const [pubStats, subStats] = await Promise.all([samplePCStats(pubPage), samplePCStats(subPage)]);
    samples.push({ t, pubStats, subStats });
    await pubPage.waitForTimeout(2000);
  }
  const outFirst = findVideoRTP(samples[0].pubStats, "outbound-rtp");
  const outLast = findVideoRTP(samples[samples.length - 1].pubStats, "outbound-rtp");
  const inFirst = findVideoRTP(samples[0].subStats, "inbound-rtp");
  const inLast = findVideoRTP(samples[samples.length - 1].subStats, "inbound-rtp");
  const dt = (samples[samples.length - 1].t - samples[0].t) / 1000;
  const result = {
    scenario: scenario.id,
    label: scenario.label,
    senderTweak,
    encodeFps: outFirst && outLast ? (outLast.framesEncoded - outFirst.framesEncoded) / dt : null,
    decodeFps: inFirst && inLast ? (inLast.framesDecoded - inFirst.framesDecoded) / dt : null,
    resSent: outLast ? `${outLast.frameWidth}x${outLast.frameHeight}` : null,
    bitrateKbps: outFirst && outLast ? ((outLast.bytesSent - outFirst.bytesSent) * 8) / dt / 1000 : null,
    qualityLimitationReason: outLast?.qualityLimitationReason,
    activeEncodings: outLast ? Object.keys(outLast).filter((k) => k.startsWith("encoding")) : null,
  };
  console.log("  " + JSON.stringify(result, null, 2).replace(/\n/g, "\n  "));

  await pubBrowser.close().catch(() => {});
  await subBrowser.close().catch(() => {});
  return result;
}

const BASE_RES = { width: 1920, height: 1080, frameRate: 60 };

const SCENARIOS = [
  {
    id: "reapply_same_maxframerate",
    label: "setParameters() reafirmando SÓ maxFramerate:60 (mesmo valor já configurado, nada novo)",
    resolution: BASE_RES,
    encoding: { maxBitrate: 8_000_000, maxFramerate: 60 },
    senderParams: { maxFramerate: 60 },
  },
  {
    id: "degradation_only_no_maxfr",
    label: "SÓ degradationPreference='maintain-framerate', sem reafirmar maxFramerate",
    resolution: BASE_RES,
    encoding: { maxBitrate: 8_000_000, maxFramerate: 60 },
    senderParams: { degradationPreference: "maintain-framerate" },
  },
  {
    id: "vp9_with_setparams",
    label: "VP9 + setParameters(maxFramerate:60) -- confirma se a técnica funciona em outro codec",
    resolution: BASE_RES,
    encoding: { maxBitrate: 8_000_000, maxFramerate: 60 },
    videoCodec: "vp9",
    senderParams: { maxFramerate: 60 },
  },
  {
    id: "1080p120_with_setparams",
    label: "1080p120 + setParameters(maxFramerate:120) -- o teste que realmente importa pro objetivo",
    resolution: { width: 1920, height: 1080, frameRate: 120 },
    encoding: { maxBitrate: 14_000_000, maxFramerate: 120 },
    senderParams: { maxFramerate: 120, degradationPreference: "maintain-framerate" },
  },
];

const all = [];
for (const s of SCENARIOS) all.push(await runOne(s));
writeFileSync(path.join(RESULTS_DIR, "stack-levers.json"), JSON.stringify(all, null, 2));
server.close();
console.log("\n[done] scripts/fps-audit/results/stack-levers.json");
