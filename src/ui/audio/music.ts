/**
 * The soundtrack (AW-274): which looping cue plays where. The cues are Stable Audio Open renders
 * (tools/audio/sfx.py --manifest music.json), made into seamless loops by tools/audio/master_music.py.
 * Pure, so it's tested without a browser; App plays what it picks through audio.music().
 */
import type { View } from "../session";

export type MusicCue = "music-title" | "music-intrepid" | "music-space" | "music-surface" | "music-combat";

export const MUSIC_CUES: readonly MusicCue[] = ["music-title", "music-intrepid", "music-space", "music-surface", "music-combat"];

/** Where a cue's file is served from. */
export const musicUrl = (cue: MusicCue): string => `./assets/music/${cue}.ogg`;

/**
 * The cue for what's on screen: a raider on the scope (hailing or fighting) overrides everything until it's
 * settled; otherwise the Intrepid and the outposts are home, the maps are space, and a landing is the surface.
 */
export function musicFor(view: View, encounterStage: string | null): MusicCue {
  if (encounterStage && encounterStage !== "prize") return "music-combat";
  switch (view) {
    case "hub":
    case "outpost":
      return "music-intrepid";
    case "surface":
      return "music-surface";
    default:
      return "music-space";
  }
}
