/** AW-31 phase 1: which sound an action makes, from the game before and after it. */
import { describe, expect, it } from "vitest";
import { DAY } from "../src/sim";
import { soundsFor, type SoundSnapshot } from "../src/ui/audio/triggers";

const base: SoundSnapshot = { kind: "space", systemId: "a", orbiting: null, credits: 1000, levelUps: 0, time: 0 };
const snap = (patch: Partial<SoundSnapshot>): SoundSnapshot => ({ ...base, ...patch });

describe("sound triggers (AW-31)", () => {
  it("the moves: dock, leave the Intrepid, land, lift off, fold, orbit", () => {
    expect(soundsFor(snap({}), snap({ kind: "intrepid", systemId: null }), [])).toEqual(["dock"]);
    expect(soundsFor(snap({ kind: "intrepid", systemId: null }), snap({}), [])).toEqual(["undock", "fold"]);
    expect(soundsFor(snap({}), snap({ kind: "surface" }), [])).toEqual(["land"]);
    expect(soundsFor(snap({ kind: "surface" }), snap({}), [])).toEqual(["liftoff"]);
    expect(soundsFor(snap({}), snap({ systemId: "b" }), [])).toEqual(["fold"]);
    expect(soundsFor(snap({}), snap({ kind: "deep", systemId: null }), [])).toEqual(["fold"]);
    // Entering orbit sounds when the flight's animation arrives (SystemView), so not here; nor money on the way.
    expect(soundsFor(snap({}), snap({ orbiting: "a.1", credits: 900 }), [])).toEqual([]);
  });

  it("then a level-up, a find, or money changing hands on the spot", () => {
    expect(soundsFor(snap({}), snap({ levelUps: 1 }), [])).toEqual(["levelup"]);
    expect(soundsFor(snap({}), snap({ kind: "surface", levelUps: 1 }), [])).toEqual(["land", "levelup"]);
    expect(soundsFor(snap({}), snap({}), ["discovery"])).toEqual(["discovery"]);
    expect(soundsFor(snap({}), snap({ credits: 2000 }), [])).toEqual(["credits"]);
    expect(soundsFor(snap({}), snap({ credits: 500 }), [])).toEqual(["purchase"]);
  });

  it("stays quiet for days passing (wages) and for nothing happening", () => {
    expect(soundsFor(snap({}), snap({ credits: 500, time: 3 * DAY }), [])).toEqual([]);
    expect(soundsFor(snap({}), snap({}), [])).toEqual([]);
  });
});
