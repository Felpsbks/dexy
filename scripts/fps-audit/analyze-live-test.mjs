// Fase 7.6 -- processes scripts/fps-audit/results/live-dexy-test.json (raw
// getStats() samples from the real Dexy app, real screen share, real Chrome
// tab picked by a human) into exactly the deltas/table the user asked for.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const samples = JSON.parse(readFileSync(path.join(__dirname, "results", "live-dexy-test.json"), "utf8"));

function findAll(statsArr, type, kind) {
  const out = [];
  for (const pcEntry of statsArr) {
    for (const item of pcEntry.items) {
      if (item.type === type && (!kind || item.kind === kind)) out.push({ item, allItems: pcEntry.items });
    }
  }
  return out;
}
function findCodecMime(allItems, codecId) {
  const c = allItems.find((i) => i.type === "codec" && i.id === codecId);
  return c ? { mimeType: c.mimeType, payloadType: c.payloadType, clockRate: c.clockRate } : null;
}
function activeCandidatePair(statsArr) {
  for (const pcEntry of statsArr) {
    for (const item of pcEntry.items) {
      if (item.type === "candidate-pair" && item.state === "succeeded" && typeof item.currentRoundTripTime === "number") {
        return item;
      }
    }
  }
  return null;
}
// Pick whichever video outbound-rtp entry is actually active (highest
// framesPerSecond/bytesSent) -- same defensive logic as the earlier harness,
// in case simulcast ever puts more than one video row in the report.
function activeOutboundVideo(statsArr) {
  const all = findAll(statsArr, "outbound-rtp", "video");
  let best = null;
  for (const r of all) {
    const score = (r.item.framesPerSecond ?? 0) * 1e9 + (r.item.bytesSent ?? 0);
    if (!best || score > best.score) best = { ...r, score };
  }
  return best;
}
function activeInboundVideo(statsArr) {
  const all = findAll(statsArr, "inbound-rtp", "video");
  let best = null;
  for (const r of all) {
    const score = (r.item.framesPerSecond ?? 0) * 1e9 + (r.item.bytesReceived ?? 0);
    if (!best || score > best.score) best = { ...r, score };
  }
  return best;
}

console.log(`Total de amostras: ${samples.length}`);
const t0 = samples[0].t;
const tN = samples[samples.length - 1].t;
console.log(`Janela real coberta: ${((tN - t0) / 1000).toFixed(1)}s\n`);

// --- raw values, sample by sample (outbound side = A/sharer) ---
console.log("=== OUTBOUND (A, remetente do screen share) — bruto por amostra ===");
const outRows = [];
for (const s of samples) {
  const out = activeOutboundVideo(s.statsA);
  if (!out) continue;
  const codec = findCodecMime(out.allItems, out.item.codecId);
  outRows.push({
    t: s.t,
    framesPerSecond: out.item.framesPerSecond,
    framesEncoded: out.item.framesEncoded,
    frameWidth: out.item.frameWidth,
    frameHeight: out.item.frameHeight,
    bytesSent: out.item.bytesSent,
    qualityLimitationReason: out.item.qualityLimitationReason,
    qualityLimitationDurations: out.item.qualityLimitationDurations,
    codecId: out.item.codecId,
    codec,
  });
}
console.table(outRows.map((r) => ({
  t: new Date(r.t).toISOString().slice(11, 19),
  fps: r.framesPerSecond,
  framesEncoded: r.framesEncoded,
  res: `${r.frameWidth}x${r.frameHeight}`,
  bytesSent: r.bytesSent,
  qlr: r.qualityLimitationReason,
})));

console.log("\n=== INBOUND (B, receptor) — bruto por amostra ===");
const inRows = [];
for (const s of samples) {
  const inn = activeInboundVideo(s.statsB);
  if (!inn) continue;
  const codec = findCodecMime(inn.allItems, inn.item.codecId);
  inRows.push({
    t: s.t,
    framesPerSecond: inn.item.framesPerSecond,
    framesDecoded: inn.item.framesDecoded,
    framesDropped: inn.item.framesDropped,
    frameWidth: inn.item.frameWidth,
    frameHeight: inn.item.frameHeight,
    bytesReceived: inn.item.bytesReceived,
    packetsLost: inn.item.packetsLost,
    jitter: inn.item.jitter,
    codecId: inn.item.codecId,
    codec,
  });
}
console.table(inRows.map((r) => ({
  t: new Date(r.t).toISOString().slice(11, 19),
  fps: r.framesPerSecond,
  framesDecoded: r.framesDecoded,
  framesDropped: r.framesDropped,
  res: `${r.frameWidth}x${r.frameHeight}`,
  bytesReceived: r.bytesReceived,
  packetsLost: r.packetsLost,
  jitter: r.jitter,
})));

console.log("\n=== CANDIDATE-PAIR ativo (A) — bruto por amostra ===");
const cpRows = [];
for (const s of samples) {
  const cp = activeCandidatePair(s.statsA);
  if (!cp) continue;
  cpRows.push({
    t: s.t,
    currentRoundTripTime: cp.currentRoundTripTime,
    availableOutgoingBitrate: cp.availableOutgoingBitrate,
    availableIncomingBitrate: cp.availableIncomingBitrate,
    bytesSent: cp.bytesSent,
    bytesReceived: cp.bytesReceived,
  });
}
console.table(cpRows.map((r) => ({
  t: new Date(r.t).toISOString().slice(11, 19),
  rttMs: r.currentRoundTripTime != null ? (r.currentRoundTripTime * 1000).toFixed(1) : null,
  outKbps: r.availableOutgoingBitrate != null ? (r.availableOutgoingBitrate / 1000).toFixed(0) : null,
  inKbps: r.availableIncomingBitrate != null ? (r.availableIncomingBitrate / 1000).toFixed(0) : null,
})));

// --- deltas over the full window (cumulative-counter based, as requested) ---
function delta(rows, field) {
  const first = rows[0], last = rows[rows.length - 1];
  const dt = (last.t - first.t) / 1000;
  if (first[field] == null || last[field] == null || dt <= 0) return null;
  return { value: (last[field] - first[field]) / dt, dt, from: first[field], to: last[field] };
}

console.log("\n\n=== CÁLCULOS (delta de contadores cumulativos / tempo) ===");
const fpsEnviado = delta(outRows, "framesEncoded");
const bitrateEnviado = delta(outRows, "bytesSent");
const fpsRecebido = delta(inRows, "framesDecoded");
const bitrateRecebido = delta(inRows, "bytesReceived");

console.log(`FPS enviado    = ΔframesEncoded/Δt = (${fpsEnviado.to} - ${fpsEnviado.from}) / ${fpsEnviado.dt.toFixed(1)}s = ${fpsEnviado.value.toFixed(2)} fps`);
console.log(`FPS recebido/decodificado = ΔframesDecoded/Δt = (${fpsRecebido.to} - ${fpsRecebido.from}) / ${fpsRecebido.dt.toFixed(1)}s = ${fpsRecebido.value.toFixed(2)} fps`);
console.log(`Bitrate enviado = ΔbytesSent×8/Δt = ${(bitrateEnviado.value * 8 / 1000).toFixed(1)} kbps`);
console.log(`Bitrate recebido = ΔbytesReceived×8/Δt = ${(bitrateRecebido.value * 8 / 1000).toFixed(1)} kbps`);

const framesDroppedFirst = inRows[0].framesDropped, framesDroppedLast = inRows[inRows.length - 1].framesDropped;
console.log(`framesDropped: ${framesDroppedFirst} -> ${framesDroppedLast} (Δ=${framesDroppedLast - framesDroppedFirst})`);

const packetsLostFirst = inRows[0].packetsLost, packetsLostLast = inRows[inRows.length - 1].packetsLost;
console.log(`packetsLost: ${packetsLostFirst} -> ${packetsLostLast} (Δ=${packetsLostLast - packetsLostFirst})`);

const avgJitterMs = inRows.reduce((a, r) => a + (r.jitter ?? 0), 0) / inRows.length * 1000;
const avgRttMs = cpRows.reduce((a, r) => a + (r.currentRoundTripTime ?? 0), 0) / cpRows.length * 1000;
console.log(`jitter médio: ${avgJitterMs.toFixed(2)} ms`);
console.log(`RTT médio: ${avgRttMs.toFixed(2)} ms`);

const qlrValues = [...new Set(outRows.map((r) => r.qualityLimitationReason))];
console.log(`qualityLimitationReason observados: ${qlrValues.join(", ")}`);
console.log(`qualityLimitationDurations (última amostra):`, outRows[outRows.length - 1].qualityLimitationDurations);

console.log(`\nCodec outbound: ${JSON.stringify(outRows.find((r) => r.codec)?.codec)}`);
console.log(`Codec inbound: ${JSON.stringify(inRows.find((r) => r.codec)?.codec)}`);
console.log(`Resolução enviada (última amostra): ${outRows[outRows.length - 1].frameWidth}x${outRows[outRows.length - 1].frameHeight}`);
console.log(`Resolução recebida (última amostra): ${inRows[inRows.length - 1].frameWidth}x${inRows[inRows.length - 1].frameHeight}`);

writeFileSync(
  path.join(__dirname, "results", "live-dexy-test-analysis.json"),
  JSON.stringify({ outRows, inRows, cpRows, fpsEnviado, fpsRecebido, bitrateEnviado, bitrateRecebido }, null, 2),
);
console.log("\n[salvo] scripts/fps-audit/results/live-dexy-test-analysis.json");
