/** AW-166 / AW-199: the Return ending and the career report. */
import { describe, expect, it } from "vitest";
import {
  ANOMALY_REWARD,
  anomalyProbeBlockers,
  anomalyStage,
  deepSites,
  endingText,
  isFinished,
  newGame,
  probeAnomaly,
  reportAnomaly,
  volunteerBlockers,
  volunteerForAnomaly,
  World,
  awardClue,
  buyUpgrade,
  covenantWhisper,
  crossEdgeBlockers,
  crossTheEdge,
  dist,
  edgeLy,
  emergenceKnown,
  emergenceZone,
  INTREPID_POS,
  regionRareSpecies,
  scanDeep,
  type GameState,
} from "../src/sim";
import { RESEARCH_BY_ID } from "../src/data/research";
import { UPGRADES_BY_ID } from "../src/data/ship";

const world = new World(42);
const mouth = deepSites(world).find((s) => s.kind === "anomaly")!;

function atMouth(): GameState {
  const state = newGame({ seed: 42 });
  state.location = { kind: "deep", pos: { ...mouth.pos } };
  state.deepKnown = { anomaly: "known" };
  return state;
}

describe("the Return ending (AW-166)", () => {
  it("probe, report, volunteer: the career ends with a report", () => {
    const state = atMouth();
    expect(anomalyStage(state)).toBe("found");
    expect(anomalyProbeBlockers(state, world)[0]).toMatch(/probe bay/);
    state.ship.upgrades.push("probeBay");
    state.ship.probes = 1;
    expect(anomalyProbeBlockers(state, world)).toEqual([]);
    expect(probeAnomaly(state, world).ok).toBe(true);
    expect(state.ship.probes).toBe(0);
    expect(anomalyStage(state)).toBe("probed");
    expect(probeAnomaly(state, world).ok).toBe(false);

    // The council meets aboard the Intrepid.
    expect(reportAnomaly(state).ok).toBe(false);
    state.location = { kind: "intrepid" };
    const credits = state.credits;
    expect(reportAnomaly(state).ok).toBe(true);
    expect(state.credits).toBe(credits + ANOMALY_REWARD);
    expect(anomalyStage(state)).toBe("reported");

    expect(volunteerBlockers(state)).toEqual([]);
    state.stats.tonnesMined = 1234;
    const r = volunteerForAnomaly(state, world);
    if (!r.ok) throw new Error(r.reason);
    expect(isFinished(state)).toBe(true);
    expect(r.value.id).toBe("return");
    expect(r.value.report.tonnesMined).toBe(1234);
    expect(r.value.report.compendium.total).toBeGreaterThan(0);
    expect(volunteerForAnomaly(state, world).ok).toBe(false);
    // Saves round-trip as plain JSON.
    expect(JSON.parse(JSON.stringify(state)).ending.report.captain).toBe(state.captain.name);
  });

  it("can't skip the proof or the report", () => {
    const state = atMouth();
    state.location = { kind: "intrepid" };
    expect(reportAnomaly(state).ok).toBe(false);
    expect(volunteerBlockers(state)[0]).toMatch(/Report/);
    expect(anomalyProbeBlockers(state, world)[0]).toMatch(/Fold to the anomaly/);
  });

  it("a captain who has read the dossier sees one thing more", () => {
    const state = atMouth();
    const plain = endingText(state, "return").coda;
    state.clues = [
      { id: "fold-curve", t: 0 },
      { id: "missing-world", t: 0 },
      { id: "signal", t: 0 },
    ];
    expect(endingText(state, "return").coda).not.toBe(plain);
    expect(endingText(state, "return").coda).toMatch(/Covenant/);
  });
});

describe("the emergence zone (AW-200)", () => {
  it("always holds the mouth, and comes with the deep-field array", () => {
    for (const seed of [1, 42, 777, 9001, 31337]) {
      const w = new World(seed);
      const m = deepSites(w).find((s) => s.kind === "anomaly")!;
      const zone = emergenceZone(w)!;
      expect(dist(zone.centre, m.pos)).toBeLessThan(zone.r - 1);
    }
    const state = newGame({ seed: 42 });
    expect(emergenceKnown(state)).toBe(false);
    state.ship.upgrades.push("deepFieldArray");
    expect(emergenceKnown(state)).toBe(true);
    // Once the mouth is found, the zone has done its job.
    state.deepKnown = { anomaly: "known" };
    expect(emergenceKnown(state)).toBe(false);
  });

  it("the Helm's note arrives with the order", () => {
    const state = newGame({ seed: 42 });
    state.credits = 500_000;
    state.location = { kind: "intrepid" };
    expect(buyUpgrade(state, "deepFieldArray").ok).toBe(true);
    expect(state.journal.some((e) => e.text.includes("emergence zone"))).toBe(true);
  });
});

describe("the living archive (AW-201)", () => {
  it("asks for three rare specimens, and the xenolab spots rare life from orbit", () => {
    const need = RESEARCH_BY_ID.get("living-archive")!.needs[0]!;
    expect(need.kind === "specimens" && need.count).toBe(3);
    expect(UPGRADES_BY_ID.get("fieldXenolab")!.description).toMatch(/orbit/);
    // Somewhere in the Verge a region holds a rare plant, and the function names it.
    const w = new World(42);
    const found = w.galaxy.systems.some((sys) =>
      w.system(sys.id).bodies.some((b) => Array.from({ length: b.regions }, (_, r) => regionRareSpecies(42, b, r)).some((l) => l.length > 0)),
    );
    expect(found).toBe(true);
  });
});

describe("the Covenant trail (AW-202) and the edge (AW-170)", () => {
  it("the listeners whisper once their errands are done", () => {
    const state = newGame({ seed: 42 });
    expect(covenantWhisper(state)).toBeNull();
    state.errands = { recorder: { status: "done" }, "missing-world": { status: "done" }, listen: { status: "done" } };
    awardClue(state, "fold-curve");
    awardClue(state, "missing-world");
    awardClue(state, "signal");
    expect(state.journal.some((e) => e.text.includes("won't sort"))).toBe(true);
    expect(covenantWhisper(state)).toMatch(/"/);
  });

  it("five clues and a sweep past the last star open the seam", () => {
    const state = newGame({ seed: 42 });
    state.ship.upgrades.push("deepFieldArray");
    const edge = edgeLy(world);
    const far = Math.max(...world.galaxy.systems.map((s) => dist(s.pos, INTREPID_POS)));
    expect(edge).toBeGreaterThan(far);
    state.location = { kind: "deep", pos: { x: INTREPID_POS.x + edge + 0.5, y: INTREPID_POS.y } };
    expect(scanDeep(state, world).ok).toBe(true);
    expect(state.edgeSeenAt).toBeUndefined(); // the Covenant hasn't sent you: it's just dark
    for (const id of ["fold-curve", "missing-world", "signal", "seams", "song-moss"] as const) awardClue(state, id);
    expect(crossEdgeBlockers(state, world)[0]).toMatch(/Sweep/);
    expect(scanDeep(state, world).ok).toBe(true);
    expect(state.edgeSeenAt).toBeDefined();
    const r = crossTheEdge(state, world);
    if (!r.ok) throw new Error(r.reason);
    expect(r.value.id).toBe("awaken");
    expect(endingText(state, "awaken").paragraphs.join(" ")).toMatch(/CRYOSTASIS/);
  });
});
