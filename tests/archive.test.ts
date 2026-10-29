/** AW-24: the Archive as first-run guidance. */
import { describe, expect, it } from "vitest";
import { ARCHIVE } from "../src/data/archive";
import { archiveNext, archiveRead, archiveText, deserialize, dismissArchive, newGame, resetArchive, serialize, setGuidance } from "../src/sim";

describe("the Archive's guidance", () => {
  it("opens with the orientation, then the Intrepid, each once", () => {
    const state = newGame({ seed: 1 });
    expect(archiveNext(state)?.id).toBe("welcome");
    dismissArchive(state, "welcome");
    expect(archiveNext(state)?.id).toBe("intrepid");
    dismissArchive(state, "intrepid");
    expect(archiveNext(state)).toBeNull();
    expect(archiveRead(state).map((e) => e.id)).toEqual(["welcome", "intrepid"]);
  });

  it("screens raise their own subjects", () => {
    const state = newGame({ seed: 1 });
    state.archiveSeen = ["welcome", "intrepid"];
    expect(archiveNext(state, ["contracts"])?.id).toBe("contracts");
    expect(archiveNext(state, ["region-chart", "starmap"])?.id).toBe("starmap"); // Archive order
  });

  it("state subjects come up on their own", () => {
    const state = newGame({ seed: 1 });
    state.archiveSeen = ["welcome", "intrepid"];
    state.ship.specimens = { "s0.p1|glass reed": 1 };
    expect(archiveNext(state)?.id).toBe("specimens");
    state.ship.damage = { hull: 10, drives: 0, weapons: 0, sensors: 0 };
    expect(archiveNext(state)?.id).toBe("specimens");
    dismissArchive(state, "specimens");
    expect(archiveNext(state)?.id).toBe("damage");
  });

  it("can be silenced, turned off at the start, and reset", () => {
    const state = newGame({ seed: 1 });
    setGuidance(state, false);
    expect(archiveNext(state)).toBeNull();
    expect(archiveNext(newGame({ seed: 1, guidance: false }))).toBeNull();
    dismissArchive(state, "welcome");
    resetArchive(state);
    expect(archiveNext(state)?.id).toBe("welcome");
  });

  it("survives a save, and older saves get it too", () => {
    const state = newGame({ seed: 1 });
    dismissArchive(state, "welcome");
    expect(deserialize(serialize(state)).archiveSeen).toEqual(["welcome"]);
    const old = newGame({ seed: 1 });
    delete old.guidance;
    delete old.archiveSeen;
    expect(archiveNext(deserialize(serialize(old)))?.id).toBe("welcome");
  });

  it("every entry has a unique id, and turns strange on the Awaken path where it has a strange text", () => {
    expect(new Set(ARCHIVE.map((e) => e.id)).size).toBe(ARCHIVE.length);
    const state = newGame({ seed: 1 });
    const welcome = ARCHIVE[0]!;
    expect(archiveText(state, welcome)).toBe(welcome.text);
    state.awakening = 3;
    expect(archiveText(state, welcome)).toBe(welcome.strange);
  });

  it("never mentions thinking machines aboard (lore: no AI crew)", () => {
    for (const e of ARCHIVE) expect(`${e.text} ${e.gloss ?? ""}`).not.toMatch(/\b(android|robot|AI crew)\b/i);
  });
});
