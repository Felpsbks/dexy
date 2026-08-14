// Fase 7.6 — orquestrador de medição real de FPS/bitrate/qualidade WebRTC.
// NÃO faz parte do app Dexy: conecta direto no LiveKit Cloud do projeto
// (mesmas credenciais do .env) usando tokens mintados via livekit-server-sdk,
// bypassando totalmente o Supabase/auth do app. Roda dois browsers Chromium
// reais (Playwright) publicando/assinando com o livekit-client real do
// projeto, e lê getStats() nativo do WebRTC — números reais, não simulados.
import { createServer } from "node:http";
import { readFile, readFileSync, writeFileSync, mkdirSync, statSync, createReadStream } from "node:fs";
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
// Local .env (this dir) takes priority -- lets this folder run fully
// standalone when copied out of the repo (e.g. to a second test machine,
// see README.md), without needing the full app checkout or its Supabase
// credentials. Falls back to the app's own .env two levels up otherwise.
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
  throw new Error("Faltam credenciais LiveKit no .env");
}

const PORT = 8934;
function contentType(p) {
  if (p.endsWith(".html")) return "text/html";
  if (p.endsWith(".js")) return "application/javascript";
  if (p.endsWith(".mp4")) return "video/mp4";
  return "application/octet-stream";
}
const server = createServer((req, res) => {
  let p = (req.url === "/" ? "/index.html" : req.url).split("?")[0];
  const filePath = path.join(__dirname, p);
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end();
    return;
  }
  // <video> autoplay/loop in Chrome routinely issues Range requests even for
  // small local files -- serving 200s for those can stall playback, so mp4s
  // get real 206 partial-content support.
  if (filePath.endsWith(".mp4")) {
    let size;
    try {
      size = statSync(filePath).size;
    } catch {
      res.writeHead(404);
      res.end();
      return;
    }
    const range = req.headers.range;
    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, "").split("-");
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : size - 1;
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        "Content-Type": "video/mp4",
      });
      createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { "Content-Length": size, "Content-Type": "video/mp4", "Accept-Ranges": "bytes" });
      createReadStream(filePath).pipe(res);
    }
    return;
  }
  readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": contentType(filePath) });
    res.end(data);
  });
});
await new Promise((resolve) => server.listen(PORT, resolve));
console.log(`[server] http://localhost:${PORT}`);

async function mintToken(room, identity, canPublish) {
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity, ttl: "10m" });
  at.addGrant({ room, roomJoin: true, canPublish, canSubscribe: true });
  return at.toJwt();
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

const MEDIA_DIR = path.join(__dirname, "media");

const CAMERA_SCENARIOS = [
  {
    id: "cam_720p30",
    kind: "camera",
    label: "Câmera 720p/30 (baseline atual — setCameraEnabled sem opções)",
    sourceFile: path.join(MEDIA_DIR, "cam_720p30.y4m"),
    resolution: null,
  },
  {
    id: "cam_1080p30",
    kind: "camera",
    label: "Câmera 1080p/30 (proposta)",
    sourceFile: path.join(MEDIA_DIR, "cam_1080p30.y4m"),
    resolution: { width: 1920, height: 1080, frameRate: 30 },
  },
  {
    id: "cam_1080p60",
    kind: "camera",
    label: "Câmera 1080p/60 (proposta)",
    sourceFile: path.join(MEDIA_DIR, "cam_1080p60.y4m"),
    resolution: { width: 1920, height: 1080, frameRate: 60 },
  },
  {
    id: "cam_720p30_smalltile",
    kind: "camera",
    label: "Câmera 720p/30 — tile PEQUENO no receptor (isola o efeito do adaptiveStream) [ANTES do fix]",
    sourceFile: path.join(MEDIA_DIR, "cam_720p30.y4m"),
    resolution: null,
    smallTile: true,
  },
];

// Mirrors src/lib/livekit.ts's new CAMERA_CAPTURE_OPTIONS / CAMERA_PUBLISH_OPTIONS
// exactly (Fase 7.6 Prioridade 1+2 fix) -- plain objects, not VideoPreset
// instances, since these cross the Playwright evaluate() boundary as JSON;
// livekit-client's simulcast-layer code only ever reads .width/.height/
// .encoding.{maxBitrate,maxFramerate} off them (confirmed no `instanceof
// VideoPreset` checks anywhere in the SDK), so plain objects work identically.
const CAMERA_AFTER_RESOLUTION = { width: 1920, height: 1080, frameRate: 30 };
const CAMERA_AFTER_PUBLISH_OPTIONS = {
  videoEncoding: { maxBitrate: 3_000_000, maxFramerate: 30 },
  videoSimulcastLayers: [
    { width: 320, height: 180, encoding: { maxBitrate: 160_000, maxFramerate: 30 } },
    { width: 640, height: 360, encoding: { maxBitrate: 450_000, maxFramerate: 30 } },
  ],
};

const CAMERA_AFTER_SCENARIOS = [
  {
    id: "cam_after_default",
    kind: "camera",
    label: "Câmera — novo padrão 1080p/30 [DEPOIS do fix, tile grande]",
    sourceFile: path.join(MEDIA_DIR, "cam_1080p30.y4m"),
    resolution: CAMERA_AFTER_RESOLUTION,
    publishOptions: CAMERA_AFTER_PUBLISH_OPTIONS,
  },
  {
    id: "cam_after_smalltile",
    kind: "camera",
    label: "Câmera — novo padrão 1080p/30 — tile PEQUENO no receptor [DEPOIS do fix]",
    sourceFile: path.join(MEDIA_DIR, "cam_1080p30.y4m"),
    resolution: CAMERA_AFTER_RESOLUTION,
    publishOptions: CAMERA_AFTER_PUBLISH_OPTIONS,
    smallTile: true,
  },
];

const SCREEN_RES_SCENARIOS = [
  {
    id: "ss_1080p60",
    kind: "screenshare",
    mode: "tab",
    label: "Screen Share 1080p/60 (baseline atual)",
    resolution: { width: 1920, height: 1080, frameRate: 60 },
    encoding: { maxBitrate: 7_000_000, maxFramerate: 60 },
    captureSourceTitle: "FPS-AUDIT-SHARE-SOURCE",
  },
  {
    id: "ss_1440p60",
    kind: "screenshare",
    mode: "tab",
    label: "Screen Share 1440p/60 (proposta, fora do app hoje)",
    resolution: { width: 2560, height: 1440, frameRate: 60 },
    encoding: { maxBitrate: 10_000_000, maxFramerate: 60 },
    captureSourceTitle: "FPS-AUDIT-SHARE-SOURCE",
  },
  {
    id: "ss_4k60",
    kind: "screenshare",
    mode: "tab",
    label: "Screen Share 4K/60 (baseline atual)",
    resolution: { width: 3840, height: 2160, frameRate: 60 },
    encoding: { maxBitrate: 16_000_000, maxFramerate: 60 },
    captureSourceTitle: "FPS-AUDIT-SHARE-SOURCE",
  },
];

const SCREEN_MODE_SCENARIOS = [
  {
    id: "ss_mode_tab",
    kind: "screenshare",
    mode: "tab",
    label: "Screen Share 1080p60 — modo ABA",
    resolution: { width: 1920, height: 1080, frameRate: 60 },
    encoding: { maxBitrate: 7_000_000, maxFramerate: 60 },
    captureSourceTitle: "FPS-AUDIT-SHARE-SOURCE",
  },
  {
    id: "ss_mode_window",
    kind: "screenshare",
    mode: "window",
    label: "Screen Share 1080p60 — modo JANELA",
    resolution: { width: 1920, height: 1080, frameRate: 60 },
    encoding: { maxBitrate: 7_000_000, maxFramerate: 60 },
    captureSourceTitle: "FPS-AUDIT-WINDOW-SOURCE",
  },
  {
    id: "ss_mode_screen",
    kind: "screenshare",
    mode: "screen",
    label: "Screen Share 1080p60 — modo TELA INTEIRA",
    resolution: { width: 1920, height: 1080, frameRate: 60 },
    encoding: { maxBitrate: 7_000_000, maxFramerate: 60 },
    captureSourceTitle: "Entire screen",
  },
];

// Fase 7.6 -- "aba vs tela inteira, mesmo conteúdo" comparison: mirrors
// Dexy's exact current SCREEN_SHARE_QUALITIES["1080p"] (unchanged --
// resolution/bitrate/maxFramerate stay whatever's actually shipped) across
// three capture surfaces so mode is the only thing that varies.
const COMPARISON_SCENARIOS = [
  {
    id: "cmp_tab_canvas",
    kind: "screenshare",
    mode: "tab",
    label: "Comparação — ABA com canvas/animação",
    resolution: { width: 1920, height: 1080, frameRate: 60 },
    encoding: { maxBitrate: 7_000_000, maxFramerate: 60 },
  },
  {
    id: "cmp_tab_video",
    kind: "screenshare",
    mode: "tab",
    contentPage: "video",
    label: "Comparação — ABA com <video> real (mp4 60fps)",
    resolution: { width: 1920, height: 1080, frameRate: 60 },
    encoding: { maxBitrate: 7_000_000, maxFramerate: 60 },
  },
  {
    id: "cmp_tab_canvas_720p",
    kind: "screenshare",
    mode: "tab",
    label: "Comparação — ABA com canvas, 720p60 (tie-breaker: resolução menor = menos pixels/frame pro encoder)",
    resolution: { width: 1280, height: 720, frameRate: 60 },
    encoding: { maxBitrate: 7_000_000, maxFramerate: 60 },
  },
  {
    id: "cmp_screen_canvas",
    kind: "screenshare",
    mode: "screen",
    label: "Comparação — TELA INTEIRA, mesmo canvas/animação",
    resolution: { width: 1920, height: 1080, frameRate: 60 },
    encoding: { maxBitrate: 7_000_000, maxFramerate: 60 },
    captureSourceTitle: "Entire screen",
  },
];

// Simulcast means outbound-rtp can have several video entries (one per
// active rid/layer) -- dynacast pauses the ones nobody's subscribed to, so
// picking "the first match" can land on a dormant high-res layer (frameWidth
// still set, framesPerSecond ~0) instead of whichever layer is actually
// flowing. Picking the one with the highest live framesPerSecond/bytesSent
// gets the layer actually being transmitted.
function findVideoRTP(statsArr, type) {
  let best = null;
  for (const pcEntry of statsArr) {
    for (const item of pcEntry.items) {
      if (item.type !== type || item.kind !== "video") continue;
      const score = (item.framesPerSecond ?? 0) * 1e9 + (item.bytesSent ?? item.bytesReceived ?? 0);
      if (!best || score > best.score) best = { item, allItems: pcEntry.items, score };
    }
  }
  return best;
}
function findCodecMime(allItems, codecId) {
  const c = allItems.find((i) => i.type === "codec" && i.id === codecId);
  return c?.mimeType ?? null;
}
function findActiveRTT(statsArr) {
  for (const pcEntry of statsArr) {
    for (const item of pcEntry.items) {
      if (
        item.type === "candidate-pair" &&
        item.state === "succeeded" &&
        typeof item.currentRoundTripTime === "number"
      ) {
        return item.currentRoundTripTime * 1000;
      }
    }
  }
  return null;
}

async function runScenario(scenario, { windowSourceBrowser } = {}) {
  console.log(`\n=== ${scenario.label} ===`);
  const roomName = `fps-audit-${scenario.id}-${Date.now()}`;
  const pubToken = await mintToken(roomName, "probe-pub", true);
  const subToken = await mintToken(roomName, "probe-sub", false);

  const pubArgs = [
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--window-position=0,0",
  ];
  if (scenario.kind === "camera") {
    pubArgs.push("--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${scenario.sourceFile}`);
    pubArgs.push("--window-size=640,480");
  } else if (scenario.mode === "tab") {
    // Self-capture via preferCurrentTab -- no reliance on picker/flag string
    // matching. Window sized to the target resolution since the tab's own
    // viewport (not the physical monitor) is what gets captured.
    pubArgs.push(`--window-size=${scenario.resolution.width},${scenario.resolution.height}`);
  } else {
    // window/screen modes: the captured surface is a genuinely separate OS
    // window (windowSourceBrowser), matched by title via
    // --auto-select-desktop-capture-source so the real Chrome picker UI
    // never has to appear (no human to click it).
    pubArgs.push("--window-size=800,600");
    pubArgs.push(`--auto-select-desktop-capture-source=${scenario.captureSourceTitle}`);
  }

  // FPS_AUDIT_REAL_CHROME=1 launches the actual installed Chrome
  // (channel: "chrome") instead of Playwright's bundled Chrome-for-Testing
  // build -- isolates "different Chrome build" as a variable, independent of
  // needing different hardware.
  const channelOpt = process.env.FPS_AUDIT_REAL_CHROME ? { channel: "chrome" } : {};
  const pubBrowser = await chromium.launch({ headless: false, args: pubArgs, ...channelOpt });
  const subBrowser = await chromium.launch({
    headless: false,
    args: ["--autoplay-policy=no-user-gesture-required", "--window-size=640,480", "--window-position=900,0"],
    ...channelOpt,
  });

  const result = { scenario: { id: scenario.id, label: scenario.label, resolution: scenario.resolution, encoding: scenario.encoding }, samples: [], error: null };

  try {
    const pubPage = await pubBrowser.newPage();
    await pubPage.addInitScript(STATS_INIT_SCRIPT);
    const subPage = await subBrowser.newPage();
    await subPage.addInitScript(STATS_INIT_SCRIPT);
    if (scenario.kind === "screenshare" && scenario.mode === "tab") {
      await pubPage.setViewportSize({ width: scenario.resolution.width, height: scenario.resolution.height });
    }

    let sharePage = null;
    if (scenario.kind === "screenshare" && scenario.mode === "window") {
      sharePage = await windowSourceBrowser.newPage();
      await sharePage.setViewportSize({ width: scenario.resolution.width, height: scenario.resolution.height });
      await sharePage.goto(`http://localhost:${PORT}/tab-content.html`);
      await sharePage.evaluate((t) => (document.title = t), scenario.captureSourceTitle);
    }
    if (scenario.kind === "screenshare" && scenario.mode === "screen") {
      sharePage = await windowSourceBrowser.newPage();
      await sharePage.setViewportSize({ width: scenario.resolution.width, height: scenario.resolution.height });
      await sharePage.goto(`http://localhost:${PORT}/tab-content.html`);
    }
    if (sharePage) await sharePage.bringToFront();

    const pubEntryPage = scenario.contentPage === "video" ? "video-index.html" : "index.html";
    await pubPage.goto(`http://localhost:${PORT}/${pubEntryPage}`);
    await pubPage.waitForFunction("window.__harnessReady === true");
    await subPage.goto(`http://localhost:${PORT}/index.html`);
    await subPage.waitForFunction("window.__harnessReady === true");

    await subPage.evaluate(
      ([url, token, opts]) => window.__harness.connect(url, token, opts),
      [LIVEKIT_URL, subToken, { smallTile: !!scenario.smallTile }],
    );
    await pubPage.evaluate(([url, token]) => window.__harness.connect(url, token), [LIVEKIT_URL, pubToken]);

    if (scenario.kind === "camera") {
      await pubPage.evaluate(
        ([res, pub]) => window.__harness.publishCamera(res, pub),
        [scenario.resolution, scenario.publishOptions ?? null],
      );
    } else {
      if (scenario.mode === "tab" && scenario.contentPage !== "video") {
        await pubPage.evaluate(() => window.__harness.startAnimatedCanvas());
      }
      if (scenario.contentPage === "video") {
        // let autoplay actually start producing decoded frames before capture
        await pubPage.waitForTimeout(1000);
      }
      await pubPage.evaluate(
        (opts) => window.__harness.publishScreenShare(opts),
        { resolution: scenario.resolution, encoding: scenario.encoding, preferCurrentTab: scenario.mode === "tab" },
      );
    }

    await pubPage.waitForTimeout(10000); // ramp-up (adaptiveStream needs time to measure the receiving element and upgrade off its initial low-quality guess)

    const track = scenario.kind === "camera" ? "camera" : "screen_share";
    for (let i = 0; i < 10; i++) {
      const t = Date.now();
      const [pubStats, subStats, localSettings, renderStats] = await Promise.all([
        samplePCStats(pubPage),
        samplePCStats(subPage),
        pubPage.evaluate((src) => window.__harness.getLocalTrackSettings(src), track).catch(() => null),
        subPage.evaluate(() => window.__harness.getRenderStats()).catch(() => null),
      ]);
      result.samples.push({ t, pubStats, subStats, localSettings, renderStats });
      await pubPage.waitForTimeout(2000);
    }
  } catch (err) {
    result.error = String(err?.message ?? err);
    console.error(`  ERRO: ${result.error}`);
  } finally {
    await pubBrowser.close().catch(() => {});
    await subBrowser.close().catch(() => {});
  }
  return result;
}

function aggregate(result) {
  const { samples } = result;
  if (result.error || samples.length < 4) return { ...result, agg: null };
  // steady-state window: skip first 2 samples (extra settle time), use the rest
  const win = samples.slice(2);
  const encFps = [], decFps = [], sentKbps = [], recvKbps = [], jitterMs = [], rttMs = [], renderFpsSeries = [];
  let lastOut = null, lastIn = null, lastRender = null, codecOut = null, codecIn = null, qlr = null, packetsLost = null, framesDropped = null, resSent = null, resRecv = null, captureSettings = null;

  for (let i = 0; i < win.length; i++) {
    const s = win[i];
    const out = findVideoRTP(s.pubStats, "outbound-rtp");
    const inn = findVideoRTP(s.subStats, "inbound-rtp");
    const rtt = findActiveRTT(s.pubStats) ?? findActiveRTT(s.subStats);
    if (out) {
      if (typeof out.item.framesPerSecond === "number") encFps.push(out.item.framesPerSecond);
      if (out.item.qualityLimitationReason) qlr = out.item.qualityLimitationReason;
      if (out.item.frameWidth) resSent = `${out.item.frameWidth}x${out.item.frameHeight}`;
      codecOut = findCodecMime(out.allItems, out.item.codecId) ?? codecOut;
      if (lastOut) {
        const dt = (s.t - lastOut.t) / 1000;
        sentKbps.push(((out.item.bytesSent - lastOut.item.bytesSent) * 8) / dt / 1000);
      }
      lastOut = { item: out.item, t: s.t };
    }
    if (inn) {
      if (typeof inn.item.framesPerSecond === "number") decFps.push(inn.item.framesPerSecond);
      if (inn.item.frameWidth) resRecv = `${inn.item.frameWidth}x${inn.item.frameHeight}`;
      if (typeof inn.item.jitter === "number") jitterMs.push(inn.item.jitter * 1000);
      packetsLost = inn.item.packetsLost ?? packetsLost;
      framesDropped = inn.item.framesDropped ?? framesDropped;
      codecIn = findCodecMime(inn.allItems, inn.item.codecId) ?? codecIn;
      if (lastIn) {
        const dt = (s.t - lastIn.t) / 1000;
        recvKbps.push(((inn.item.bytesReceived - lastIn.item.bytesReceived) * 8) / dt / 1000);
      }
      lastIn = { item: inn.item, t: s.t };
    }
    if (typeof rtt === "number") rttMs.push(rtt);
    if (s.renderStats?.totalVideoFrames != null) {
      if (lastRender) {
        const dt = (s.t - lastRender.t) / 1000;
        renderFpsSeries.push((s.renderStats.totalVideoFrames - lastRender.frames) / dt);
      }
      lastRender = { frames: s.renderStats.totalVideoFrames, t: s.t };
    }
    if (s.localSettings?.settings) captureSettings = s.localSettings.settings;
  }
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  return {
    ...result,
    agg: {
      captureFps: captureSettings?.frameRate ?? null,
      captureRes: captureSettings ? `${captureSettings.width}x${captureSettings.height}` : null,
      encodeSentFps: avg(encFps),
      decodedFps: avg(decFps),
      renderedFps: avg(renderFpsSeries),
      sentKbps: avg(sentKbps),
      recvKbps: avg(recvKbps),
      resSent,
      resRecv,
      codecOut,
      codecIn,
      qualityLimitationReason: qlr,
      packetsLost,
      framesDropped,
      jitterMs: avg(jitterMs),
      rttMs: avg(rttMs),
    },
  };
}

async function main() {
  const which = process.argv[2] ?? "all";
  const results = [];

  let windowSourceBrowser = null;
  if (which === "all" || which === "mode" || which === "compare") {
    windowSourceBrowser = await chromium.launch({
      headless: false,
      args: ["--window-size=1920,1080", "--window-position=0,0"],
      ...(process.env.FPS_AUDIT_REAL_CHROME ? { channel: "chrome" } : {}),
    });
  }

  const scenarioSets = [];
  if (which === "all" || which === "camera") scenarioSets.push(...CAMERA_SCENARIOS);
  if (which === "all" || which === "after") scenarioSets.push(...CAMERA_AFTER_SCENARIOS);
  if (which === "all" || which === "ssres") scenarioSets.push(...SCREEN_RES_SCENARIOS);
  if (which === "all" || which === "mode") scenarioSets.push(...SCREEN_MODE_SCENARIOS);
  if (which === "all" || which === "compare") scenarioSets.push(...COMPARISON_SCENARIOS);

  for (const scenario of scenarioSets) {
    const raw = await runScenario(scenario, { windowSourceBrowser });
    const agg = aggregate(raw);
    results.push(agg);
    writeFileSync(path.join(RESULTS_DIR, `${scenario.id}.json`), JSON.stringify(agg, null, 2));
    console.log(JSON.stringify(agg.agg, null, 2));
  }

  if (windowSourceBrowser) await windowSourceBrowser.close().catch(() => {});

  writeFileSync(path.join(RESULTS_DIR, "all-results.json"), JSON.stringify(results, null, 2));
  server.close();
  console.log("\n[done] resultados em scripts/fps-audit/results/");
}

main().catch((err) => {
  console.error(err);
  server.close();
  process.exit(1);
});
