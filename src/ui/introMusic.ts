/**
 * Ambient music for the intro (AW-235), synthesised live with Web Audio: no files, no licences.
 * A slow detuned pad holds one chord per scene and glides to the next, a low drone sits under it,
 * faint chimes drift in from the chord's notes, and a filtered-noise swell rises into the anomaly's
 * flash. Everything runs through a long synthetic reverb and stays quiet under the narrator.
 */

/** One chord per scene (MIDI notes, low to high), then the closing title's. */
export const INTRO_CHORDS: readonly (readonly number[])[] = [
  [45, 52, 59, 60], // Am(add9): the machines' world
  [41, 48, 52, 57], // Fmaj7: departure
  [45, 52, 57, 60], // Am: the long sleep
  [46, 53, 57, 64], // Bbmaj7(#11): the anomaly
  [48, 55, 59, 62], // Cmaj9: unknown stars
  [38, 45, 53, 64], // Dm9: a city that can't move
  [41, 48, 55, 57], // Fadd9: your freighter
];
const TITLE_CHORD = [36, 43, 50, 52]; // Cadd9: After Waking

const LEVEL = 0.26;
const GLIDE_S = 2.5;

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

function impulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
  }
  return buf;
}

export class IntroMusic {
  private master: GainNode;
  private pad: GainNode;
  private voices: OscillatorNode[][] = [];
  private drone: OscillatorNode;
  private filter: BiquadFilterNode;
  private wet: ConvolverNode;
  private chord: readonly number[] = INTRO_CHORDS[0]!;
  private chimeTimer: number | undefined;
  private stopped = false;

  constructor(private ctx: BaseAudioContext) {
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    this.wet = ctx.createConvolver();
    this.wet.buffer = impulse(ctx, 5, 2.5);
    const wetGain = ctx.createGain();
    wetGain.gain.value = 0.9;
    this.wet.connect(wetGain).connect(this.master);

    // The pad: four voices of two detuned saws, through a slowly breathing low-pass.
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 520;
    this.filter.Q.value = 0.6;
    const lfo = ctx.createOscillator();
    const lfoDepth = ctx.createGain();
    lfo.frequency.value = 0.06;
    lfoDepth.gain.value = 220;
    lfo.connect(lfoDepth).connect(this.filter.frequency);
    lfo.start();
    this.pad = ctx.createGain();
    this.pad.gain.value = 0.55;
    this.filter.connect(this.pad);
    this.pad.connect(this.master);
    this.pad.connect(this.wet);
    for (const note of this.chord) {
      const pair = [-7, 7].map((cents) => {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = hz(note);
        o.detune.value = cents;
        const g = ctx.createGain();
        g.gain.value = 0.05;
        o.connect(g).connect(this.filter);
        o.start();
        return o;
      });
      this.voices.push(pair);
    }

    // A soft sine drone an octave under the root.
    this.drone = ctx.createOscillator();
    this.drone.type = "sine";
    this.drone.frequency.value = hz(this.chord[0]! - 12);
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.22;
    this.drone.connect(droneGain).connect(this.master);
    this.drone.start();
  }

  /** Fade in and start the chimes. */
  start(): void {
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(0, t);
    this.master.gain.linearRampToValueAtTime(LEVEL, t + 4);
    this.scheduleChime(2.5);
  }

  /** Glide to scene `i`'s chord; on the anomaly, a swell that peaks at `flashAt` seconds from now. */
  scene(i: number, flashAt?: number): void {
    this.glide(INTRO_CHORDS[i] ?? this.chord);
    if (flashAt !== undefined) this.swell(flashAt);
  }

  /** The closing title: the last chord, then a long fade. */
  finale(holdS: number): void {
    this.glide(TITLE_CHORD);
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(LEVEL * 1.2, t + 1);
    this.master.gain.linearRampToValueAtTime(0, t + holdS + 1.5);
  }

  /** Fade out over `seconds`, then stop everything. */
  stop(seconds: number): void {
    if (this.stopped) return;
    this.stopped = true;
    window.clearTimeout(this.chimeTimer);
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(0, t + seconds);
    window.setTimeout(() => {
      if (this.ctx instanceof AudioContext) void this.ctx.close();
    }, seconds * 1000 + 100);
  }

  setMuted(muted: boolean): void {
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(muted ? 0 : LEVEL, t, 0.3);
  }

  private glide(chord: readonly number[]): void {
    this.chord = chord;
    const t = this.ctx.currentTime;
    this.voices.forEach((pair, v) => {
      for (const o of pair) o.frequency.setTargetAtTime(hz(chord[v] ?? chord[0]!), t, GLIDE_S / 3);
    });
    this.drone.frequency.setTargetAtTime(hz(chord[0]! - 12), t, GLIDE_S / 3);
  }

  /** A faint bell from the chord, two octaves up, every few seconds. */
  private scheduleChime(afterS: number): void {
    this.chimeTimer = window.setTimeout(() => {
      if (this.stopped) return;
      const note = this.chord[Math.floor(Math.random() * this.chord.length)]! + 24;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = hz(note);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 3.5);
      o.connect(g);
      g.connect(this.wet);
      g.connect(this.master);
      o.start(t);
      o.stop(t + 3.6);
      this.scheduleChime(2.5 + Math.random() * 3.5);
    }, afterS * 1000);
  }

  /** Filtered noise rising into the flash, then falling away. */
  private swell(peakAtS: number): void {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const noise = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noise.buffer = buf;
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 1.2;
    band.frequency.setValueAtTime(180, t);
    band.frequency.exponentialRampToValueAtTime(2800, t + peakAtS);
    band.frequency.exponentialRampToValueAtTime(400, t + peakAtS + 3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1.6, t + peakAtS);
    g.gain.exponentialRampToValueAtTime(0.0001, t + peakAtS + 3);
    noise.connect(band).connect(g);
    g.connect(this.master);
    g.connect(this.wet);
    noise.start(t);
    noise.stop(t + peakAtS + 3.2);
  }
}
