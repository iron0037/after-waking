/**
 * The game's audio (AW-31, docs/audio.md). One AudioContext with a bus per kind of sound (interface,
 * effects, ambience, music) under a master gain, each with its own volume, all set in Options and
 * remembered in this browser. Sounds are synthesized (src/ui/audio/synth.ts), each bus with a send to a
 * shared reverb; only the voice call-outs are files (SAMPLES).
 *
 * Browsers only start audio after the player has clicked something, so the context is created on the
 * first gesture (unlockAudio). Until then, and when muted, play() does nothing.
 */
import { AMBIENCE, type AmbienceId } from "./ambience";
import { RECIPES, LOOPS, reverbImpulse, type Mix, type SoundId, type LoopId } from "./synth";

export type Bus = "ui" | "sfx" | "ambience" | "music";

export interface AudioSettings {
  master: number;
  ui: number;
  sfx: number;
  ambience: number;
  music: number;
  muted: boolean;
}

export const DEFAULT_AUDIO: AudioSettings = { master: 0.8, ui: 0.6, sfx: 0.8, ambience: 0.6, music: 0.6, muted: false };

const KEY = "after-waking/audio";

function load(): AudioSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_AUDIO, ...(JSON.parse(raw) as Partial<AudioSettings>) };
  } catch {
    /* storage unavailable: defaults */
  }
  return { ...DEFAULT_AUDIO };
}

/** Which bus each sound plays on. */
const BUS_OF: Record<SoundId, Bus> = {
  click: "ui",
  blocked: "ui",
  notify: "ui",
  credits: "ui",
  purchase: "ui",
  levelup: "sfx",
  discovery: "sfx",
  fold: "sfx",
  land: "sfx",
  liftoff: "sfx",
  dock: "sfx",
  undock: "sfx",
  orbit: "sfx",
  refuel: "sfx",
  scan: "sfx",
  survey: "sfx",
  probe: "sfx",
  danger: "sfx",
  bayOpen: "sfx",
  bayClose: "sfx",
  splash: "sfx",
  hop: "sfx",
  recharge: "sfx",
  drill: "sfx",
  mineral: "sfx",
  lifeform: "sfx",
  prospect: "sfx",
  sample: "sfx",
  stun: "sfx",
  net: "sfx",
  roverHit: "sfx",
  storm: "sfx",
  quake: "sfx",
  breakdown: "sfx",
  thrusters: "sfx",
  laser: "sfx",
  kinetic: "sfx",
  enemyFire: "sfx",
  hitThem: "sfx",
  hullHit: "sfx",
  shieldHit: "sfx",
  nearMiss: "sfx",
  alarm: "sfx",
  victory: "sfx",
  defeat: "sfx",
  escape: "sfx",
  talked: "sfx",
};

/** Recorded call-outs (AW-281, tools/audio/callouts.py), played after their recipe's tone. */
const SAMPLES: Partial<Record<SoundId, string>> = {
  mineral: "./assets/sfx/mineral-detected.ogg",
  lifeform: "./assets/sfx/lifeform-detected.ogg",
};
/** When the words start after the tone. */
const SAMPLE_DELAY = 0.16;

/** The soundtrack sits under everything else: the masters are mixed loud, so this is its level on the music bus. */
const MUSIC_LEVEL = 0.45;

export interface LoopHandle {
  stop(): void;
}

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses = new Map<Bus, GainNode>();
  /** Each bus's send to the reverb, at the bus's volume. */
  private sends = new Map<Bus, GainNode>();
  private samples = new Map<string, Promise<AudioBuffer | null>>();
  private settings: AudioSettings = load();
  private listeners = new Set<() => void>();
  /** The last sound other than a click, and when it started (performance.now): a notice right after an action's own sound stays quiet. */
  lastPlayed = 0;
  lastId: SoundId | null = null;

  /** Create (or resume) the context. Call from a user gesture. */
  unlock(): void {
    if (typeof AudioContext === "undefined") return;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return;
      }
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      const verb = this.ctx.createConvolver();
      verb.buffer = reverbImpulse(this.ctx);
      verb.connect(this.master);
      for (const b of ["ui", "sfx", "ambience", "music"] as const) {
        const g = this.ctx.createGain();
        g.connect(this.master);
        this.buses.set(b, g);
        const send = this.ctx.createGain();
        send.connect(verb);
        this.sends.set(b, send);
      }
      this.apply();
      for (const url of Object.values(SAMPLES)) void this.sample(url);
      // A cue asked for before the first click starts now.
      if (this.musicWanted) {
        const url = this.musicWanted;
        this.musicWanted = null;
        this.music(url);
      }
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  get(): AudioSettings {
    return this.settings;
  }

  set(patch: Partial<AudioSettings>): void {
    this.settings = { ...this.settings, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.settings));
    } catch {
      /* not remembered; still applies now */
    }
    this.apply();
    for (const l of this.listeners) l();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The level a bus plays at, master and mute included (for audio outside the engine, like the intro). */
  level(bus: Bus | "voice"): number {
    if (this.settings.muted) return 0;
    return this.settings.master * (bus === "voice" ? 1 : this.settings[bus]);
  }

  private apply(): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.muted ? 0 : this.settings.master, t, 0.02);
    for (const [b, g] of this.buses) g.gain.setTargetAtTime(this.settings[b], t, 0.02);
    for (const [b, g] of this.sends) g.gain.setTargetAtTime(this.settings[b], t, 0.02);
  }

  private ready(): AudioContext | null {
    if (!this.ctx || this.settings.muted || this.settings.master <= 0) return null;
    return this.ctx;
  }

  private mix(bus: Bus): Mix | null {
    const dry = this.buses.get(bus);
    const wet = this.sends.get(bus);
    return dry && wet ? { dry, wet } : null;
  }

  /** Fetch and decode a recorded sound, once. */
  private sample(url: string): Promise<AudioBuffer | null> {
    let p = this.samples.get(url);
    if (!p) {
      const ctx = this.ctx;
      p = ctx
        ? fetch(url)
            .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
            .then((b) => ctx.decodeAudioData(b))
            .catch(() => null)
        : Promise.resolve(null);
      this.samples.set(url, p);
    }
    return p;
  }

  /** Play a one-shot sound, `delay` seconds from now. */
  play(id: SoundId, delay = 0): void {
    const ctx = this.ready();
    const mix = this.mix(BUS_OF[id]);
    if (!ctx || !mix || this.settings[BUS_OF[id]] <= 0) return;
    try {
      const t = ctx.currentTime + 0.005 + delay;
      RECIPES[id](ctx, mix, t);
      const url = SAMPLES[id];
      if (url) {
        void this.sample(url).then((buf) => {
          if (!buf || !this.ready()) return;
          const src = ctx.createBufferSource();
          src.buffer = buf;
          const g = ctx.createGain();
          g.gain.value = 0.32;
          const send = ctx.createGain();
          send.gain.value = 0.12;
          src.connect(g).connect(mix.dry);
          g.connect(send).connect(mix.wet);
          src.start(Math.max(ctx.currentTime, t + SAMPLE_DELAY));
        });
      }
      if (id !== "click") {
        this.lastPlayed = performance.now() + delay * 1000;
        this.lastId = id;
      }
    } catch {
      /* a sound failing never breaks the game */
    }
  }

  /** Start a loop (an engine burn, a rover motor, a drill); stop() fades it out. */
  loop(id: LoopId, bus: Bus = "sfx"): LoopHandle {
    const ctx = this.ready();
    const mix = this.mix(bus);
    if (!ctx || !mix || this.settings[bus] <= 0) return { stop() {} };
    try {
      return LOOPS[id](ctx, mix);
    } catch {
      return { stop() {} };
    }
  }

  /** Start a background bed (a world's weather, the Intrepid's hum) on the ambience bus; stop() fades it out. */
  ambience(id: AmbienceId): LoopHandle {
    const ctx = this.ctx;
    const mix = this.mix("ambience");
    if (!ctx || !mix) return { stop() {} };
    try {
      return AMBIENCE[id](ctx, mix);
    } catch {
      return { stop() {} };
    }
  }

  /** Play a recorded sound (a creature's call) on a bus, at `gain` (0-1) and `pan` (-1 left to 1 right). */
  playFile(url: string, bus: Bus = "ambience", gain = 1, pan = 0): void {
    const ctx = this.ready();
    const mix = this.mix(bus);
    if (!ctx || !mix || this.settings[bus] <= 0) return;
    void this.sample(url).then((buf) => {
      if (!buf || !this.ready()) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = gain;
      let head: AudioNode = g;
      if (typeof ctx.createStereoPanner === "function") {
        const p = ctx.createStereoPanner();
        p.pan.value = pan;
        g.connect(p);
        head = p;
      }
      head.connect(mix.dry);
      const send = ctx.createGain();
      send.gain.value = 0.35;
      head.connect(send).connect(mix.wet);
      src.connect(g);
      src.start();
    });
  }

  /** The soundtrack cue that should be playing (null: silence), and what is (AW-274). */
  private musicWanted: string | null = null;
  private musicNow: { url: string; src: AudioBufferSourceNode; gain: GainNode } | null = null;

  /**
   * Play a looping soundtrack cue on the music bus, crossfading from whatever was playing; null fades it out.
   * Asking before audio is unlocked is fine: the cue starts with the first click. Like ambience, it runs while
   * muted, so the bus handles the level.
   */
  music(url: string | null, fade = 2.5): void {
    this.musicWanted = url;
    const ctx = this.ctx;
    const bus = this.buses.get("music");
    if (!ctx || !bus || this.musicNow?.url === url) return;
    if (this.musicNow) {
      const old = this.musicNow;
      this.musicNow = null;
      const t = ctx.currentTime;
      old.gain.gain.cancelScheduledValues(t);
      old.gain.gain.setValueAtTime(old.gain.gain.value, t);
      old.gain.gain.linearRampToValueAtTime(0, t + fade);
      old.src.stop(t + fade + 0.1);
    }
    if (!url) return;
    void this.sample(url).then((buf) => {
      // Gone, or another cue asked for while this one loaded.
      if (!buf || this.musicWanted !== url || this.musicNow) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const gain = ctx.createGain();
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(MUSIC_LEVEL, t + fade);
      src.connect(gain).connect(bus);
      src.start(t);
      this.musicNow = { url, src, gain };
    });
  }

  /** Run a loop for `ms` milliseconds (a drilling job's time-lapse). */
  loopFor(id: LoopId, ms: number, bus: Bus = "sfx"): void {
    const h = this.loop(id, bus);
    setTimeout(() => h.stop(), ms);
  }
}

export const audio = new AudioEngine();

/** Unlock audio on the first click or key anywhere, and click softly on buttons. Returns a cleanup. */
export function installAudioGestures(): () => void {
  const onDown = (ev: PointerEvent) => {
    audio.unlock();
    const target = ev.target instanceof Element ? ev.target.closest("button") : null;
    if (!target || (target as HTMLButtonElement).disabled) return;
    // A dimmed rail button says no; everything else clicks.
    audio.play(target.getAttribute("aria-disabled") === "true" ? "blocked" : "click");
  };
  const onKey = () => audio.unlock();
  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("keydown", onKey, true);
  return () => {
    window.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("keydown", onKey, true);
  };
}

/** A notice's sound: a no for an error (unless the rail just said so), a soft chime otherwise (unless the action already made one). */
export function noticeSound(kind: "info" | "error" | "covenant"): void {
  const since = performance.now() - audio.lastPlayed;
  if (kind === "error") {
    if (!(audio.lastId === "blocked" && since < 250)) audio.play("blocked");
  } else if (since > 400) audio.play("notify");
}
