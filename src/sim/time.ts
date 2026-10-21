/**
 * The After Waking calendar. t = 0 is the moment the Intrepid's population was woken
 * (AW 0, Day 1, 00:00). Years are 365 days; there are no months aboard the Intrepid.
 */
import { DAY, HOUR, YEAR } from "./units";

/** The game opens thirty years after the Waking. */
export const GAME_START = 30 * YEAR;

export function yearOf(t: number): number {
  return Math.floor(t / YEAR);
}

export function dayOfYear(t: number): number {
  return Math.floor((t % YEAR) / DAY) + 1;
}

/** "AW 30 · Day 112 · 14:05" */
export function formatDate(t: number): string {
  const minutesToday = Math.floor(t % DAY);
  const hh = String(Math.floor(minutesToday / HOUR)).padStart(2, "0");
  const mm = String(minutesToday % HOUR).padStart(2, "0");
  return `AW ${yearOf(t)} · Day ${dayOfYear(t)} · ${hh}:${mm}`;
}

/** Compact duration: "45m", "6h 10m", "3d 4h", "2y 41d". */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < HOUR) return `${m}m`;
  if (m < DAY) {
    const h = Math.floor(m / HOUR);
    const rest = m % HOUR;
    return rest ? `${h}h ${rest}m` : `${h}h`;
  }
  if (m < YEAR) {
    const d = Math.floor(m / DAY);
    const h = Math.floor((m % DAY) / HOUR);
    return h ? `${d}d ${h}h` : `${d}d`;
  }
  const y = Math.floor(m / YEAR);
  const d = Math.floor((m % YEAR) / DAY);
  return d ? `${y}y ${d}d` : `${y}y`;
}

/** Whole years of age at time t for someone born at `born`. */
export function ageAt(born: number, t: number): number {
  return Math.floor((t - born) / YEAR);
}
