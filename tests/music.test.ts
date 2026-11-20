/** AW-274: the soundtrack: which cue plays where. */
import { describe, expect, it } from "vitest";
import { MUSIC_CUES, musicFor, surfaceCue } from "../src/ui/audio/music";

const files = new Set(Object.keys(import.meta.glob("../public/assets/music/*.ogg")).map((p) => p.split("/").pop()));

describe("soundtrack cues (AW-274)", () => {
  it("plays home on the Intrepid and at outposts, space on the maps, and the world's own music on a landing", () => {
    expect(musicFor("hub", null)).toBe("music-intrepid");
    expect(musicFor("outpost", null)).toBe("music-intrepid");
    expect(musicFor("starmap", null)).toBe("music-space");
    expect(musicFor("system", null)).toBe("music-space");
    expect(musicFor("surface", null, { kind: "ocean" })).toBe("music-surface-wild");
  });

  it("suits the music to the world", () => {
    expect(surfaceCue({ kind: "asteroid" })).toBe("music-surface-calm");
    expect(surfaceCue({ kind: "barren" })).toBe("music-surface-calm");
    expect(surfaceCue({ kind: "ice" })).toBe("music-surface-calm");
    expect(surfaceCue({ kind: "terrestrial" })).toBe("music-surface-wild");
    expect(surfaceCue({ kind: "volcanic" })).toBe("music-surface-dire");
    expect(surfaceCue({ kind: "hothouse", sea: "acid" })).toBe("music-surface-dire");
    expect(surfaceCue({ kind: "ice", sea: "methane" })).toBe("music-surface-strange");
  });

  it("turns to combat while a raider is on the scope, and back once it's settled", () => {
    for (const stage of ["contact", "hail", "battle"]) expect(musicFor("system", stage)).toBe("music-combat");
    expect(musicFor("system", "prize")).toBe("music-space");
  });

  it("ships a file for every cue", () => {
    for (const cue of MUSIC_CUES) expect(files.has(`${cue}.ogg`), cue).toBe(true);
  });
});
