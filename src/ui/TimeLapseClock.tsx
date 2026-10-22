/**
 * Long actions (drilling runs, waits, surveys) jump the clock forward instantly in the sim.
 * This overlay plays the jump back as an analog clock whose hands sweep through the hours,
 * with the date rolling over, so the player feels the time pass.
 */
import { useEffect, useState } from "preact/hooks";
import { formatDate, formatDuration } from "../sim";
import type { TimeLapse } from "./session";

const MINUTES_PER_DAY = 24 * 60;

export function TimeLapseClock({ lapse }: { lapse: TimeLapse }) {
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    let frame = requestAnimationFrame(function tick(t) {
      setNow(t);
      if (t - lapse.startMs < lapse.durMs) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [lapse]);

  const raw = Math.min(1, Math.max(0, (now - lapse.startMs) / lapse.durMs));
  const eased = 1 - Math.pow(1 - raw, 3);
  const t = lapse.from + (lapse.to - lapse.from) * eased;
  const minuteOfDay = ((t % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hourAngle = (minuteOfDay / (12 * 60)) * 360;
  const minuteAngle = ((minuteOfDay % 60) / 60) * 360;
  const done = raw >= 1;

  return (
    <div class={`timelapse ${done ? "done" : ""}`} aria-live="polite">
      <svg viewBox="-50 -50 100 100" class="timelapse-face" aria-hidden="true">
        <circle r="46" class="tl-rim" />
        {Array.from({ length: 12 }, (_, i) => (
          <line
            key={i}
            x1="0"
            y1="-38"
            x2="0"
            y2={i % 3 === 0 ? -30 : -34}
            class="tl-tick"
            transform={`rotate(${i * 30})`}
          />
        ))}
        <line x1="0" y1="4" x2="0" y2="-22" class="tl-hour" transform={`rotate(${hourAngle})`} />
        <line x1="0" y1="6" x2="0" y2="-34" class="tl-minute" transform={`rotate(${minuteAngle})`} />
        <circle r="3" class="tl-hub" />
      </svg>
      <div class="timelapse-text">
        <div class="tl-date">{formatDate(t)}</div>
        <div class="tl-span">{formatDuration(t - lapse.from)} pass…</div>
      </div>
    </div>
  );
}
