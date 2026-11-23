/** Volume sliders and a mute (AW-31): on the title screen's Options and behind the top bar's Sound button. */
import { useEffect, useRef, useState } from "preact/hooks";
import { audio, type AudioSettings } from "./audio/engine";
import "./sound.css";

function useAudioSettings(): AudioSettings {
  const [s, setS] = useState(audio.get());
  useEffect(() => audio.subscribe(() => setS(audio.get())), []);
  return s;
}

const SLIDERS: { key: Exclude<keyof AudioSettings, "muted">; label: string; hint: string }[] = [
  { key: "master", label: "Master", hint: "Everything" },
  { key: "ui", label: "Interface", hint: "Clicks, notices, money" },
  { key: "sfx", label: "Effects", hint: "Folds, landings, docking, finds" },
  { key: "ambience", label: "Ambience", hint: "Each world's weather, the Intrepid's hum" },
  { key: "music", label: "Music", hint: "The soundtrack, and the cinematics' scores" },
];

export function SoundSettings() {
  const s = useAudioSettings();
  return (
    <div class="sound-settings">
      <label class="sound-mute">
        <input type="checkbox" checked={s.muted} onChange={(e) => audio.set({ muted: (e.currentTarget as HTMLInputElement).checked })} /> Mute all
      </label>
      {SLIDERS.map(({ key, label, hint }) => (
        <label key={key} class="sound-row" title={hint}>
          <span>{label}</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(s[key] * 100)}
            disabled={s.muted}
            onInput={(e) => audio.set({ [key]: Number((e.currentTarget as HTMLInputElement).value) / 100 })}
            onChange={() => audio.play(key === "ui" || key === "master" ? "notify" : "discovery")}
          />
          <span class="sound-val">{Math.round(s[key] * 100)}</span>
        </label>
      ))}
    </div>
  );
}

/** The top bar's Sound button: mute at a glance, the sliders in a drop-down. */
export function SoundButton() {
  const s = useAudioSettings();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // The top bar scrolls sideways on narrow windows, which clips anything hanging below it (AW-292): the menu
  // is placed against the window instead, under the button.
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const toggle = () => {
    const r = box.current?.getBoundingClientRect();
    if (r) setAt({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
    setOpen(!open);
  };
  useEffect(() => {
    if (!open) return;
    const away = (ev: MouseEvent) => {
      if (!box.current?.contains(ev.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, [open]);
  return (
    <div class="sound-button" ref={box}>
      <button class="btn" onClick={toggle} title="Sound: volumes and mute" aria-expanded={open}>
        {s.muted ? "Sound off" : "Sound"}
      </button>
      {open && (
        <div class="sound-pop panel" style={at ? { top: `${at.top}px`, right: `${at.right}px` } : undefined}>
          <SoundSettings />
        </div>
      )}
    </div>
  );
}
