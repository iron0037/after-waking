/** AW-25: the Covenant's clue trail toward the Awaken ending. */
import { describe, expect, it } from "vitest";
import { CLUES, CLUES_FOR_FINALE } from "../src/data/clues";
import {
  acceptErrand,
  archiveText,
  awakenFinaleReached,
  awardClue,
  clueCount,
  covenantErrands,
  deserialize,
  doErrand,
  dossier,
  errandHere,
  errandTarget,
  fold,
  ghostOrbitAU,
  newGame,
  noticeArrival,
  noticeScan,
  recordFind,
  reportFutureLog,
  serialize,
  World,
  type GameState,
} from "../src/sim";
import { ARCHIVE } from "../src/data/archive";

const SEED = 42;
const world = new World(SEED);

function at(state: GameState, systemId: string): void {
  state.location = { kind: "space", systemId, pos: { x: world.system(systemId).edgeAU, y: 0 }, orbiting: null };
}

describe("the Covenant's dossier", () => {
  it("finds become evidence: folded plicite and song moss", () => {
    const state = newGame({ seed: SEED });
    recordFind(state, "gem", "folded-plicite", "somewhere", "folded plicite");
    recordFind(state, "flora", "song-moss", "somewhere", "song moss");
    expect(clueCount(state)).toBe(2);
    expect(state.awakening).toBe(2);
    expect(dossier(state).filter((d) => d.foundAt !== null).map((d) => d.clue.id)).toEqual(["folded-plicite", "song-moss"]);
  });

  it("older saves turn earlier finds into clues", () => {
    const state = newGame({ seed: SEED });
    state.compendium = { "gem:folded-plicite": { t: state.time, where: "x" } };
    expect(clueCount(deserialize(serialize(state)))).toBe(1);
  });

  it("the Archive turns strange after three clues, and the trail points onward after five", () => {
    const state = newGame({ seed: SEED });
    const entry = ARCHIVE.find((e) => e.strange)!;
    awardClue(state, "folded-plicite");
    awardClue(state, "song-moss");
    expect(archiveText(state, entry)).toBe(entry.text);
    awardClue(state, "seams");
    expect(archiveText(state, entry)).toBe(entry.strange);
    expect(state.futureLog).toBeDefined();
    expect(state.futureLog!.t).toBeGreaterThan(state.time);
    expect(reportFutureLog(state).ok).toBe(true);
    expect(awakenFinaleReached(state)).toBe(false);
    awardClue(state, "signal");
    expect(clueCount(state)).toBe(CLUES_FOR_FINALE);
    expect(awakenFinaleReached(state)).toBe(true);
    expect(awardClue(state, "signal")).toBeNull(); // once each
  });

  it("the Awaken-path perks notice things", () => {
    const state = newGame({ seed: SEED });
    state.captain.perks = [];
    const sci = state.crew!.find((m) => m.station === "science")!;
    sci.perks = ["anomaly-theory"];
    for (let i = 0; i < 40 && clueCount(state) === 0; i++) noticeScan(state, `s${i}.p1`);
    expect(clueCount(state)).toBe(1);
    const comms = state.crew!.find((m) => m.station === "comms")!;
    comms.perks = ["listening-post"];
    for (const s of world.galaxy.systems.filter((x) => !x.charted)) noticeArrival(state, world, s.id);
    expect(clueCount(state)).toBe(2);
  });
});

describe("the Covenant's errands", () => {
  it("the recorder is offered after a first clue (at once for Covenant captains) and pays out after three folds", () => {
    const state = newGame({ seed: SEED });
    expect(covenantErrands(state, world).length).toBe(0);
    expect(covenantErrands(newGame({ seed: SEED, clan: "covenant" }), world).map((o) => o.def.kind)).toEqual(["recorder"]);
    awardClue(state, "song-moss");
    expect(acceptErrand(state, world, "recorder").ok).toBe(true);
    const near = world.galaxy.systems.filter((s) => !s.home).sort((a, b) => Math.hypot(a.pos.x, a.pos.y) - Math.hypot(b.pos.x, b.pos.y))[0]!;
    const credits = state.credits;
    for (let i = 0; i < 2; i++) {
      state.ship.fuel = 60;
      state.foldReadyAt = 0;
      expect(fold(state, world, near.id).ok).toBe(true);
      state.foldReadyAt = 0;
      state.location = { kind: "space", systemId: near.id, pos: { x: world.system(near.id).edgeAU * 1.01, y: 0 }, orbiting: null };
      state.ship.cargo = {};
      expect(fold(state, world, "intrepid").ok).toBe(true);
    }
    expect(state.errands?.recorder?.status).toBe("done");
    expect(state.credits).toBeGreaterThan(credits);
    expect(clueCount(state)).toBe(2);
  });

  it("errands in a system: go there and do the task", () => {
    const state = newGame({ seed: SEED });
    awardClue(state, "song-moss");
    awardClue(state, "folded-plicite");
    state.location = { kind: "intrepid" };
    expect(acceptErrand(state, world, "missing-world").ok).toBe(true);
    expect(acceptErrand(state, world, "listen").ok).toBe(true);
    const target = errandTarget(state, world, "missing-world")!;
    expect(errandHere(state, world)).toBeNull();
    at(state, target);
    expect(errandHere(state, world)?.def.kind).toBe("missing-world");
    const t0 = state.time;
    expect(doErrand(state, world).ok).toBe(true);
    expect(state.time).toBeGreaterThan(t0);
    expect(clueCount(state)).toBe(3);
    expect(ghostOrbitAU(world, target)).toBeGreaterThan(0);
    at(state, errandTarget(state, world, "listen")!);
    expect(doErrand(state, world).ok).toBe(true);
    expect(clueCount(state)).toBe(4);
  });

  it("every clue has a way to be found", () => {
    expect(CLUES.length).toBeGreaterThanOrEqual(CLUES_FOR_FINALE + 2);
  });
});
