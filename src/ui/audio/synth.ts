/**
 * The game's sounds, synthesized with Web Audio (AW-31, AW-281; docs/audio.md). Each recipe builds a
 * short-lived graph starting at `t`; nodes stop themselves. Every sound goes out through a Mix: the dry
 * signal (panned) plus a send to the shared reverb, so things sit in a space instead of beeping in a void.
 * No files except the voice call-outs (engine.ts): tweak a number here and reload.
 */
import type { LoopHandle } from "./engine";

export type SoundId =
  | "click"
  | "blocked"
  | "notify"
  | "credits"
  | "purchase"
  | "levelup"
  | "discovery"
  | "fold"
  | "land"
  | "liftoff"
  | "dock"
  | "undock"
  | "orbit"
  // AW-281
  | "refuel"
  | "scan"
  | "survey"
  | "probe"
  | "danger"
  | "bayOpen"
  | "bayClose"
  | "splash"
  | "hop"
  | "recharge"
  | "drill"
  | "mineral"
  | "lifeform"
  // AW-285: the rest of the surface
  | "prospect"
  | "sample"
  | "stun"
  | "net"
  | "roverHit"
  | "storm"
  | "quake"
  | "breakdown";

export type LoopId = "burn" | "rover" | "boat" | "drill";

/** Where a sound goes: the bus itself, and that bus's send to the reverb. */
export interface Mix {
  dry: AudioNode;
  wet: AudioNode;
}

type Recipe = (ctx: AudioContext, mix: Mix, t: number) => void;

// --- building blocks ----------------------------------------------------------------------

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Two seconds of white noise, made once per context. */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, b);
  }
  return b;
}

/** A small room-and-hull reverb: two channels of decaying noise, a little darker as it fades. */
export function reverbImpulse(ctx: BaseAudioContext, seconds = 2.2): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const x = i / len;
      const k = 0.35 + 0.6 * (1 - x); // darker toward the tail
      lp = lp + k * (Math.random() * 2 - 1 - lp);
      d[i] = lp * Math.pow(1 - x, 2.6);
    }
  }
  return b;
}

export const rand = (a: number, b: number): number => a + Math.random() * (b - a);

/** A send point for one sound: panned into the bus, with `verb` of it sent to the reverb. */
export function route(ctx: AudioContext, mix: Mix, o: { pan?: number; verb?: number } = {}): GainNode {
  const input = ctx.createGain();
  if (o.pan && typeof ctx.createStereoPanner === "function") {
    const p = ctx.createStereoPanner();
    p.pan.value = o.pan;
    input.connect(p).connect(mix.dry);
  } else input.connect(mix.dry);
  const send = ctx.createGain();
  send.gain.value = o.verb ?? 0.2;
  input.connect(send).connect(mix.wet);
  return input;
}

/** An attack/decay envelope on a gain node: rises to `peak` in `attack` s, falls away over `decay` s. */
export function env(ctx: AudioContext, t: number, peak: number, attack: number, decay: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

interface ToneOpts {
  type?: OscillatorType;
  f0: number;
  f1?: number;
  peak: number;
  attack?: number;
  decay: number;
  glide?: number;
  /** Extra voices this many cents apart, for a fuller sound. */
  detune?: number;
  /** Lowpass the tone (Hz), optionally sweeping to `lp1`. */
  lp?: number;
  lp1?: number;
}

/** A tone from `f0` gliding to `f1`, enveloped; with `detune`, three voices spread for width. */
export function tone(ctx: AudioContext, out: AudioNode, t: number, o: ToneOpts): void {
  const attack = o.attack ?? 0.005;
  const end = t + attack + o.decay + 0.05;
  const g = env(ctx, t, o.peak, attack, o.decay);
  let head: AudioNode = g;
  if (o.lp) {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(o.lp, t);
    if (o.lp1) f.frequency.exponentialRampToValueAtTime(o.lp1, t + attack + o.decay);
    f.connect(g);
    head = f;
  }
  g.connect(out);
  const spread = o.detune ? [-o.detune, 0, o.detune] : [0];
  for (const cents of spread) {
    const osc = ctx.createOscillator();
    osc.type = o.type ?? "sine";
    osc.detune.value = cents;
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(o.f1, t + (o.glide ?? o.decay));
    const v = ctx.createGain();
    v.gain.value = 1 / spread.length;
    osc.connect(v).connect(head);
    osc.start(t);
    osc.stop(end);
  }
}

/** A burst of filtered noise; the filter can sweep from `f0` to `f1`. */
export function noise(
  ctx: AudioContext,
  out: AudioNode,
  t: number,
  o: { filter?: BiquadFilterType; f0: number; f1?: number; q?: number; peak: number; attack?: number; decay: number; sweep?: number },
): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = o.filter ?? "lowpass";
  f.Q.value = o.q ?? 0.7;
  f.frequency.setValueAtTime(o.f0, t);
  const len = (o.attack ?? 0.005) + o.decay;
  if (o.f1 !== undefined) f.frequency.exponentialRampToValueAtTime(o.f1, t + (o.sweep ?? len));
  const g = env(ctx, t, o.peak, o.attack ?? 0.005, o.decay);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 1.5);
  src.stop(t + len + 0.05);
  return src;
}

/** Struck metal: a few inharmonic partials over a click, the high ones dying first. */
export function metal(ctx: AudioContext, out: AudioNode, t: number, f: number, peak: number, decay: number, ratios = [1, 1.47, 2.09, 2.56, 3.9]): void {
  ratios.forEach((r, i) => tone(ctx, out, t, { type: i === 0 ? "triangle" : "sine", f0: f * r * rand(0.995, 1.005), peak: peak / (1 + i * 0.7), attack: 0.002, decay: decay / (1 + i * 0.5) }));
  noise(ctx, out, t, { filter: "bandpass", f0: Math.min(9000, f * 3), q: 1.2, peak: peak * 0.6, decay: 0.03 });
}

/** A bubble: a sine whose pitch jumps up as it pops. */
export function bubble(ctx: AudioContext, out: AudioNode, t: number, f: number, peak: number): void {
  tone(ctx, out, t, { f0: f, f1: f * rand(1.6, 2.3), glide: 0.05, peak, attack: 0.004, decay: rand(0.04, 0.08) });
}

/** A heavy thud: a falling sub tone and a low noise burst. */
export function thud(ctx: AudioContext, out: AudioNode, t: number, peak: number, f = 85): void {
  tone(ctx, out, t, { f0: f, f1: f * 0.45, peak, decay: 0.35 });
  noise(ctx, out, t, { f0: 600, f1: 90, peak: peak * 0.7, decay: 0.25 });
}

/** A sustained level: ramps up over `rise`, holds, and ramps down over `fall`, ending at t + dur. */
export function hold(ctx: AudioContext, t: number, dur: number, peak: number, rise = 0.15, fall = 0.2): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + rise);
  g.gain.setValueAtTime(peak, t + dur - fall);
  g.gain.linearRampToValueAtTime(0, t + dur);
  return g;
}

/**
 * A heavy industrial door running on its track for `dur` s from t: a steady motor drone (no pitch glide),
 * the deep rumble of the slab, and the chatter of the drive chain.
 */
function doorTravel(ctx: AudioContext, out: AudioNode, t: number, dur: number): void {
  const motor = ctx.createOscillator();
  motor.type = "square";
  motor.frequency.value = 50;
  const ml = ctx.createBiquadFilter();
  ml.type = "lowpass";
  ml.frequency.value = 220;
  const mg = hold(ctx, t, dur, 0.06);
  motor.connect(ml).connect(mg).connect(out);
  motor.start(t);
  motor.stop(t + dur + 0.05);
  const slab = ctx.createBufferSource();
  slab.buffer = noiseBuffer(ctx);
  slab.loop = true;
  const sl = ctx.createBiquadFilter();
  sl.type = "lowpass";
  sl.frequency.value = 170;
  sl.Q.value = 1.5;
  const sg = hold(ctx, t, dur, 0.5, 0.25, 0.25);
  slab.connect(sl).connect(sg).connect(out);
  slab.start(t, Math.random());
  slab.stop(t + dur + 0.05);
  // The chain: quick metallic ticks, a little uneven.
  for (let at = t + 0.1; at < t + dur - 0.1; at += rand(0.06, 0.09)) {
    noise(ctx, out, at, { filter: "bandpass", f0: rand(1300, 2100), q: 4, peak: rand(0.025, 0.045), attack: 0.002, decay: 0.02 });
  }
}

/** A gain whose level flutters, like air or engine turbulence. */
export function turbulence(ctx: AudioContext, t: number, stop: number, depth = 0.3): GainNode {
  const g = ctx.createGain();
  g.gain.value = 1 - depth;
  for (const [hz, d] of [
    [7.3, depth * 0.6],
    [12.9, depth * 0.4],
  ] as const) {
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    lfo.frequency.value = hz * rand(0.9, 1.1);
    lg.gain.value = d;
    lfo.connect(lg).connect(g.gain);
    lfo.start(t);
    lfo.stop(stop);
  }
  return g;
}

/** One drill strike: a hammer on steel, with the thump of the bit underneath. */
function strike(ctx: AudioContext, out: AudioNode, t: number, peak = 0.16): void {
  metal(ctx, out, t, 540 * rand(0.97, 1.03), peak, 0.35, [1, 2.76, 5.4, 8.9]);
  thud(ctx, out, t, peak * 0.8, 110);
}

/** A low-frequency oscillator wobbling `target` by `depth`. */
export function lfo(ctx: AudioContext, hz: number, depth: number, target: AudioParam): OscillatorNode {
  const o = ctx.createOscillator();
  const d = ctx.createGain();
  o.frequency.value = hz;
  d.gain.value = depth;
  o.connect(d).connect(target);
  return o;
}

// --- the sounds ---------------------------------------------------------------------------

export const RECIPES: Record<SoundId, Recipe> = {
  // A button: a soft, dry tick.
  click: (ctx, mix, t) => {
    const o = route(ctx, mix, { verb: 0.05 });
    tone(ctx, o, t, { f0: 1500, f1: 1100, peak: 0.06, decay: 0.025 });
    noise(ctx, o, t, { filter: "bandpass", f0: 3500, q: 2, peak: 0.05, decay: 0.015 });
  },

  // Can't do that: a low, dull thunk.
  blocked: (ctx, mix, t) => {
    const o = route(ctx, mix, { verb: 0.1 });
    tone(ctx, o, t, { type: "square", f0: 150, f1: 105, peak: 0.11, decay: 0.12, lp: 900 });
    tone(ctx, o, t + 0.07, { type: "square", f0: 118, f1: 90, peak: 0.09, decay: 0.12, lp: 900 });
  },

  // A notice: a soft two-blip data chirp, not a bell.
  notify: (ctx, mix, t) => {
    const o = route(ctx, mix, { verb: 0.15 });
    tone(ctx, o, t, { type: "square", f0: 620, peak: 0.04, decay: 0.05, lp: 1600 });
    tone(ctx, o, t + 0.07, { type: "square", f0: 930, peak: 0.035, decay: 0.07, lp: 1800 });
  },

  // Credits in (a sale, a bounty): a cash register. Keys clack, the bell rings, the drawer slides out, coins rattle.
  credits: (ctx, mix, t) => {
    const o = route(ctx, mix, { verb: 0.15 });
    for (const dt of [0, 0.07]) {
      noise(ctx, o, t + dt, { filter: "bandpass", f0: 2600, q: 2.5, peak: 0.1, decay: 0.03 });
      tone(ctx, o, t + dt, { f0: 320, f1: 200, peak: 0.06, decay: 0.04 });
    }
    // The bell: a bright, slightly clangy ding.
    metal(ctx, o, t + 0.16, 2093, 0.13, 0.9, [1, 2.0, 2.76, 4.1]);
    // The drawer: a rolling rumble ending in a thunk.
    noise(ctx, o, t + 0.2, { filter: "bandpass", f0: 700, f1: 350, q: 1.2, peak: 0.12, attack: 0.03, decay: 0.22 });
    thud(ctx, o, t + 0.42, 0.16, 120);
    for (let i = 0; i < 4; i++) {
      const c = route(ctx, mix, { pan: rand(-0.4, 0.4), verb: 0.15 });
      metal(ctx, c, t + 0.44 + i * 0.05 + rand(0, 0.03), rand(2600, 3400), 0.035, rand(0.08, 0.16), [1, 1.73, 2.61]);
    }
  },

  // Money out (a purchase): the keys and the drawer, no bell.
  purchase: (ctx, mix, t) => {
    const o = route(ctx, mix, { verb: 0.12 });
    noise(ctx, o, t, { filter: "bandpass", f0: 2400, q: 2, peak: 0.12, decay: 0.05 });
    tone(ctx, o, t + 0.02, { f0: 110, f1: 70, peak: 0.18, decay: 0.12 });
    noise(ctx, o, t + 0.09, { filter: "bandpass", f0: 900, f1: 400, q: 1.5, peak: 0.08, decay: 0.15 });
  },

  // A level up: a warm, wide arpeggio over a swelling pad.
  levelup: (ctx, mix, t) => {
    const o = route(ctx, mix, { verb: 0.45 });
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      tone(ctx, o, t + i * 0.09, { type: "sawtooth", f0: f, peak: 0.1, decay: 0.55, detune: 9, lp: 2600, lp1: 900 }),
    );
    tone(ctx, o, t + 0.3, { type: "triangle", f0: 261.63, peak: 0.08, attack: 0.25, decay: 1.2, detune: 6 });
    noise(ctx, o, t + 0.3, { filter: "highpass", f0: 6000, peak: 0.025, attack: 0.2, decay: 0.6 });
  },

  // Something found (not on the ground: those get a voice): a sonar ping in a big space.
  discovery: (ctx, mix, t) => {
    const o = route(ctx, mix, { verb: 0.6 });
    tone(ctx, o, t, { f0: 1320, f1: 1250, peak: 0.12, decay: 0.6 });
    tone(ctx, o, t, { f0: 660, f1: 625, peak: 0.04, decay: 0.5 });
  },

  // A fold: the drive spools up, then space pinches shut with a boom. (Liked as it is; now with a space to boom in.)
  fold: (ctx, mix, t) => {
    const out = route(ctx, mix, { verb: 0.35 });
    const spool = ctx.createOscillator();
    spool.type = "sawtooth";
    spool.frequency.setValueAtTime(70, t);
    spool.frequency.exponentialRampToValueAtTime(620, t + 1.2);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.exponentialRampToValueAtTime(3200, t + 1.2);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.exponentialRampToValueAtTime(0.09, t + 1.1);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
    spool.connect(lp).connect(sg).connect(out);
    spool.start(t);
    spool.stop(t + 1.35);
    noise(ctx, out, t, { filter: "bandpass", f0: 400, f1: 4000, q: 1.5, peak: 0.05, attack: 1.1, decay: 0.15 });
    noise(ctx, out, t + 1.2, { f0: 900, f1: 60, peak: 0.35, decay: 1.6 });
    tone(ctx, out, t + 1.2, { f0: 90, f1: 32, peak: 0.35, decay: 1.4 });
  },

  // Landing: the descent's roar, ragged with turbulence, dies away; then the legs take the weight.
  land: (ctx, mix, t) => {
    const o = route(ctx, mix, { verb: 0.25 });
    const tb = turbulence(ctx, t, t + 1.8, 0.35);
    tb.connect(o);
    noise(ctx, tb, t, { f0: 1600, f1: 220, peak: 0.2, attack: 0.25, decay: 1.4 });
    tone(ctx, tb, t, { type: "sawtooth", f0: 55, f1: 42, peak: 0.08, attack: 0.25, decay: 1.4, lp: 200 });
    thud(ctx, o, t + 1.55, 0.3, 80);
    metal(ctx, o, t + 1.6, 190, 0.05, 0.3);
    noise(ctx, o, t + 1.7, { filter: "highpass", f0: 2500, peak: 0.04, attack: 0.05, decay: 0.6 });
  },

  // Lift-off: a rising, ragged roar that climbs away.
  liftoff: (ctx, mix, t) => {
    const o = route(ctx, mix, { verb: 0.3 });
    const tb = turbulence(ctx, t, t + 2.4, 0.35);
    tb.connect(o);
    noise(ctx, tb, t, { f0: 260, f1: 2600, peak: 0.34, attack: 0.5, decay: 1.8 });
    tone(ctx, tb, t, { type: "sawtooth", f0: 40, f1: 85, peak: 0.16, attack: 0.4, decay: 1.6, lp: 260 });
  },

  // Docking: the clamps ring on the hull, then the airlock hisses.
  dock: (ctx, mix, t) => {
    const o = route(ctx, mix, { verb: 0.35 });
    for (const dt of [0, 0.22]) {
      thud(ctx, o, t + dt, 0.22, 120);
      metal(ctx, o, t + dt, 210, 0.07, 0.5);
    }
    noise(ctx, o, t + 0.5, { filter: "highpass", f0: 3000, f1: 5000, peak: 0.07, attack: 0.05, decay: 0.9 });
  },

  // Undocking: the hiss first, then the clamps let go.
  undock: (ctx, mix, t) => {
    const o = route(ctx, mix, { verb: 0.35 });
    noise(ctx, o, t, { filter: "highpass", f0: 5000, f1: 3000, peak: 0.07, attack: 0.05, decay: 0.7 });
    metal(ctx, o, t + 0.75, 230, 0.07, 0.4);
    tone(ctx, o, t + 0.75, { f0: 100, f1: 140, peak: 0.18, decay: 0.2 });
  },

  // Into orbit: the burn eases off and the ship settles.
  orbit: (ctx, mix, t) => {
    const o = route(ctx, mix, { verb: 0.4 });
    noise(ctx, o, t, { f0: 600, f1: 150, peak: 0.07, attack: 0.05, decay: 0.8 });
    tone(ctx, o, t + 0.1, { type: "triangle", f0: 330, f1: 220, peak: 0.06, decay: 0.7, detune: 8 });
  },

  // Fuel: liquid pouring into the tanks, gurgling and bubbling, with the pump underneath.
  refuel: (ctx, mix, t) => {
    const o = route(ctx, mix, { verb: 0.2 });
    const dur = 1.9;
    const slosh = turbulence(ctx, t, t + dur + 0.3, 0.45);
    slosh.connect(o);
    noise(ctx, slosh, t, { filter: "bandpass", f0: 700, f1: 450, q: 1.1, peak: 0.12, attack: 0.15, decay: dur });
    noise(ctx, slosh, t, { f0: 260, peak: 0.1, attack: 0.15, decay: dur });
    for (let i = 0; i < 34; i++) {
      const at = t + 0.1 + Math.random() * (dur - 0.3);
      bubble(ctx, o, at, rand(260, 750) * (1 + (at - t) * 0.15), rand(0.03, 0.08));
    }
    tone(ctx, o, t, { type: "square", f0: 98, peak: 0.015, attack: 0.2, decay: dur, lp: 400 });
  },

  // An orbital scan: the array sweeps, then reports.
  scan: (ctx, mix, t) => {
    const o = route(ctx, mix, { verb: 0.4, pan: -0.2 });
    noise(ctx, o, t, { filter: "bandpass", f0: 400, f1: 3200, q: 8, peak: 0.2, attack: 0.3, decay: 0.9 });
    tone(ctx, o, t, { f0: 300, f1: 1400, peak: 0.08, attack: 0.3, decay: 0.9, detune: 12 });
    [0, 0.12, 0.24].forEach((dt, i) => tone(ctx, o, t + 1.25 + dt, { type: "square", f0: 880 + i * 220, peak: 0.05, decay: 0.05, lp: 2000 }));
  },

  // A detailed survey: a stylus scratching notes on a chart.
  survey: (ctx, mix, t) => {
    let at = t;
    const end = t + 1.6;
    while (at < end) {
      const len = rand(0.05, 0.16);
      const f = rand(2600, 5200);
      const o = route(ctx, mix, { pan: rand(-0.25, 0.25), verb: 0.08 });
      noise(ctx, o, at, { filter: "bandpass", f0: f, f1: f * rand(0.75, 1.35), q: rand(2, 5), peak: rand(0.12, 0.24), attack: 0.012, decay: len });
      at += len + rand(0.015, 0.07);
    }
    // The page turns at the end.
    noise(ctx, route(ctx, mix, { verb: 0.1 }), end + 0.05, { filter: "bandpass", f0: 1800, f1: 900, q: 0.8, peak: 0.1, attack: 0.04, decay: 0.25 });
  },

  // A probe released: a clunk, then it whooshes away down into the air.
  probe: (ctx, mix, t) => {
    metal(ctx, route(ctx, mix, { verb: 0.3 }), t, 300, 0.07, 0.25);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 2.5;
    bp.frequency.setValueAtTime(3800, t + 0.1);
    bp.frequency.exponentialRampToValueAtTime(260, t + 2.1);
    const g = env(ctx, t + 0.1, 0.6, 0.45, 1.6);
    const out = ctx.createGain();
    if (typeof ctx.createStereoPanner === "function") {
      const p = ctx.createStereoPanner();
      p.pan.setValueAtTime(-0.7, t + 0.1);
      p.pan.linearRampToValueAtTime(0.7, t + 2.1);
      out.connect(p).connect(mix.dry);
    } else out.connect(mix.dry);
    const send = ctx.createGain();
    send.gain.value = 0.35;
    out.connect(send).connect(mix.wet);
    src.connect(bp).connect(g).connect(out);
    src.start(t + 0.1);
    src.stop(t + 2.3);
    tone(ctx, out, t + 0.1, { f0: 240, f1: 90, peak: 0.04, attack: 0.4, decay: 1.5 });
  },

  // A raider hails: a low, dissonant swell with a hit and a trembling high note. Something is wrong.
  danger: (ctx, mix, t) => {
    const o = route(ctx, mix, { verb: 0.55 });
    for (const f of [55, 58.27, 77.78]) tone(ctx, o, t, { type: "sawtooth", f0: f, peak: 0.09, attack: 1.0, decay: 2.2, detune: 7, lp: 180, lp1: 1400 });
    thud(ctx, o, t, 0.26, 70);
    tone(ctx, o, t, { f0: 62, f1: 40, peak: 0.2, decay: 1.6 });
    const hi = ctx.createGain();
    hi.gain.value = 0.6;
    const trem = ctx.createOscillator();
    const td = ctx.createGain();
    trem.frequency.value = 9;
    td.gain.value = 0.4;
    trem.connect(td).connect(hi.gain);
    trem.start(t);
    trem.stop(t + 3.4);
    hi.connect(o);
    tone(ctx, hi, t + 0.3, { type: "triangle", f0: 1244.5, f1: 1174.7, glide: 2.6, peak: 0.035, attack: 0.9, decay: 2.0 });
  },

  // The rover bay opens: a heavy industrial door. The locks release, the slab grinds along its track, and it booms into its stops.
  bayOpen: (ctx, mix, t) => {
    const o = route(ctx, mix, { verb: 0.4 });
    // The locks let go with a clank and the seals vent.
    metal(ctx, o, t, 95, 0.14, 0.7);
    thud(ctx, o, t, 0.22, 75);
    noise(ctx, o, t + 0.06, { filter: "highpass", f0: 2800, f1: 1800, peak: 0.06, attack: 0.02, decay: 0.4 });
    doorTravel(ctx, o, t + 0.25, 1.3);
    // It hits its stops: a heavy boom with a ring.
    thud(ctx, o, t + 1.55, 0.3, 65);
    metal(ctx, o, t + 1.55, 80, 0.1, 0.9);
  },

  // The rover comes back aboard and the bay door runs shut and slams, then the locks drive home.
  bayClose: (ctx, mix, t) => {
    const o = route(ctx, mix, { verb: 0.4 });
    metal(ctx, o, t, 110, 0.07, 0.4);
    doorTravel(ctx, o, t + 0.05, 1.25);
    // It slams shut, the ring dies away, and the locks drive home.
    thud(ctx, o, t + 1.3, 0.3, 60);
    metal(ctx, o, t + 1.3, 72, 0.1, 1.2);
    noise(ctx, o, t + 1.3, { f0: 1800, f1: 200, peak: 0.12, decay: 0.5 });
    metal(ctx, o, t + 1.7, 130, 0.06, 0.3);
    thud(ctx, o, t + 1.7, 0.12, 90);
  },

  // A boat into the water: the splash, bubbles, and droplets falling back.
  splash: (ctx, mix, t) => {
    const o = route(ctx, mix, { verb: 0.25 });
    noise(ctx, o, t, { f0: 4500, f1: 380, peak: 0.32, attack: 0.012, decay: 0.75 });
    noise(ctx, o, t, { filter: "bandpass", f0: 500, f1: 180, q: 1, peak: 0.2, attack: 0.01, decay: 0.4 });
    for (let i = 0; i < 16; i++) bubble(ctx, o, t + rand(0.08, 0.9), rand(300, 950), rand(0.03, 0.07));
    for (let i = 0; i < 8; i++) {
      const d = route(ctx, mix, { pan: rand(-0.6, 0.6), verb: 0.25 });
      bubble(ctx, d, t + rand(0.25, 1.1), rand(1400, 2800), rand(0.015, 0.04));
    }
  },

  // The ship hops across the surface: the engines roar up, it travels, and it sets down again.
  hop: (ctx, mix, t) => {
    const o = route(ctx, mix, { verb: 0.3 });
    const tb = turbulence(ctx, t, t + 3, 0.35);
    tb.connect(o);
    noise(ctx, tb, t, { f0: 300, f1: 1900, peak: 0.22, attack: 0.6, decay: 2.0, sweep: 0.8 });
    noise(ctx, tb, t + 0.3, { filter: "bandpass", f0: 900, q: 0.6, peak: 0.08, attack: 0.4, decay: 1.6 });
    tone(ctx, tb, t, { type: "sawtooth", f0: 42, f1: 64, peak: 0.1, attack: 0.5, decay: 2.0, glide: 0.8, lp: 240 });
    thud(ctx, o, t + 2.45, 0.24, 80);
  },

  // Recharging: a machine powering up, the hum climbing, then ready.
  recharge: (ctx, mix, t) => {
    const o = route(ctx, mix, { verb: 0.25 });
    tone(ctx, o, t, { type: "sawtooth", f0: 55, f1: 440, glide: 1.4, peak: 0.18, attack: 0.3, decay: 1.25, detune: 10, lp: 250, lp1: 3200 });
    tone(ctx, o, t, { f0: 110, f1: 880, glide: 1.4, peak: 0.11, attack: 0.3, decay: 1.25 });
    tone(ctx, o, t, { type: "square", f0: 60, peak: 0.045, attack: 0.15, decay: 1.6, lp: 500 });
    noise(ctx, o, t + 0.2, { filter: "bandpass", f0: 5000, q: 4, peak: 0.045, attack: 0.6, decay: 0.7 });
    [0, 0.09].forEach((dt, i) => tone(ctx, o, t + 1.55 + dt, { type: "square", f0: i ? 1320 : 990, peak: 0.06, decay: 0.06, lp: 2400 }));
  },

  // A short drilling job: a few strikes. (Long ones run the drill loop for the time-lapse; see session.ts.)
  drill: (ctx, mix, t) => {
    const o = route(ctx, mix, { verb: 0.3 });
    for (let i = 0; i < 3; i++) strike(ctx, o, t + i * 0.9);
  },

  // Prospecting: the core sampler spins down into the rock, then the core tube clicks home.
  prospect: (ctx, mix, t) => {
    const o = route(ctx, mix, { verb: 0.2 });
    noise(ctx, o, t, { filter: "bandpass", f0: 1400, f1: 3800, q: 3, peak: 0.12, attack: 0.08, decay: 0.7 });
    tone(ctx, o, t, { type: "triangle", f0: 700, f1: 1300, glide: 0.6, peak: 0.05, attack: 0.08, decay: 0.7 });
    for (let i = 0; i < 10; i++) noise(ctx, o, t + 0.1 + i * 0.06, { filter: "bandpass", f0: rand(1800, 3000), q: 3, peak: rand(0.03, 0.07), decay: 0.02 });
    metal(ctx, o, t + 0.9, 820, 0.06, 0.15);
    noise(ctx, o, t + 0.95, { filter: "highpass", f0: 3000, peak: 0.04, attack: 0.01, decay: 0.2 });
  },

  // A sample sealed: a snip, the jar's clink, the lid's hiss and latch.
  sample: (ctx, mix, t) => {
    const o = route(ctx, mix, { verb: 0.2 });
    for (const dt of [0, 0.06]) noise(ctx, o, t + dt, { filter: "highpass", f0: 4500, peak: 0.08, decay: 0.012 });
    metal(ctx, o, t + 0.25, 3100, 0.05, 0.35, [1, 1.83, 2.7]);
    noise(ctx, o, t + 0.45, { filter: "highpass", f0: 3500, f1: 6000, peak: 0.05, attack: 0.02, decay: 0.35 });
    noise(ctx, o, t + 0.85, { filter: "bandpass", f0: 2200, q: 3, peak: 0.08, decay: 0.03 });
    tone(ctx, o, t + 0.85, { f0: 400, f1: 260, peak: 0.05, decay: 0.05 });
  },

  // The stun prod: a crackling electric zap.
  stun: (ctx, mix, t) => {
    const o = route(ctx, mix, { verb: 0.25 });
    const buzz = ctx.createGain();
    buzz.gain.value = 0.5;
    const am = ctx.createOscillator();
    const ad = ctx.createGain();
    am.type = "square";
    am.frequency.value = 60;
    ad.gain.value = 0.5;
    am.connect(ad).connect(buzz.gain);
    am.start(t);
    am.stop(t + 0.8);
    buzz.connect(o);
    noise(ctx, buzz, t, { filter: "bandpass", f0: 3200, q: 1.5, peak: 0.25, attack: 0.01, decay: 0.6 });
    tone(ctx, buzz, t, { type: "sawtooth", f0: 1200, f1: 180, glide: 0.5, peak: 0.08, attack: 0.01, decay: 0.55, lp: 4000 });
    for (let i = 0; i < 8; i++) noise(ctx, o, t + rand(0, 0.6), { filter: "highpass", f0: 5000, peak: rand(0.05, 0.12), decay: 0.01 });
  },

  // A net fired: a whoosh, the weights thump down, the mesh rustles.
  net: (ctx, mix, t) => {
    const o = route(ctx, mix, { verb: 0.25 });
    noise(ctx, o, t, { filter: "bandpass", f0: 900, f1: 2800, q: 1.5, peak: 0.12, attack: 0.08, decay: 0.3 });
    thud(ctx, o, t + 0.4, 0.14, 95);
    noise(ctx, o, t + 0.42, { filter: "bandpass", f0: 1600, f1: 900, q: 0.8, peak: 0.06, attack: 0.03, decay: 0.5 });
  },

  // Something hit the rover hard: a crunch of plating, then the damage alarm.
  roverHit: (ctx, mix, t) => {
    const o = route(ctx, mix, { verb: 0.3 });
    thud(ctx, o, t, 0.3, 75);
    metal(ctx, o, t, 260, 0.1, 0.5);
    noise(ctx, o, t, { f0: 3000, f1: 400, peak: 0.2, decay: 0.35 });
    for (let i = 0; i < 3; i++) {
      tone(ctx, o, t + 0.5 + i * 0.32, { type: "square", f0: 880, peak: 0.04, decay: 0.12, lp: 2500 });
      tone(ctx, o, t + 0.66 + i * 0.32, { type: "square", f0: 660, peak: 0.04, decay: 0.12, lp: 2500 });
    }
  },

  // A storm over the drill site: wind swelling, rain hissing, thunder rolling.
  storm: (ctx, mix, t) => {
    const o = route(ctx, mix, { verb: 0.45 });
    const gust = turbulence(ctx, t, t + 3.5, 0.4);
    gust.connect(o);
    noise(ctx, gust, t, { filter: "bandpass", f0: 400, f1: 900, q: 1.2, peak: 0.18, attack: 0.9, decay: 2.4, sweep: 1.5 });
    noise(ctx, o, t + 0.3, { filter: "highpass", f0: 5000, peak: 0.05, attack: 0.6, decay: 2.2 });
    noise(ctx, o, t + 0.8, { f0: 700, f1: 90, peak: 0.25, attack: 0.05, decay: 2.2 });
    tone(ctx, o, t + 0.8, { f0: 55, f1: 32, peak: 0.18, attack: 0.1, decay: 2.0 });
  },

  // A quake: the ground grinds and shakes, loose things rattle, the rig groans.
  quake: (ctx, mix, t) => {
    const o = route(ctx, mix, { verb: 0.35 });
    const shake = turbulence(ctx, t, t + 3.2, 0.5);
    shake.connect(o);
    noise(ctx, shake, t, { f0: 220, f1: 110, peak: 0.9, attack: 0.4, decay: 2.4 });
    tone(ctx, shake, t, { type: "sawtooth", f0: 32, f1: 26, peak: 0.22, attack: 0.4, decay: 2.4, lp: 140 });
    for (let i = 0; i < 14; i++) noise(ctx, o, t + rand(0.3, 2.3), { filter: "bandpass", f0: rand(800, 2400), q: 3, peak: rand(0.03, 0.08), decay: rand(0.02, 0.06) });
    tone(ctx, o, t + 1.2, { type: "sawtooth", f0: 140, f1: 110, peak: 0.03, attack: 0.3, decay: 0.8, lp: 900 });
  },

  // A breakdown: the drill head grinds, jams with a clunk, and the warning sounds.
  breakdown: (ctx, mix, t) => {
    const o = route(ctx, mix, { verb: 0.3 });
    const grind = ctx.createOscillator();
    grind.type = "sawtooth";
    grind.frequency.setValueAtTime(320, t);
    grind.frequency.exponentialRampToValueAtTime(90, t + 0.7);
    const jit = lfo(ctx, 31, 40, grind.frequency);
    const gl = ctx.createBiquadFilter();
    gl.type = "bandpass";
    gl.frequency.value = 900;
    gl.Q.value = 1.2;
    const gg = env(ctx, t, 0.1, 0.05, 0.7);
    grind.connect(gl).connect(gg).connect(o);
    grind.start(t);
    jit.start(t);
    grind.stop(t + 0.8);
    jit.stop(t + 0.8);
    strike(ctx, o, t + 0.75, 0.16);
    [0, 0.2].forEach((dt) => tone(ctx, o, t + 1.1 + dt, { type: "square", f0: 520, peak: 0.04, decay: 0.12, lp: 2000 }));
  },

  // Voice call-outs: recorded files, played by the engine (these only make the tone before the words).
  mineral: (ctx, mix, t) => {
    const o = route(ctx, mix, { verb: 0.2 });
    tone(ctx, o, t, { type: "square", f0: 1046.5, peak: 0.025, decay: 0.05, lp: 2200 });
    tone(ctx, o, t + 0.06, { type: "square", f0: 784, peak: 0.025, decay: 0.07, lp: 2200 });
  },
  lifeform: (ctx, mix, t) => {
    const o = route(ctx, mix, { verb: 0.2 });
    tone(ctx, o, t, { type: "square", f0: 784, peak: 0.025, decay: 0.05, lp: 2200 });
    tone(ctx, o, t + 0.06, { type: "square", f0: 1046.5, peak: 0.025, decay: 0.07, lp: 2200 });
  },
};

// --- loops --------------------------------------------------------------------------------

/** Fade a loop's gain up now and give back a stop that fades it out and ends its sources. */
export function loopShell(ctx: AudioContext, g: GainNode, level: number, sources: AudioScheduledSourceNode[], onStop?: () => void): LoopHandle {
  const t = ctx.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(level, t + 0.4);
  for (const s of sources) s.start(t);
  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      onStop?.();
      const s = ctx.currentTime;
      g.gain.cancelScheduledValues(s);
      g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), s);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.6);
      for (const n of sources) n.stop(s + 0.7);
    },
  };
}

export function loopNoise(ctx: AudioContext): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  return src;
}

export const LOOPS: Record<LoopId, (ctx: AudioContext, mix: Mix) => LoopHandle> = {
  // An in-system burn: a low, breathing rumble for as long as the ship is under way.
  burn: (ctx, mix) => {
    const g = ctx.createGain();
    g.connect(route(ctx, mix, { verb: 0.3 }));
    const src = loopNoise(ctx);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 220;
    const l = lfo(ctx, 0.4, 60, lp.frequency);
    const hum = ctx.createOscillator();
    hum.frequency.value = 48;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.25;
    src.connect(lp).connect(g);
    hum.connect(humGain).connect(g);
    return loopShell(ctx, g, 0.22, [src, l, hum]);
  },

  // The rover driving over rough ground: a low electric drive hum, tires rumbling and bumping, and gravel
  // crunching under them (grains scheduled at random), with the odd creak from the suspension.
  rover: (ctx, mix) => {
    const g = ctx.createGain();
    g.connect(route(ctx, mix, { verb: 0.15 }));
    // Drive train: a smooth low hum and a faint electric whine, not a buzzing engine.
    const hum = ctx.createOscillator();
    hum.type = "triangle";
    hum.frequency.value = 46;
    const hg = ctx.createGain();
    hg.gain.value = 0.18;
    hum.connect(hg).connect(g);
    const whine = ctx.createOscillator();
    whine.frequency.value = 410;
    const wv = lfo(ctx, 0.3, 25, whine.frequency);
    const wg = ctx.createGain();
    wg.gain.value = 0.015;
    whine.connect(wg).connect(g);
    // Tire rumble: dark noise whose level wanders as the ground changes.
    const rumble = loopNoise(ctx);
    const rl = ctx.createBiquadFilter();
    rl.type = "lowpass";
    rl.frequency.value = 180;
    const rg = ctx.createGain();
    rg.gain.value = 0.55;
    const ground = lfo(ctx, 0.9, 0.25, rg.gain);
    const ground2 = lfo(ctx, 2.3, 0.15, rg.gain);
    rumble.connect(rl).connect(rg).connect(g);
    // Gravel, bumps and creaks, scheduled a little ahead.
    let next = ctx.currentTime + 0.1;
    let bump = ctx.currentTime + rand(0.3, 0.8);
    const tick = () => {
      const until = ctx.currentTime + 0.25;
      while (next < until) {
        noise(ctx, g, next, { filter: "bandpass", f0: rand(900, 2600), q: rand(1.5, 3), peak: rand(0.04, 0.12), attack: 0.003, decay: rand(0.015, 0.05) });
        next += rand(0.015, 0.06);
      }
      while (bump < until) {
        thud(ctx, g, bump, rand(0.08, 0.18), rand(60, 95));
        if (Math.random() < 0.3) tone(ctx, g, bump + 0.05, { type: "sawtooth", f0: rand(300, 500), f1: rand(250, 400), peak: 0.012, attack: 0.04, decay: 0.15, lp: 1200 });
        bump += rand(0.35, 1.1);
      }
    };
    tick();
    const timer = setInterval(tick, 80);
    return loopShell(ctx, g, 0.75, [hum, whine, wv, rumble, ground, ground2], () => clearInterval(timer));
  },

  // The boat under way: an outboard motor and water slapping the hull.
  boat: (ctx, mix) => {
    const g = ctx.createGain();
    g.connect(route(ctx, mix, { verb: 0.2 }));
    const m = ctx.createOscillator();
    m.type = "sawtooth";
    m.frequency.value = 74;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 600;
    const putt = ctx.createGain();
    putt.gain.value = 0.35;
    const p = lfo(ctx, 11, 0.25, putt.gain);
    m.connect(lp).connect(putt).connect(g);
    const water = loopNoise(ctx);
    const wl = ctx.createBiquadFilter();
    wl.type = "lowpass";
    wl.frequency.value = 900;
    const lap = lfo(ctx, 0.55, 500, wl.frequency);
    const wg = ctx.createGain();
    wg.gain.value = 0.45;
    const swell = lfo(ctx, 0.37, 0.2, wg.gain);
    water.connect(wl).connect(wg).connect(g);
    return loopShell(ctx, g, 0.28, [m, p, water, lap, swell]);
  },

  // The drill at work: steady hammer strikes for as long as the job's timer runs (no motor: AW-284).
  drill: (ctx, mix) => {
    const g = ctx.createGain();
    const out = route(ctx, mix, { verb: 0.3 });
    g.connect(out);
    // Schedule strikes a little ahead, every 0.9 s.
    const PERIOD = 0.9;
    let next = ctx.currentTime + 0.15;
    const tick = () => {
      while (next < ctx.currentTime + 0.3) {
        strike(ctx, out, next, 0.14);
        next += PERIOD;
      }
    };
    tick();
    const timer = setInterval(tick, 100);
    return loopShell(ctx, g, 0.4, [], () => clearInterval(timer));
  },
};
