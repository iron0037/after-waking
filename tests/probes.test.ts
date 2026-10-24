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
