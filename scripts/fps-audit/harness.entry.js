// Fase 7.6 — harness de teste isolado (NÃO faz parte do app Dexy).
// Reproduz exatamente as mesmas chamadas que src/lib/livekit.ts faz contra
// o livekit-client real, para medir getStats() reais contra o LiveKit Cloud
// do projeto, sem depender do fluxo de auth/UI do app.
import {
  Room,
  RoomEvent,
  Track,
  AudioPresets,
} from "livekit-client";

const ROOM_PUBLISH_DEFAULTS = { audioPreset: AudioPresets.musicHighQuality };

let room = null;
let smallTile = false;

async function connect(url, token, opts) {
  smallTile = !!opts?.smallTile;
  room = new Room({
    adaptiveStream: true,
    dynacast: true,
    publishDefaults: ROOM_PUBLISH_DEFAULTS,
  });
  room.on(RoomEvent.TrackSubscribed, (track) => {
    if (track.kind === "video") {
      const el = document.createElement("video");
      el.autoplay = true;
      el.muted = true;
      el.playsInline = true;
      el.id = "remote-video";
      // Rendered box intentionally large (matches a fullscreen/focused tile,
      // not a small grid thumbnail) so adaptiveStream requests the TOP
      // simulcast layer -- this measures the pipeline's ceiling, not the
      // (already-confirmed) small-tile downscale behavior.
      if (smallTile) {
        el.style.width = "320px";
        el.style.height = "180px";
      } else {
        el.style.width = "1920px";
        el.style.height = "1080px";
      }
      document.body.style.margin = "0";
      document.body.appendChild(el);
      track.attach(el);
      window.__remoteVideoEl = el;
    }
  });
  await room.connect(url, token);
  window.__room = room;
  return true;
}

async function publishCamera(resolution, publishOptions) {
  const opts = resolution ? { resolution } : undefined;
  await room.localParticipant.setCameraEnabled(true, opts, publishOptions);
  return true;
}

// Publishes a MediaStreamTrack the caller already captured itself (e.g. raw
// getDisplayMedia outside the harness), instead of creating a fresh one --
// lets the same exact track be measured raw (requestVideoFrameCallback) and
// through LiveKit's encode/publish pipeline at the same time, isolating
// Capture from Encode with no "different capture instance" confound.
async function publishRawTrack(mediaStreamTrack, encoding, videoCodec) {
  await room.localParticipant.publishTrack(mediaStreamTrack, {
    videoEncoding: encoding,
    simulcast: false,
    source: Track.Source.ScreenShare,
    ...(videoCodec ? { videoCodec } : {}),
  });
  return true;
}

// Same as publishRawTrack but exposes the extra publish options (simulcast,
// custom layers) needed for the stack-levers comparison (simulcast on/off,
// VP9, etc) without hardcoding simulcast:false.
async function publishRawTrackAdvanced(mediaStreamTrack, opts) {
  await room.localParticipant.publishTrack(mediaStreamTrack, {
    videoEncoding: opts.encoding,
    simulcast: !!opts.simulcast,
    source: Track.Source.ScreenShare,
    ...(opts.videoCodec ? { videoCodec: opts.videoCodec } : {}),
    ...(opts.videoSimulcastLayers ? { videoSimulcastLayers: opts.videoSimulcastLayers } : {}),
  });
  return true;
}

async function publishScreenShare(opts) {
  const captureOptions = {
    audio: false,
    resolution: opts.resolution,
    contentHint: "motion",
  };
  if (opts.preferCurrentTab) captureOptions.preferCurrentTab = true;
  if (opts.surfaceSwitching) captureOptions.surfaceSwitching = opts.surfaceSwitching;
  const publishOptions = {
    videoEncoding: opts.encoding,
    simulcast: false,
  };
  await Promise.race([
    room.localParticipant.setScreenShareEnabled(true, captureOptions, publishOptions),
    new Promise((_, reject) => setTimeout(() => reject(new Error("screenshare-timeout: no matching capture source (picker never resolved)")), 9000)),
  ]);
  return true;
}

// Same moving-content generator as tab-content.html, run inline in the
// publisher's own page so `preferCurrentTab: true` can self-capture it --
// sidesteps relying on --auto-select-desktop-capture-source string-matching
// a *different* tab (unreliable across Chrome versions/picker UI changes).
function startAnimatedCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  let frame = 0;
  function draw() {
    frame++;
    const w = canvas.width, h = canvas.height;
    ctx.fillStyle = "#0a0a12";
    ctx.fillRect(0, 0, w, h);
    const n = 24;
    for (let i = 0; i < n; i++) {
      const t = frame * 0.03 + i * 0.4;
      const x = (Math.sin(t) * 0.5 + 0.5) * w;
      const y = (i / n + Math.cos(t * 0.7) * 0.03) * h;
      const hue = (frame * 2 + i * 15) % 360;
      ctx.fillStyle = `hsl(${hue},80%,55%)`;
      ctx.fillRect(x - 40, y - 12, 80, 24);
    }
    const bx = (Math.sin(frame * 0.05) * 0.5 + 0.5) * w;
    const by = (Math.cos(frame * 0.08) * 0.5 + 0.5) * h;
    ctx.beginPath();
    ctx.arc(bx, by, Math.min(w, h) * 0.04, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = `${Math.round(h * 0.04)}px sans-serif`;
    ctx.fillText(`frame ${frame} t=${(performance.now() / 1000).toFixed(2)}s ${w}x${h}`, 20, h - 20);
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
}

// Public livekit-client API surface: LocalTrackPublication.track is a
// LocalVideoTrack (both exported from the package root), whose `.sender`
// getter is public (not an internal/private field) -- this is the exact
// path a production fix would use, no private APIs involved.
function getScreenShareSender() {
  return room.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track?.sender;
}

function getLocalTrackSettings(source) {
  const pub = room.localParticipant.getTrackPublication(
    source === "screen_share" ? Track.Source.ScreenShare : Track.Source.Camera,
  );
  const mst = pub?.track?.mediaStreamTrack;
  if (!mst) return null;
  return { settings: mst.getSettings(), label: mst.label };
}

function getRenderStats() {
  const el = window.__remoteVideoEl;
  if (!el) return null;
  const q = el.getVideoPlaybackQuality ? el.getVideoPlaybackQuality() : null;
  return {
    videoWidth: el.videoWidth,
    videoHeight: el.videoHeight,
    totalVideoFrames: q?.totalVideoFrames ?? null,
    droppedVideoFrames: q?.droppedVideoFrames ?? null,
    now: performance.now(),
  };
}

async function disconnectAll() {
  try {
    if (room) await room.disconnect();
  } catch {
    // ignore
  }
  room = null;
  window.__room = null;
}

window.__harness = {
  connect,
  publishCamera,
  publishScreenShare,
  publishRawTrack,
  publishRawTrackAdvanced,
  getScreenShareSender,
  getLocalTrackSettings,
  getRenderStats,
  disconnectAll,
  startAnimatedCanvas,
};
window.__harnessReady = true;
