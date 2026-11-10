/**
 * The new-career intro (AW-234): seven pixel-art panels that pan and zoom, with captions and a
 * voiceover. Script and motion live in src/data/intro.json; the art is MOSS-Image output
 * (tools/art/moss.py intro-1 ...) and the voice is Kokoro (tools/audio/narrate.py).
 * Skip with the button or Esc; click, Space, Enter or → moves to the next panel.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import script from "../data/intro.json";
import "./intro.css";

interface Motion {
  scale: number;
  x: number;
  y: number;
}
interface Scene {
  image: string;
  text: string;
  from: Motion;
  to: Motion;
  flash?: boolean;
}

const SCENES = script.scenes as Scene[];
/** Seconds of picture before the narrator starts, and after they finish. */
const LEAD_S = 0.7;
const TAIL_S = 1.6;
/** Seconds the closing title holds. */
const TITLE_S = 3.2;
const MUTE_KEY = "after-waking/intro-muted";

function readMuted(): boolean {
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

export function Intro({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const [muted, setMuted] = useState(readMuted);
  const [leaving, setLeaving] = useState(false);
  const [durations, setDurations] = useState<number[]>(() => SCENES.map((s) => estimate(s.text) + LEAD_S + TAIL_S));
  const audio = useRef<HTMLAudioElement[]>([]);
  const finished = index >= SCENES.length;

  // Load every clip up front; once a clip's length is known, its panel lasts as long as the line.
  useEffect(() => {
    audio.current = SCENES.map((_, i) => {
      const a = new Audio(`./assets/intro/vo-${i + 1}.ogg`);
      a.preload = "auto";
      a.addEventListener("loadedmetadata", () => {
        if (Number.isFinite(a.duration)) setDurations((d) => d.map((v, j) => (j === i ? a.duration + LEAD_S + TAIL_S : v)));
      });
      return a;
    });
    for (const s of SCENES) new Image().src = `./assets/intro/${s.image}.png`;
    return () => audio.current.forEach((a) => a.pause());
  }, []);

  const leave = () => {
    if (leaving) return;
    setLeaving(true);
    audio.current.forEach((a) => a.pause());
    window.setTimeout(onDone, 700);
  };

  // Play the current panel's line and move on when the panel's time is up.
  useEffect(() => {
    if (leaving) return;
    if (finished) {
      const t = window.setTimeout(leave, TITLE_S * 1000);
      return () => window.clearTimeout(t);
    }
    const clip = audio.current[index];
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
        setIndex((i) => Math.min(SCENES.length, i + 1));
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
    const clip = audio.current[index];
    if (m) clip?.pause();
    else if (clip && !finished) clip.play().catch(() => {});
  };

  return (
    <div class={`intro ${leaving ? "leaving" : ""} ${finished ? "finished" : ""}`} onClick={() => setIndex((i) => Math.min(SCENES.length, i + 1))}>
      {SCENES.map((s, i) => {
        const state = i === index ? "on" : i < index ? "past" : "";
        const dur = durations[i] ?? 8;
        return (
          <div
            key={s.image}
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
            <img src={`./assets/intro/${s.image}.png`} alt="" />
            {s.flash && state === "on" && <div class="intro-flash" style={{ "--dur": `${dur}s` }} />}
          </div>
        );
      })}
      <div class="intro-bars" />
      {!finished && (
        <p class="intro-caption" key={index}>
          {SCENES[index]?.text}
        </p>
      )}
      {finished && <h1 class="intro-title">AFTER WAKING</h1>}
      <div class="intro-controls" onClick={(e) => e.stopPropagation()}>
        <span class="intro-dots" aria-hidden="true">
          {SCENES.map((_, i) => (
            <span key={i} class={i === index ? "on" : i < index ? "past" : ""} />
          ))}
        </span>
        <button class="btn small" onClick={toggleMute} title={muted ? "Turn the narration on" : "Mute the narration"}>
          {muted ? "Sound off" : "Sound on"}
        </button>
        <button class="btn" onClick={leave} title="Skip the intro (Esc)">
          Skip ▸▸
        </button>
      </div>
    </div>
  );
}
