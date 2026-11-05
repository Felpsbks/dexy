// Soundboard: sounds are synthesized locally, so a press only sends a tiny
// LiveKit data message and every client in the call plays it itself.
export const SOUNDBOARD_TOPIC = "dexy-soundboard";

export const SOUNDS = [
  { id: "airhorn", label: "Buzina", emoji: "📯" },
  { id: "bell", label: "Sino", emoji: "🔔" },
  { id: "laser", label: "Laser", emoji: "🔫" },
  { id: "sad", label: "Trombone triste", emoji: "🎺" },
  { id: "applause", label: "Aplausos", emoji: "👏" },
  { id: "drumroll", label: "Ba dum tss", emoji: "🥁" },
] as const;
export type SoundId = (typeof SOUNDS)[number]["id"];

// Deafened users hear nothing from the call, sounds included.
let muted = false;
export const setSoundboardMuted = (value: boolean) => {
  muted = value;
};

let ctx: AudioContext | null = null;
function audio() {
  if (!ctx || ctx.state === "closed") ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(c: AudioContext, out: AudioNode, type: OscillatorType, freqs: [number, number], t0: number, dur: number, vol: number) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freqs[0], t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, freqs[1]), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  g.connect(out);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(c: AudioContext, out: AudioNode, t0: number, dur: number, vol: number, hp = 800) {
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = c.createBufferSource();
  s.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = hp;
  const g = c.createGain();
  g.gain.value = vol;
  s.connect(f);
  f.connect(g);
  g.connect(out);
  s.start(t0);
}

export function playSound(id: string, volume = 0.5) {
  if (muted) return;
  const c = audio();
  const out = c.createGain();
  out.gain.value = volume;
  out.connect(c.destination);
  const t = c.currentTime + 0.01;
  switch (id as SoundId) {
    case "airhorn":
      for (const d of [0, 0.22, 0.44]) for (const f of [440, 554, 659]) tone(c, out, "sawtooth", [f, f * 0.98], t + d, 0.2, 0.25);
      break;
    case "bell":
      for (const [f, v] of [[880, 0.5], [1760, 0.25], [2640, 0.12]] as const) tone(c, out, "sine", [f, f], t, 1.4, v);
      break;
    case "laser":
      tone(c, out, "square", [1800, 120], t, 0.35, 0.3);
      break;
    case "sad":
      [[392, 0], [370, 0.35], [349, 0.7], [330, 1.05]].forEach(([f, d]) => tone(c, out, "sawtooth", [f, f * (d === 1.05 ? 0.9 : 1)], t + d, d === 1.05 ? 0.9 : 0.32, 0.3));
      break;
    case "applause":
      for (let i = 0; i < 40; i++) noise(c, out, t + Math.random() * 1.6, 0.05, 0.25, 1500);
      break;
    case "drumroll":
      tone(c, out, "sine", [160, 60], t, 0.14, 0.7);
      tone(c, out, "sine", [160, 60], t + 0.2, 0.14, 0.7);
      noise(c, out, t + 0.4, 0.5, 0.35, 5000);
      break;
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const encodeSound = (id: SoundId) => encoder.encode(JSON.stringify({ id }));
export function decodeSound(payload: Uint8Array): string | null {
  try {
    const { id } = JSON.parse(decoder.decode(payload));
    return SOUNDS.some((s) => s.id === id) ? id : null;
  } catch {
    return null;
  }
}
