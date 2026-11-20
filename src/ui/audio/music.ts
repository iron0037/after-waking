/**
 * The soundtrack (AW-274): which looping cue plays where. The cues are Stable Audio Open renders
 * (tools/audio/sfx.py --manifest music.json), made into seamless loops by tools/audio/master_music.py.
 * Pure, so it's tested without a browser; App plays what it picks through audio.music().
 */
import type { Body } from "../../sim";
import type { View } from "../session";

export type SurfaceCue = "music-surface-calm" | "music-surface-wild" | "music-surface-dire" | "music-surface-strange";
export type MusicCue = "music-title" | "music-intrepid" | "music-space" | SurfaceCue | "music-combat";

export const MUSIC_CUES: readonly MusicCue[] = [
  "music-title",
  "music-intrepid",
  "music-space",
  "music-surface-calm",
  "music-surface-wild",
  "music-surface-dire",
  "music-surface-strange",
  "music-combat",
];

/**
 * A landing's music suits the world: a sense of adventure on living, watery worlds; something foreboding on
 * volcanic and hothouse worlds; something strange where a methane, ammonia, nitrogen or acid sea laps the
 * shore; and serene and contemplative on bare rock and ice.
 */
export function surfaceCue(body: Pick<Body, "kind" | "sea">): SurfaceCue {
  if (body.kind === "volcanic" || body.kind === "hothouse") return "music-surface-dire";
  if (body.sea) return "music-surface-strange";
  if (body.kind === "terrestrial" || body.kind === "ocean") return "music-surface-wild";
  return "music-surface-calm";
}

/** Where a cue's file is served from. */
export const musicUrl = (cue: MusicCue): string => `./assets/music/${cue}.ogg`;

/**
 * The cue for what's on screen: a raider on the scope (hailing or fighting) overrides everything until it's
 * settled; otherwise the Intrepid and the outposts are home, the maps are space, and a landing suits its world.
 */
export function musicFor(view: View, encounterStage: string | null, landedOn: Pick<Body, "kind" | "sea"> | null = null): MusicCue {
  if (encounterStage && encounterStage !== "prize") return "music-combat";
  switch (view) {
    case "hub":
    case "outpost":
      return "music-intrepid";
    case "surface":
      return landedOn ? surfaceCue(landedOn) : "music-surface-calm";
    default:
      return "music-space";
  }
}
