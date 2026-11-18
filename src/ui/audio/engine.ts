/**
 * The game's audio (AW-31, docs/audio.md). One AudioContext with a bus per kind of sound (interface,
 * effects, ambience, music) under a master gain, each with its own volume, all set in Options and
 * remembered in this browser. Sounds are synthesized (src/ui/audio/synth.ts): no files to load.
 *
 * Browsers only start audio after the player has clicked something, so the context is created on the
 * first gesture (unlockAudio). Until then, and when muted, play() does nothing.
 */
import { RECIPES, LOOPS, type SoundId, type LoopId } from "./synth";

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
};

export interface LoopHandle {
  stop(): void;
}

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses = new Map<Bus, GainNode>();
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
      for (const b of ["ui", "sfx", "ambience", "music"] as const) {
        const g = this.ctx.createGain();
        g.connect(this.master);
        this.buses.set(b, g);
      }
      this.apply();
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
  }

  private ready(): AudioContext | null {
    if (!this.ctx || this.settings.muted || this.settings.master <= 0) return null;
    return this.ctx;
  }

  /** Play a one-shot sound. */
  play(id: SoundId): void {
    const ctx = this.ready();
    const bus = this.buses.get(BUS_OF[id]);
    if (!ctx || !bus || this.settings[BUS_OF[id]] <= 0) return;
    try {
      RECIPES[id](ctx, bus, ctx.currentTime + 0.005);
      if (id !== "click") {
        this.lastPlayed = performance.now();
        this.lastId = id;
      }
    } catch {
      /* a sound failing never breaks the game */
    }
  }

  /** Start a loop (an engine burn, a drill); stop() fades it out. */
  loop(id: LoopId, bus: Bus = "sfx"): LoopHandle {
    const ctx = this.ready();
    const out = this.buses.get(bus);
    if (!ctx || !out) return { stop() {} };
    try {
      return LOOPS[id](ctx, out);
    } catch {
      return { stop() {} };
    }
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
