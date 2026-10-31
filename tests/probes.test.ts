/** Atmospheric probes (AW-16). */
import { describe, expect, it } from "vitest";
import { GAS_IDS } from "../src/data/commodities";
import { PROBE_PRICE } from "../src/data/probes";
import {
  buyProbes,
  chooseProbeOption,
  currentProbeEvent,
  diveDepthKm,
  diveOdds,
  optionHint,
  richnessLabel,
  flyTo,
  launchProbe,
  newGame,
  probeBlockers,
  sellPrice,
  World,
  xpForLevel,
  awardXp,
  type GameState,
} from "../src/sim";

function giantOf(world: World): { systemId: string; bodyId: string } {
  for (const sys of world.galaxy.systems.filter((s) => s.charted)) {
    const g = world.system(sys.id).bodies.find((b) => b.kind === "gasGiant");
    if (g) return { systemId: sys.id, bodyId: g.id };
  }
  throw new Error("no gas giant");
}

function inOrbit(state: GameState, world: World): string {
  const { systemId, bodyId } = giantOf(world);
  state.location = { kind: "space", systemId, pos: { x: 0, y: 0 }, orbiting: bodyId };
  if (!state.scannedBodies.includes(bodyId)) state.scannedBodies.push(bodyId);
  return bodyId;
}

function dive(state: GameState, world: World, depth: 1 | 2 | 3 | 4, pick: (step: number) => 0 | 1 = () => 1) {
  const launched = launchProbe(state, world, depth);
  if (!launched.ok) throw new Error(launched.reason);
  for (let step = 0; ; step++) {
    const r = chooseProbeOption(state, world, pick(step));
    if (!r.ok) throw new Error(r.reason);
    if (r.value.done) return r.value.result!;
  }
}

describe("atmospheric probes", () => {
  it("need a bay, probes, a scanned giant in orbit and a science officer", () => {
    const world = new World(42);
    const state = newGame({ seed: 42 });
    expect(probeBlockers(state, world)[0]).toMatch(/probe bay/);
    state.ship.upgrades.push("probeBay");
    state.credits = 50_000;
    expect(buyProbes(state, 5).ok).toBe(true);
    expect(state.ship.probes).toBe(3); // the bay holds three
    expect(probeBlockers(state, world).some((b) => /orbit/.test(b))).toBe(true);
    inOrbit(state, world);
    expect(probeBlockers(state, world)).toEqual([]);
    expect(launchProbe(state, world, 4).ok).toBe(false); // abyss needs the pressure-rated racks
  });

  it("dives through its decision points, then the probe comes back with gas (or doesn't)", () => {
    const world = new World(42);
    const state = newGame({ seed: 42 });
    state.ship.upgrades.push("probeBay");
    state.ship.probes = 3;
    inOrbit(state, world);
    const t0 = state.time;
    expect(launchProbe(state, world, 3).ok).toBe(true);
    expect(state.ship.probes).toBe(2);
    expect(flyTo(state, world, { edge: true }).ok).toBe(false); // can't leave a probe behind
    let steps = 0;
    while (currentProbeEvent(state)) {
      const r = chooseProbeOption(state, world, 0);
      expect(r.ok).toBe(true);
      steps++;
      if (r.ok && r.value.done) {
        const res = r.value.result!;
        expect(state.time).toBeGreaterThan(t0);
        if (res.outcome === "lost") expect(state.ship.probes).toBe(2);
        else {
          expect(state.ship.probes).toBe(3);
          expect(Object.keys(res.gases).length).toBeGreaterThan(0);
          for (const g of Object.keys(res.gases)) expect(GAS_IDS).toContain(g);
        }
      }
    }
    expect(steps).toBe(3);
    expect(state.probeDive).toBeUndefined();
  });

  it("a skilled pilot lowers the odds of losing a probe", () => {
    const world = new World(42);
    const state = newGame({ seed: 42 });
    state.ship.upgrades.push("probeBay");
    const body = world.body(inOrbit(state, world)).body;
    const green = diveOdds(state, world, body)[2]!.risk;
    awardXp(state, "science", xpForLevel(8));
    expect(diveOdds(state, world, body)[2]!.risk).toBeLessThan(green);
  });

  it("breaks the expected haul down by gas, adding up to the whole", () => {
    const world = new World(42);
    const state = newGame({ seed: 42 });
    state.ship.upgrades.push("probeBay");
    const body = world.body(inOrbit(state, world)).body;
    for (const o of diveOdds(state, world, body)) {
      const sum = o.gases.reduce((s, g) => s + g.tonnes, 0);
      expect(sum).toBeCloseTo(o.tonnes, 5);
      expect(o.gases[0]!.tonnes).toBeGreaterThanOrEqual(o.gases.at(-1)!.tonnes);
    }
  });

  it("pays its way over many dives, deeper for more (and riskier) money", () => {
    const world = new World(42);
    const rows: Record<string, number | string>[] = [];
    let prevNet = -Infinity;
    for (const depth of [1, 2, 3, 4] as const) {
      let value = 0;
      let lost = 0;
      let hours = 0;
      const N = 400;
      for (let i = 0; i < N; i++) {
        const state = newGame({ seed: 42 });
        state.rngState = (i * 2654435761) | 0;
        state.ship.upgrades.push("probeBay", "probeBay2");
        state.ship.probes = 1;
        inOrbit(state, world);
        const res = dive(state, world, depth, (s) => ((i + s) % 2) as 0 | 1);
        if (res.outcome === "lost") lost++;
        hours += res.hours;
        for (const [g, t] of Object.entries(res.gases)) value += (t ?? 0) * sellPrice(state.market, g as never);
      }
      const net = (value - lost * PROBE_PRICE) / N;
      rows.push({ depth, "avg haul cr": Math.round(value / N), "lost %": Math.round((100 * lost) / N), "net per dive": Math.round(net), hours: Math.round(hours / N) });
      expect(net).toBeGreaterThan(prevNet * 0.8); // deeper doesn't pay less
      prevNet = net;
    }
    console.table(rows);
  });

  it("describes richness and choices in words", () => {
    expect(richnessLabel(0.65)).toBe("lean");
    expect(richnessLabel(1)).toBe("average");
    expect(richnessLabel(1.35)).toBe("rich");
    expect(optionHint({ label: "x", risk: 0.04, hours: -2 })).toBe("faster, riskier");
    expect(optionHint({ label: "x", riskMult: 0.5, yield: 0.7 })).toBe("safer, leaner sample");
    expect(optionHint({ label: "x" })).toBe("");
    expect(diveDepthKm(3, 0)).toBeLessThan(diveDepthKm(3, 2));
    expect(diveDepthKm(3, 2)).toBeLessThan(900);
  });
});

describe("probes v2: jobs, readings, floating life", () => {
  it("a probe bay brings probe work to the job board", async () => {
    const { advanceTime } = await import("../src/sim");
    const state = newGame({ seed: 42 });
    expect(state.contracts.some((c) => c.kind === "probe" || ["methane", "deuterium", "xenon", "helium3"].includes(c.commodity ?? ""))).toBe(false);
    state.ship.upgrades.push("probeBay");
    advanceTime(state, 1);
    expect(state.contracts.some((c) => c.status === "offered" && (c.kind === "probe" || GAS_IDS.includes(c.commodity as never)))).toBe(true);
  });

  it("an atmospheric survey contract completes when a probe comes back from deep enough", async () => {
    const { acceptContract, contractProgress, probeSurveyContract, Rng } = await import("../src/sim");
    const world = new World(42);
    const state = newGame({ seed: 42 });
    state.ship.upgrades.push("probeBay");
    state.ship.probes = 3;
    const job = probeSurveyContract(state, new Rng(5), 900)!;
    state.contracts.push(job);
    expect(acceptContract(state, job.id).ok).toBe(true);
    const body = world.body(job.bodyId!).body;
    const systemId = job.bodyId!.split(".")[0]!;
    state.location = { kind: "space", systemId, pos: { x: 0, y: 0 }, orbiting: body.id };
    state.scannedBodies.push(body.id);
    expect(contractProgress(state, job).ready).toBe(false);
    expect(launchProbe(state, world, job.depth as 2 | 3).ok).toBe(true);
    state.probeDive!.risk = 0; // make sure it comes back
    while (currentProbeEvent(state)) chooseProbeOption(state, world, 0);
    expect(contractProgress(state, job).ready).toBe(true);
  });

  it("returned probes chart the atmosphere: true values in the planner, and readings the Lyceum buys once", async () => {
    const { atmosphereCharted, sellReadings, unsoldReadings } = await import("../src/sim");
    const world = new World(42);
    const state = newGame({ seed: 42 });
    state.ship.upgrades.push("probeBay");
    state.ship.probes = 3;
    const bodyId = inOrbit(state, world);
    const body = world.body(bodyId).body;
    expect(atmosphereCharted(state, bodyId)).toBe(false);
    expect(diveOdds(state, world, body)[0]!.estimated).toBe(true);
    expect(launchProbe(state, world, 2).ok).toBe(true);
    state.probeDive!.risk = 0;
    while (currentProbeEvent(state)) chooseProbeOption(state, world, 1);
    expect(atmosphereCharted(state, bodyId)).toBe(true);
    expect(diveOdds(state, world, body)[0]!.estimated).toBe(false);
    expect(unsoldReadings(state).map((r) => r.depth).sort()).toEqual([1, 2]);
    state.location = { kind: "intrepid" };
    const credits = state.credits;
    expect(sellReadings(state).ok).toBe(true);
    expect(state.credits).toBeGreaterThan(credits);
    expect(sellReadings(state).ok).toBe(false); // each band pays once
  });

  it("deep dives into a living giant sometimes bring up floating life, prized by the Lyceum; dead giants never", async () => {
    const { sellSpecimens, giantAlive } = await import("../src/sim");
    const world = new World(42);
    // Dead giants (playtest 15) never give up life.
    {
      const state = newGame({ seed: 42 });
      const id = inOrbit(state, world);
      const body = world.body(id).body;
      if (!giantAlive(state, body)) {
        let any = 0;
        for (let i = 0; i < 60; i++) {
          const s2 = newGame({ seed: 42 });
          s2.rngState = (i * 2246822519) | 0;
          s2.ship.upgrades.push("probeBay", "probeBay2");
          s2.ship.probes = 1;
          inOrbit(s2, world);
          launchProbe(s2, world, 4);
          s2.probeDive!.risk = 0;
          while (currentProbeEvent(s2)) {
            const r = chooseProbeOption(s2, world, 1);
            if (r.ok && r.value.done && r.value.result?.floater) any++;
          }
        }
        expect(any).toBe(0);
      }
    }
    let floaters = 0;
    const N = 300;
    let sample: GameState | null = null;
    for (let i = 0; i < N; i++) {
      const state = newGame({ seed: 42 });
      state.rngState = (i * 2246822519) | 0;
      state.ship.upgrades.push("probeBay", "probeBay2");
      state.ship.probes = 1;
      const giant = inOrbit(state, world);
      // Make this a living giant (a confirmed catch always counts as alive).
      state.giantLife = { [giant]: ["cloud drifter"] };
      launchProbe(state, world, 4);
      state.probeDive!.risk = 0;
      let result;
      while (currentProbeEvent(state)) {
        const r = chooseProbeOption(state, world, 1);
        if (r.ok && r.value.done) result = r.value.result;
      }
      if (result?.floater) {
        floaters++;
        sample ??= state;
      }
    }
    expect(floaters / N).toBeGreaterThan(0.12);
    expect(floaters / N).toBeLessThan(0.45);
    // A floater sells for well above an ordinary plant sample.
    sample!.location = { kind: "intrepid" };
    sample!.catalogedSpecies = Object.keys(sample!.ship.specimens ?? {}); // no first-sale bonus, just the price
    const r = sellSpecimens(sample!);
    expect(r.ok && r.value).toBeGreaterThan(1_000);
  });

  it("planner helpers: which bands a dive would newly profile, and a floater's price per specimen", async () => {
    const { newReadingsFor, specimenUnitPrice, SPECIMEN_PRICE, READING_PRICE_PER_DEPTH } = await import("../src/sim");
    const world = new World(42);
    const state = newGame({ seed: 42 });
    const bodyId = inOrbit(state, world);
    expect(newReadingsFor(state, bodyId, 3)).toEqual({ depths: [1, 2, 3], value: READING_PRICE_PER_DEPTH * 6 });
    state.atmoReadings = { [bodyId]: [1, 2] };
    expect(newReadingsFor(state, bodyId, 2)).toEqual({ depths: [], value: 0 });
    expect(newReadingsFor(state, bodyId, 4)).toEqual({ depths: [3, 4], value: READING_PRICE_PER_DEPTH * 7 });
    expect(specimenUnitPrice(state, `${bodyId}|abyssal bloom`)).toBeGreaterThanOrEqual(SPECIMEN_PRICE * 8);
    expect(specimenUnitPrice(state, `${bodyId}|no such plant`)).toBeGreaterThanOrEqual(SPECIMEN_PRICE);
  });
});
