/**
 * A narrated cinematic (AW-234 intro, AW-277 endings): pixel-art panels that pan and zoom, with
 * captions, a voiced line per panel (a narrator, or a speaker named over the caption), synthesized
 * music that follows the panels, and a closing title. Lines are Kokoro renders (tools/audio/narrate.py);
 * art is MOSS output (tools/art/moss.py). Skip with the button or Esc; click, Space, Enter or → moves on.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { audio as gameAudio, DEFAULT_AUDIO } from "./audio/engine";
import { INTRO_CHORDS, IntroMusic, TITLE_CHORD } from "./introMusic";
import "./intro.css";

interface Motion {
  scale: number;
  x: number;
  y: number;
}

export interface CinematicScene {
  /** The panel's image, under the cinematic's folder (without .png). */
  image: string;
  /** The voice file, under the cinematic's folder (without .ogg). */
  audio: string;
  text: string;
  /** Who's talking, over the caption; none for the narrator. */
  speaker?: string;
  from: Motion;
  to: Motion;
  flash?: boolean;
  /** The music's chord for this panel (MIDI notes). */
  chord?: readonly number[];
}

/** Seconds of picture before a line starts, and after it finishes. */
const LEAD_S = 0.7;
const TAIL_S = 1.6;
/** Seconds the closing title holds. */
const TITLE_S = 3.2;
const MUTE_KEY = "after-waking/intro-muted";

function readMuted(): boolean {
  // Muted in the sound settings (AW-31), or with the cinematic's own button.
  if (gameAudio.get().muted) return true;
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

/** A guess at a line's length when its audio isn't available: a measured reading pace. */
function estimate(text: string): number {
  return 1.2 + text.length * 0.065;
}

export function Cinematic({
  scenes,
  dir,
  title,
  titleChord = TITLE_CHORD,
  what = "intro",
  onDone,
}: {
  scenes: readonly CinematicScene[];
  /** Where its images and voice files live, e.g. "./assets/intro". */
  dir: string;
  /** The closing title. */
  title: string;
  titleChord?: readonly number[];
  /** What to call it on the Skip button ("intro", "ending"). */
  what?: string;
  onDone: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [muted, setMuted] = useState(readMuted);
  const [leaving, setLeaving] = useState(false);
  const [durations, setDurations] = useState<number[]>(() => scenes.map((s) => estimate(s.text) + LEAD_S + TAIL_S));
  const audio = useRef<HTMLAudioElement[]>([]);
  const music = useRef<IntroMusic | null>(null);
  const finished = index >= scenes.length;

  // Load every clip up front; once a clip's length is known, its panel lasts as long as the line.
  useEffect(() => {
    audio.current = scenes.map((s, i) => {
      const a = new Audio(`${dir}/${s.audio}.ogg`);
      a.preload = "auto";
      // The voices follow the master volume (AW-31).
      a.volume = Math.min(1, gameAudio.level("voice") / DEFAULT_AUDIO.master);
      a.addEventListener("loadedmetadata", () => {
        if (Number.isFinite(a.duration)) setDurations((d) => d.map((v, j) => (j === i ? a.duration + LEAD_S + TAIL_S : v)));
      });
      return a;
    });
    for (const s of scenes) new Image().src = `${dir}/${s.image}.png`;
    // The music (AW-235). A click just started this, so the browser lets it play.
    try {
      const chords = scenes.map((s, i) => s.chord ?? INTRO_CHORDS[i] ?? INTRO_CHORDS[0]!);
      music.current = new IntroMusic(new AudioContext(), gameAudio.level("music") / (DEFAULT_AUDIO.master * DEFAULT_AUDIO.music), chords, titleChord);
      music.current.start();
      if (readMuted()) music.current.setMuted(true);
    } catch {
      music.current = null;
    }
    return () => {
      audio.current.forEach((a) => a.pause());
      music.current?.stop(0.3);
    };
  }, []);

  const leave = () => {
    if (leaving) return;
    setLeaving(true);
    audio.current.forEach((a) => a.pause());
    music.current?.stop(0.7);
    window.setTimeout(onDone, 700);
  };

  // Play the current panel's line and move on when the panel's time is up.
  useEffect(() => {
    if (leaving) return;
    if (finished) {
      music.current?.finale(TITLE_S);
      const t = window.setTimeout(leave, TITLE_S * 1000);
      return () => window.clearTimeout(t);
    }
    const clip = audio.current[index];
    // A flash panel's swell peaks with the flash (56% of the panel; see intro.css).
    music.current?.scene(index, scenes[index]?.flash ? (durations[index] ?? 8) * 0.56 : undefined);
    const start = window.setTimeout(() => {
      if (clip && !muted) {
        clip.currentTime = 0;
        clip.play().catch(() => {});
      }
    }, LEAD_S * 1000);
    const next = window.setTimeout(() => setIndex((i) => i + 1), (durations[index] ?? 8) * 1000);
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(next);
      clip?.pause();
    };
    // durations[index] is read when the panel starts; a later metadata update shouldn't restart it.
  }, [index, leaving]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") leave();
      else if (e.key === " " || e.key === "Enter" || e.key === "ArrowRight") {
        e.preventDefault();
        setIndex((i) => Math.min(scenes.length, i + 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const toggleMute = (e: Event) => {
    e.stopPropagation();
    const m = !muted;
    setMuted(m);
    try {
      localStorage.setItem(MUTE_KEY, m ? "1" : "0");
    } catch {
      /* private window: the choice lasts this visit */
    }
    music.current?.setMuted(m);
    const clip = audio.current[index];
    if (m) clip?.pause();
    else if (clip && !finished) clip.play().catch(() => {});
  };

  const current = scenes[index];
  return (
    <div class={`intro ${leaving ? "leaving" : ""} ${finished ? "finished" : ""}`} onClick={() => setIndex((i) => Math.min(scenes.length, i + 1))}>
      {scenes.map((s, i) => {
        const state = i === index ? "on" : i < index ? "past" : "";
        const dur = durations[i] ?? 8;
        return (
          <div
            key={`${s.image}-${i}`}
            class={`intro-panel ${state}`}
            style={{
              "--dur": `${dur}s`,
              "--s0": s.from.scale,
              "--x0": `${s.from.x}%`,
              "--y0": `${s.from.y}%`,
              "--s1": s.to.scale,
              "--x1": `${s.to.x}%`,
              "--y1": `${s.to.y}%`,
            }}
          >
            <img src={`${dir}/${s.image}.png`} alt="" />
            {s.flash && state === "on" && <div class="intro-flash" style={{ "--dur": `${dur}s` }} />}
          </div>
        );
      })}
      <div class="intro-bars" />
      {!finished && current && (
        <p class={`intro-caption ${current.speaker ? "spoken" : ""}`} key={index}>
          {current.speaker && <span class="intro-speaker">{current.speaker}</span>}
          {current.speaker ? `“${current.text}”` : current.text}
        </p>
      )}
      {finished && <h1 class="intro-title">{title}</h1>}
      <div class="intro-controls" onClick={(e) => e.stopPropagation()}>
        <span class="intro-dots" aria-hidden="true">
          {scenes.map((_, i) => (
            <span key={i} class={i === index ? "on" : i < index ? "past" : ""} />
          ))}
        </span>
        <button class="btn small" onClick={toggleMute} title={muted ? "Turn the voices and music on" : "Mute the voices and music"}>
          {muted ? "Sound off" : "Sound on"}
        </button>
        <button class="btn" onClick={leave} title={`Skip the ${what} (Esc)`}>
          Skip ▸▸
        </button>
      </div>
    </div>
  );
}
