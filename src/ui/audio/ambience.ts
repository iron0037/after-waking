/**
 * Background beds (AW-285, docs/audio.md): each world's weather while you're on its surface, and the
 * Intrepid's hum while docked. Synthesized, on the ambience bus, quiet by design: they sit under
 * everything else. Each builds a few layers (wind, surf, rumble) and schedules sparse events (gusts,
 * creaks, distant booms) a little ahead, until stopped.
 */
import type { Body } from "../../sim";
import type { LoopHandle } from "./engine";
import { bubble, lfo, loopNoise, loopShell, metal, noise, rand, route, thud, tone, type Mix } from "./synth";

export type AmbienceId =
  | "vacuum"
  | "thinWind"
  | "desert"
  | "lush"
  | "ocean"
  | "ice"
  | "hothouse"
  | "volcanic"
  | "surf"
  | "intrepid";

/** Which beds play on a world's surface. */
export function ambienceFor(body: Pick<Body, "kind" | "pressureAtm" | "sea">): AmbienceId[] {
  if (body.pressureAtm < 0.02 || body.kind === "asteroid") return ["vacuum"];
  const base: Record<Body["kind"], AmbienceId> = {
    asteroid: "vacuum",
    barren: "thinWind",
    desert: "desert",
    terrestrial: "lush",
    ocean: "ocean",
    ice: "ice",
    hothouse: "hothouse",
    volcanic: "volcanic",
    gasGiant: "vacuum",
    iceGiant: "vacuum",
  };
  const beds: AmbienceId[] = [base[body.kind]];
  // An exotic sea (methane, ammonia) laps at the shore under the world's own weather.
  if (body.sea && body.kind !== "ocean") beds.push("surf");
  return beds;
}

/** A wind layer: bandpassed noise whose pitch and strength wander. Returns its sources. */
function wind(ctx: AudioContext, out: AudioNode, o: { f: number; q: number; level: number; gust: number; rate: number }): AudioScheduledSourceNode[] {
  const src = loopNoise(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = o.f;
  bp.Q.value = o.q;
  const g = ctx.createGain();
  g.gain.value = o.level;
  const sweep = lfo(ctx, o.rate, o.f * 0.35, bp.frequency);
  const gust = lfo(ctx, o.rate * 0.7, o.level * o.gust, g.gain);
  const gust2 = lfo(ctx, o.rate * 1.9, o.level * o.gust * 0.5, g.gain);
  src.connect(bp).connect(g).connect(out);
  return [src, sweep, gust, gust2];
}

/** Surf: low noise swelling and falling like waves on a shore. */
function surf(ctx: AudioContext, out: AudioNode, level: number, period = 7): AudioScheduledSourceNode[] {
  const src = loopNoise(ctx);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 700;
  const g = ctx.createGain();
  g.gain.value = level * 0.6;
  const swell = lfo(ctx, 1 / period, level * 0.5, g.gain);
  const wash = lfo(ctx, 1 / period, 450, lp.frequency);
  src.connect(lp).connect(g).connect(out);
  return [src, swell, wash];
}

/** A deep rumble from underground. */
function rumble(ctx: AudioContext, out: AudioNode, level: number): AudioScheduledSourceNode[] {
  const src = loopNoise(ctx);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 90;
  const g = ctx.createGain();
  g.gain.value = level;
  const wander = lfo(ctx, 0.13, level * 0.4, g.gain);
  src.connect(lp).connect(g).connect(out);
  return [src, wander];
}

/** Sparse events, scheduled ahead: `fire(at)` runs about every `every` seconds (randomized). */
function events(ctx: AudioContext, every: [number, number], fire: (at: number) => void): () => void {
  let next = ctx.currentTime + rand(every[0], every[1]) * 0.5;
  const tick = () => {
    while (next < ctx.currentTime + 0.5) {
      fire(next);
      next += rand(every[0], every[1]);
    }
  };
  const timer = setInterval(tick, 200);
  return () => clearInterval(timer);
}

/** Put a bed together: a gain to fade, its layers, its events. */
function bed(ctx: AudioContext, mix: Mix, level: number, build: (g: GainNode) => { sources: AudioScheduledSourceNode[]; stops?: (() => void)[] }, verb = 0.35): LoopHandle {
  const g = ctx.createGain();
  g.connect(route(ctx, mix, { verb }));
  const { sources, stops = [] } = build(g);
  // Ambience comes up slowly rather than snapping in.
  const h = loopShell(ctx, g, level, sources, () => stops.forEach((s) => s()));
  g.gain.cancelScheduledValues(ctx.currentTime);
  g.gain.setValueAtTime(0.0001, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(level, ctx.currentTime + 2.5);
  return h;
}

export const AMBIENCE: Record<AmbienceId, (ctx: AudioContext, mix: Mix) => LoopHandle> = {
  // No air: just the suit's or rover's own faint hum, and the odd tick of metal cooling.
  vacuum: (ctx, mix) =>
    bed(ctx, mix, 0.5, (g) => {
      const hum = ctx.createOscillator();
      hum.frequency.value = 58;
      const hg = ctx.createGain();
      hg.gain.value = 0.05;
      hum.connect(hg).connect(g);
      const stop = events(ctx, [2.5, 6], (at) => metal(ctx, g, at, rand(1800, 2600), 0.012, 0.08));
      return { sources: [hum], stops: [stop] };
    }),

  // A thin atmosphere: a low, lonely wind.
  thinWind: (ctx, mix) => bed(ctx, mix, 0.6, (g) => ({ sources: wind(ctx, g, { f: 350, q: 1.2, level: 0.18, gust: 0.6, rate: 0.08 }) })),

  // Desert: gusty wind with sand hissing across the ground.
  desert: (ctx, mix) =>
    bed(ctx, mix, 0.6, (g) => ({
      sources: [
        ...wind(ctx, g, { f: 500, q: 0.9, level: 0.2, gust: 0.7, rate: 0.11 }),
        ...wind(ctx, g, { f: 5200, q: 0.7, level: 0.035, gust: 0.9, rate: 0.17 }),
      ],
    })),

  // A living world: a soft breeze, and now and then something unseen calling out.
  lush: (ctx, mix) =>
    bed(ctx, mix, 0.6, (g) => {
      const sources = wind(ctx, g, { f: 700, q: 0.8, level: 0.1, gust: 0.5, rate: 0.09 });
      const stop = events(ctx, [1.8, 5], (at) => {
        const o = route(ctx, { dry: g, wet: g }, { pan: rand(-0.8, 0.8) });
        const f = rand(1400, 3200);
        const n = Math.floor(rand(2, 5));
        for (let i = 0; i < n; i++) tone(ctx, o, at + i * rand(0.08, 0.14), { type: "sine", f0: f * rand(0.9, 1.1), f1: f * rand(1.2, 1.6), glide: 0.06, peak: 0.012, attack: 0.01, decay: 0.08 });
      });
      return { sources, stops: [stop] };
    }),

  // An ocean world: waves on the shore and a sea wind.
  ocean: (ctx, mix) =>
    bed(ctx, mix, 0.6, (g) => ({
      sources: [...surf(ctx, g, 0.2, 7), ...surf(ctx, g, 0.12, 11), ...wind(ctx, g, { f: 900, q: 0.7, level: 0.05, gust: 0.5, rate: 0.07 })],
    })),

  // Ice: a high, whistling wind, and the ice cracking far off.
  ice: (ctx, mix) =>
    bed(ctx, mix, 0.55, (g) => {
      const sources = [
        ...wind(ctx, g, { f: 1100, q: 6, level: 0.07, gust: 0.8, rate: 0.1 }),
        ...wind(ctx, g, { f: 300, q: 1, level: 0.12, gust: 0.5, rate: 0.06 }),
      ];
      const stop = events(ctx, [5, 12], (at) => {
        noise(ctx, g, at, { filter: "bandpass", f0: rand(1500, 3000), q: 2, peak: 0.04, decay: 0.05 });
        tone(ctx, g, at, { f0: rand(300, 500), f1: rand(120, 200), peak: 0.03, decay: 0.4 });
      });
      return { sources, stops: [stop] };
    }),

  // A hothouse: thick, heavy air pressing in; the ground hisses and bubbles.
  hothouse: (ctx, mix) =>
    bed(ctx, mix, 0.6, (g) => {
      const sources = [...wind(ctx, g, { f: 200, q: 0.8, level: 0.25, gust: 0.4, rate: 0.05 }), ...rumble(ctx, g, 0.2)];
      const stop = events(ctx, [0.4, 1.4], (at) => bubble(ctx, g, at, rand(150, 400), rand(0.01, 0.025)));
      return { sources, stops: [stop] };
    }),

  // Volcanic: the ground rumbles, embers crackle, and something booms far away.
  volcanic: (ctx, mix) =>
    bed(ctx, mix, 0.6, (g) => {
      const sources = [...rumble(ctx, g, 0.4), ...wind(ctx, g, { f: 450, q: 1, level: 0.08, gust: 0.6, rate: 0.08 })];
      const crackle = events(ctx, [0.08, 0.5], (at) => noise(ctx, g, at, { filter: "highpass", f0: rand(2500, 6000), peak: rand(0.006, 0.02), decay: 0.01 }));
      const boom = events(ctx, [9, 20], (at) => thud(ctx, g, at, 0.12, rand(40, 60)));
      return { sources, stops: [crackle, boom] };
    }),

  // An exotic sea lapping at the shore: slower, heavier waves than water.
  surf: (ctx, mix) => bed(ctx, mix, 0.45, (g) => ({ sources: surf(ctx, g, 0.25, 10) })),

  // Aboard the Intrepid: the old ship's air handlers and a deep hull hum, with distant clanks.
  intrepid: (ctx, mix) =>
    bed(ctx, mix, 0.35, (g) => {
      const air = loopNoise(ctx);
      const al = ctx.createBiquadFilter();
      al.type = "lowpass";
      al.frequency.value = 500;
      const ag = ctx.createGain();
      ag.gain.value = 0.12;
      air.connect(al).connect(ag).connect(g);
      const hum = ctx.createOscillator();
      hum.frequency.value = 50;
      const h2 = ctx.createOscillator();
      h2.frequency.value = 100.4;
      const hg = ctx.createGain();
      hg.gain.value = 0.06;
      hum.connect(hg).connect(g);
      h2.connect(hg);
      const stop = events(ctx, [6, 14], (at) => metal(ctx, g, at, rand(140, 260), 0.02, 0.8));
      return { sources: [air, hum, h2], stops: [stop] };
    }, 0.5),
};
