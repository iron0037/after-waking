/** AW-274: the soundtrack: which cue plays where. */
import { describe, expect, it } from "vitest";
import { musicFor } from "../src/ui/audio/music";

describe("soundtrack cues (AW-274)", () => {
  it("plays home on the Intrepid and at outposts, space on the maps, and the surface on a landing", () => {
    expect(musicFor("hub", null)).toBe("music-intrepid");
    expect(musicFor("outpost", null)).toBe("music-intrepid");
    expect(musicFor("starmap", null)).toBe("music-space");
    expect(musicFor("system", null)).toBe("music-space");
    expect(musicFor("surface", null)).toBe("music-surface");
  });

  it("turns to combat while a raider is on the scope, and back once it's settled", () => {
    for (const stage of ["contact", "hail", "battle"]) expect(musicFor("system", stage)).toBe("music-combat");
    expect(musicFor("system", "prize")).toBe("music-space");
  });
});
