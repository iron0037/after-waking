/**
 * Phase-1 sounds, synthesized with Web Audio (AW-31, docs/audio.md): retro and soft, like the intro's
 * music. Each recipe builds a short-lived graph into `out` starting at `t`; nodes stop themselves.
 * No files: tweak a number here and reload.
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
  | "orbit";

export type LoopId = "burn";

type Recipe = (ctx: AudioContext, out: AudioNode, t: number) => void;

// --- building blocks ----------------------------------------------------------------------

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Two seconds of white noise, made once per context. */
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, b);
  }
  return b;
}

/** An attack/decay envelope on a gain node: rises to `peak` in `attack` s, falls away over `decay` s. */
function env(ctx: AudioContext, t: number, peak: number, attack: number, decay: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

/** A tone from `f0` gliding to `f1`, enveloped. */
function tone(ctx: AudioContext, out: AudioNode, t: number, o: { type?: OscillatorType; f0: number; f1?: number; peak: number; attack?: number; decay: number; glide?: number }): void {
  const osc = ctx.createOscillator();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.f0, t);
  if (o.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(o.f1, t + (o.glide ?? o.decay));
  const g = env(ctx, t, o.peak, o.attack ?? 0.005, o.decay);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + (o.attack ?? 0.005) + o.decay + 0.05);
}

/** A burst of filtered noise; the filter can sweep from `f0` to `f1`. */
function noise(
  ctx: AudioContext,
  out: AudioNode,
  t: number,
  o: { filter?: BiquadFilterType; f0: number; f1?: number; q?: number; peak: number; attack?: number; decay: number },
): void {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = o.filter ?? "lowpass";
  f.Q.value = o.q ?? 0.7;
  f.frequency.setValueAtTime(o.f0, t);
  const len = (o.attack ?? 0.005) + o.decay;
  if (o.f1 !== undefined) f.frequency.exponentialRampToValueAtTime(o.f1, t + len);
  const g = env(ctx, t, o.peak, o.attack ?? 0.005, o.decay);
  src.connect(f).connect(g).connect(out);
  src.start(t);
  src.stop(t + len + 0.05);
}

/** A soft echo send for sounds that want a little space. */
function echo(ctx: AudioContext, out: AudioNode, delay = 0.18, feedback = 0.3): AudioNode {
  const d = ctx.createDelay(1);
  d.delayTime.value = delay;
  const fb = ctx.createGain();
  fb.gain.value = feedback;
  const input = ctx.createGain();
  input.connect(out);
  input.connect(d);
  d.connect(fb).connect(d);
  d.connect(out);
  return input;
}

// --- the sounds ---------------------------------------------------------------------------

export const RECIPES: Record<SoundId, Recipe> = {
  // A button: a tiny high blip.
  click: (ctx, out, t) => tone(ctx, out, t, { f0: 1900, f1: 1300, peak: 0.12, decay: 0.035 }),

  // Can't do that: a low, dull thunk.
  blocked: (ctx, out, t) => {
    tone(ctx, out, t, { type: "square", f0: 150, f1: 105, peak: 0.11, decay: 0.12 });
    tone(ctx, out, t + 0.07, { type: "square", f0: 118, f1: 90, peak: 0.09, decay: 0.12 });
  },

  // A notice: two soft notes up.
  notify: (ctx, out, t) => {
    tone(ctx, out, t, { type: "triangle", f0: 880, peak: 0.12, decay: 0.18 });
    tone(ctx, out, t + 0.08, { type: "triangle", f0: 1320, peak: 0.1, decay: 0.25 });
  },

  // Credits in: three bright bell notes, quick and rising.
  credits: (ctx, out, t) => {
    const e = echo(ctx, out, 0.12, 0.2);
    [1046.5, 1318.5, 1568].forEach((f, i) => {
      tone(ctx, e, t + i * 0.06, { f0: f, peak: 0.14, decay: 0.35 });
      tone(ctx, e, t + i * 0.06, { f0: f * 2.01, peak: 0.03, decay: 0.2 });
    });
  },

  // Money out: a register's ka-chunk and a small ding.
  purchase: (ctx, out, t) => {
    noise(ctx, out, t, { filter: "bandpass", f0: 2400, q: 2, peak: 0.12, decay: 0.05 });
    tone(ctx, out, t + 0.02, { f0: 110, f1: 70, peak: 0.2, decay: 0.12 });
    tone(ctx, out, t + 0.1, { type: "triangle", f0: 1568, peak: 0.08, decay: 0.3 });
  },

  // A level up: an arpeggio with a shimmer on top.
  levelup: (ctx, out, t) => {
    const e = echo(ctx, out, 0.16, 0.35);
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(ctx, e, t + i * 0.09, { type: "triangle", f0: f, peak: 0.16, decay: 0.45 }));
    noise(ctx, e, t + 0.3, { filter: "highpass", f0: 6000, peak: 0.04, attack: 0.2, decay: 0.6 });
  },

  // Something found: a sonar ping with an echo.
  discovery: (ctx, out, t) => {
    const e = echo(ctx, out, 0.24, 0.4);
    tone(ctx, e, t, { f0: 1320, f1: 1250, peak: 0.16, decay: 0.7 });
  },

  // A fold: the drive spools up, then space pinches shut with a boom.
  fold: (ctx, out, t) => {
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
    // The boom.
    noise(ctx, out, t + 1.2, { f0: 900, f1: 60, peak: 0.35, decay: 1.6 });
    tone(ctx, out, t + 1.2, { f0: 90, f1: 32, peak: 0.35, decay: 1.4 });
  },

  // Landing: the descent's roar dies away, then the legs take the weight.
  land: (ctx, out, t) => {
    noise(ctx, out, t, { f0: 1400, f1: 250, peak: 0.16, attack: 0.25, decay: 1.4 });
    tone(ctx, out, t, { f0: 70, f1: 50, peak: 0.12, attack: 0.25, decay: 1.4 });
    noise(ctx, out, t + 1.55, { f0: 500, f1: 80, peak: 0.3, decay: 0.35 });
    tone(ctx, out, t + 1.55, { f0: 80, f1: 38, peak: 0.3, decay: 0.4 });
  },

  // Lift-off: a rising roar that climbs away.
  liftoff: (ctx, out, t) => {
    noise(ctx, out, t, { f0: 200, f1: 2600, peak: 0.2, attack: 0.5, decay: 1.8 });
    tone(ctx, out, t, { f0: 45, f1: 90, peak: 0.16, attack: 0.4, decay: 1.6 });
  },

  // Docking: two clunks of the clamps, then the airlock hisses.
  dock: (ctx, out, t) => {
    for (const dt of [0, 0.22]) {
      tone(ctx, out, t + dt, { f0: 120, f1: 60, peak: 0.28, decay: 0.18 });
      noise(ctx, out, t + dt, { filter: "bandpass", f0: 1800, q: 3, peak: 0.1, decay: 0.06 });
    }
    noise(ctx, out, t + 0.5, { filter: "highpass", f0: 3000, f1: 5000, peak: 0.08, attack: 0.05, decay: 0.9 });
  },

  // Undocking: the hiss first, then the clamps let go.
  undock: (ctx, out, t) => {
    noise(ctx, out, t, { filter: "highpass", f0: 5000, f1: 3000, peak: 0.08, attack: 0.05, decay: 0.7 });
    tone(ctx, out, t + 0.75, { f0: 100, f1: 140, peak: 0.22, decay: 0.2 });
    noise(ctx, out, t + 0.75, { filter: "bandpass", f0: 1600, q: 3, peak: 0.08, decay: 0.06 });
  },

  // Into orbit: the burn eases off and the ship settles.
  orbit: (ctx, out, t) => {
    noise(ctx, out, t, { f0: 600, f1: 150, peak: 0.07, attack: 0.05, decay: 0.8 });
    tone(ctx, out, t + 0.1, { type: "triangle", f0: 660, f1: 440, peak: 0.08, decay: 0.6 });
  },
};

// --- loops --------------------------------------------------------------------------------

export const LOOPS: Record<LoopId, (ctx: AudioContext, out: AudioNode) => LoopHandle> = {
  // An in-system burn: a low, breathing rumble for as long as the ship is under way.
  burn: (ctx, out) => {
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 220;
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 0.4;
    depth.gain.value = 60;
    lfo.connect(depth).connect(lp.frequency);
    const hum = ctx.createOscillator();
    hum.frequency.value = 48;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.25;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.6);
    src.connect(lp).connect(g);
    hum.connect(humGain).connect(g);
    g.connect(out);
    src.start(t);
    lfo.start(t);
    hum.start(t);
    return {
      stop() {
        const s = ctx.currentTime;
        g.gain.cancelScheduledValues(s);
        g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), s);
        g.gain.exponentialRampToValueAtTime(0.0001, s + 0.8);
        for (const n of [src, lfo, hum]) n.stop(s + 0.9);
      },
    };
  },
};
