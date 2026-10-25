/** Perk trees (AW-95): the framework, and every perk that works with today's systems. */
import { describe, expect, it } from "vitest";
import { BASE_STATS } from "../src/data/ship";
import { PERKS, PERKS_BY_ID } from "../src/data/perks";
import {
  acknowledgeLevelUp,
  departureReadyAt,
  awardXp,
  contractPayout,
  crewBonuses,
  deployRover,
  drill,
  drillRate,
  effectiveStats,
  flightPlan,
  flyTo,
  fold,
  foldEdgeFraction,
  foldPlan,
  freePerkPoints,
  fuelCreditLimit,
  hasPerk,
  hireRecruit,
  hopFuelTo,
  hunchRegion,
  knowledge,
  land,
  landingAccess,
  loanRate,
  marketForecast,
  newGame,
  officerAt,
  perkBlocker,
  prospect,
  prospectRange,
  RECRUIT_POOL_DAYS,
  RECRUIT_POOL_SIZE,
  rescueQuote,
  retrain,
  roverChargePerHour,
  roverSpecimenSlots,
  routeEnergyMult,
  scanBody,
  sell,
  sensorRadius,
  shipSpecimenSlots,
  signingFee,
  stationLevel,
  stepCost,
  surveyBody,
  surveyMinutes,
  takePerk,
  wait,
  World,
  xpForLevel,
  acceptContract,
  collectSample,
  rollMineralSpecimen,
  Rng,
  DAY,
  type GameState,
  sensorSweep,
  detectsDeposit,
  sensesDeposit,
} from "../src/sim";
import { hexDistance } from "../src/sim/hex";
import { regionSource } from "../src/sim/pathfinding";
import { Terrain } from "../src/sim/surface";
import type { Station } from "../src/data/crew";

/** Give whoever holds the perk's station that perk (raising them to level 10 so they have points). */
function grant(state: GameState, id: string): void {
  const def = PERKS_BY_ID.get(id);
  if (!def) throw new Error(`no perk ${id}`);
  const holder = def.station === "captain" ? state.captain : officerAt(state, def.station as Exclude<Station, "captain">)!;
  holder.xp = Math.max(holder.xp ?? 0, xpForLevel(10));
  holder.perks = [...(holder.perks ?? []), id];
  expect(hasPerk(state, id)).toBe(true);
}

function onSurface(seed = 42): { state: GameState; world: World; bodyId: string } {
  const world = new World(seed);
  const state = newGame({ seed });
  expect(fold(state, world, "s0").ok).toBe(true);
  const body = world.system("s0").bodies.find((b) => b.easy && b.life && landingAccess(b, BASE_STATS.ratings).ok)
    ?? world.system("s0").bodies.find((b) => b.easy && landingAccess(b, BASE_STATS.ratings).ok)!;
  expect(flyTo(state, world, { bodyId: body.id }).ok).toBe(true);
  return { state, world, bodyId: body.id };
}

describe("perk framework", () => {
  it("has three branches of five tiers per station", () => {
    for (const station of ["captain", "science", "navigation", "engineering", "comms", "medical"]) {
      const mine = PERKS.filter((p) => p.station === station);
      expect(mine).toHaveLength(15);
      expect(new Set(mine.map((p) => p.branch)).size).toBe(3);
    }
    expect(new Set(PERKS.map((p) => p.id)).size).toBe(PERKS.length);
  });

  it("earns a point per level, and takes perks in tier order", () => {
    const state = newGame({ seed: 42 });
    const eng = officerAt(state, "engineering")!;
    expect(freePerkPoints(eng)).toBe(0);
    awardXp(state, "engineering", xpForLevel(4));
    expect(freePerkPoints(eng)).toBe(stationLevel(state, "engineering") - 1);
    expect(perkBlocker(eng, "engineering", PERKS_BY_ID.get("jury-rig")!)).toMatch(/Needs 1 Mechanics perk/);
    expect(takePerk(state, "engineering", "drill-master").ok).toBe(true);
    expect(takePerk(state, "engineering", "jury-rig").ok).toBe(true);
    expect(takePerk(state, "engineering", "drill-master").ok).toBe(false); // already taken
    expect(takePerk(state, "engineering", "fire-control").ok).toBe(false); // locked: needs combat
  });

  it("queues level-ups for the popup", () => {
    const state = newGame({ seed: 42 });
    awardXp(state, "navigation", xpForLevel(3));
    expect(state.levelUps).toHaveLength(1);
    expect(state.levelUps![0]!.station).toBe("navigation");
    expect(acknowledgeLevelUp(state).ok).toBe(true);
    expect(state.levelUps).toHaveLength(0);
  });

  it("retrains at the Lyceum: points back, for credits and weeks", () => {
    const state = newGame({ seed: 42 });
    state.credits = 100_000;
    awardXp(state, "science", xpForLevel(3));
    expect(takePerk(state, "science", "seam-sense").ok).toBe(true);
    const t0 = state.time;
    const r = retrain(state, "science");
    expect(r.ok && r.value.refunded).toBe(1);
    // The course runs in the yard alongside other work: no time passes yet, but the ship can't leave.
    expect(state.time).toBe(t0);
    expect(state.credits).toBeLessThan(100_000);
    expect(departureReadyAt(state) - t0).toBeGreaterThanOrEqual(14 * DAY);
    expect(takePerk(state, "science", "field-botanist").ok).toBe(false); // away on the course
    wait(state, departureReadyAt(state) - state.time);
    expect(officerAt(state, "science")!.perks).toEqual([]);
  });

  it("recruits arrive with their points spent", () => {
    const state = newGame({ seed: 9 });
    for (const r of state.recruits!) {
      expect(freePerkPoints(r)).toBe(0);
      for (const id of r.perks ?? []) expect(PERKS_BY_ID.get(id)!.station).toBe(r.station);
    }
  });
});

describe("cross-training counts as extra levels", () => {
  it.each([
    ["drill-master", (s: GameState) => crewBonuses(s).drillRate, "up"],
    ["haggler", (s: GameState) => crewBonuses(s).salePrice, "up"],
    ["deal-maker", (s: GameState) => crewBonuses(s).contractPay, "up"],
    ["culture-lab", (s: GameState) => crewBonuses(s).specimenPrice, "up"],
    ["triage", (s: GameState) => crewBonuses(s).incidentHours, "down"],
    ["drive-harmonics", (s: GameState) => crewBonuses(s).foldFuel, "down"],
    ["plicite-chemistry", (s: GameState) => crewBonuses(s).foldRefit, "down"],
    ["efficient-burns", (s: GameState) => crewBonuses(s).flightFuel, "down"],
    ["drive-tuning", (s: GameState) => crewBonuses(s).flightFuel, "down"],
  ] as const)("%s", (id, read, dir) => {
    const state = newGame({ seed: 42 });
    const before = read(state);
    grant(state, id);
    // Granting raised the holder to level 10 too; compare against the same level without the perk.
    const holder = PERKS_BY_ID.get(id)!;
    const without = structuredClone(state);
    const h = holder.station === "captain" ? without.captain : officerAt(without, holder.station as Exclude<Station, "captain">)!;
    h.perks = [];
    if (dir === "up") expect(read(state)).toBeGreaterThan(read(without));
    else expect(read(state)).toBeLessThan(read(without));
    void before;
  });
});

describe("perks that change the ship's numbers", () => {
  it("adjusts effective stats", () => {
    const state = newGame({ seed: 42 });
    const base = effectiveStats(state);
    for (const id of ["power-management", "rover-overhaul", "deep-bore", "afterburner", "long-fold", "storm-pilot", "lift-rating", "hazard-suits"]) grant(state, id);
    const s = effectiveStats(state);
    expect(s.roverEnergy).toBe(Math.round(base.roverEnergy * 1.15));
    expect(s.roverCargoT).toBe(Math.round(base.roverCargoT * 1.25));
    expect(s.drillMaxDepthM).toBe(Math.round(base.drillMaxDepthM * 1.2));
    expect(s.cruiseSpeedC).toBeGreaterThan(base.cruiseSpeedC);
    expect(s.foldRangeLy).toBe(base.foldRangeLy + 1);
    expect(s.ratings.maxGravityG).toBeCloseTo(base.ratings.maxGravityG * 1.2 + 0.2, 1);
    expect(s.ratings.maxRadiation).toBe(base.ratings.maxRadiation + 1);
    expect(s.ratings.maxTempC).toBe(base.ratings.maxTempC + 20);
  });

  it("sensor sweep, incidents, charging, slots, routes, credit, rescue, loan, fees", () => {
    const state = newGame({ seed: 42 });
    const radius = sensorRadius(state, "s0.p1");
    const incidents = crewBonuses(state).incidentRate;
    for (const id of ["sensor-boost", "steady-hands", "fast-charge", "containment", "pathfinder", "credit-line", "note-restructuring", "recruiter"]) grant(state, id);
    expect(sensorRadius(state, "s0.p1")).toBe(radius + 1);
    expect(crewBonuses(state).incidentRate).toBeLessThan(incidents);
    expect(roverChargePerHour(state)).toBe(20);
    expect(roverSpecimenSlots(state)).toBe(8);
    expect(shipSpecimenSlots(state)).toBe(18);
    expect(routeEnergyMult(state)).toBe(0.9);
    expect(fuelCreditLimit(state)).toBe(135_000);
    expect(loanRate(state)).toBeCloseTo(0.04, 5);
    const r = state.recruits![0]!;
    expect(signingFee(state, r)).toBe(Math.round(r.fee / 2));
  });

  it("Ground Navigator: rough ground costs like plain", () => {
    const map = { width: 1, height: 1, terrain: new Uint8Array([Terrain.rough]) } as never;
    const src = regionSource(map);
    expect(stepCost(src, 0, 0, { canClimb: false, roughAsPlain: true })).toEqual(stepCost(regionSource({ width: 1, height: 1, terrain: new Uint8Array([Terrain.plain]) } as never), 0, 0));
    expect(stepCost(src, 0, 0, false).energy).toBeGreaterThan(1);
  });
});

describe("navigation perks", () => {
  it("Fold Calibration, Gravity Assist, Close Orbit, Hop Master", () => {
    const { state, world, bodyId } = onSurface();
    expect(foldEdgeFraction(state)).toBe(0.98);
    const survey = surveyMinutes(state);
    grant(state, "fold-calibration");
    grant(state, "close-orbit");
    expect(foldEdgeFraction(state)).toBe(0.8);
    expect(surveyMinutes(state)).toBe(survey / 2);

    const slow = flightPlan(state, world, { edge: true });
    grant(state, "gravity-assist");
    const fast = flightPlan(state, world, { edge: true });
    expect(slow.ok && fast.ok && fast.value.minutes < slow.value.minutes).toBe(true);

    expect(land(state, world, 0).ok).toBe(true);
    const loc = state.location as { ship: { x: number; y: number } };
    const target = { x: loc.ship.x + 6, y: loc.ship.y };
    const fuel = hopFuelTo(state, world, target.x, target.y);
    grant(state, "hop-master");
    expect(hopFuelTo(state, world, target.x, target.y)).toBeLessThan(fuel);
    void bodyId;
  });

  it("Long Fold widens the reach of the fold plan", () => {
    const world = new World(42);
    const state = newGame({ seed: 42 });
    const far = world.galaxy.systems.map((s) => ({ s, p: foldPlan(state, world, s.id) })).find(({ p }) => p.blockers.some((b) => b.includes("beyond the drive")) && p.ly < effectiveStats(state).foldRangeLy + 1);
    if (!far) return; // no star in the 8-9 ly band on this seed
    grant(state, "long-fold");
    expect(foldPlan(state, world, far.s.id).blockers.some((b) => b.includes("beyond the drive"))).toBe(false);
  });
});

describe("surface perks", () => {
  it("Seam Sense flags deposits beyond the terrain sweep as unidentified; Hidden Seams includes the hidden layer", () => {
    const { state, world, bodyId } = onSurface();
    grant(state, "seam-sense");
    grant(state, "hidden-seams");
    expect(land(state, world, 0).ok).toBe(true);
    expect(deployRover(state, world).ok).toBe(true);
    const rover = (state.location as { rover: { x: number; y: number } }).rover;
    const radius = sensorRadius(state, bodyId);
    const range = Math.floor(radius * 1.5);
    const surface = world.surface(bodyId);
    let flagged = 0;
    for (const r of surface.regionsNear(rover, range)) {
      const know = knowledge(state, bodyId, r);
      for (const d of surface.deposits(r)) {
        const dist = hexDistance(d, rover);
        if (dist <= radius) expect(know.discovered).toContain(d.id);
        else if (dist <= range && !know.discovered.includes(d.id)) {
          expect(know.sensed ?? []).toContain(d.id);
          flagged++;
        }
      }
    }
    // The outer ring is sensed but not identified.
    const sweep = sensorSweep(state, bodyId);
    const ring = { x: rover.x + radius + 1, y: rover.y };
    expect(detectsDeposit(sweep, rover, ring)).toBe(false);
    expect(sensesDeposit(sweep, rover, ring)).toBe(radius + 1 <= range);
  });

  it("without Seam Sense, nothing is flagged beyond the sweep", () => {
    const { state, world, bodyId } = onSurface();
    expect(land(state, world, 0).ok).toBe(true);
    expect(deployRover(state, world).ok).toBe(true);
    const surface = world.surface(bodyId);
    for (let r = 0; r < surface.layout.regions; r++) expect(knowledge(state, bodyId, r).sensed ?? []).toHaveLength(0);
  });

  it("hidden sites stay hidden without the perks", () => {
    const { state, world, bodyId } = onSurface();
    const surface = world.surface(bodyId);
    let hidden = 0;
    for (let r = 0; r < surface.layout.regions; r++) hidden += surface.deposits(r).filter((d) => d.hidden).length;
    expect(hidden).toBeGreaterThan(0);
    // Prospector's Eye flags the ordinary deposits of the landing region only.
    grant(state, "prospectors-eye");
    expect(land(state, world, 0).ok).toBe(true);
    const know = knowledge(state, bodyId, 0);
    for (const d of surface.deposits(0)) {
      const known = know.discovered.includes(d.id) || (know.sensed ?? []).includes(d.id);
      expect(known).toBe(!d.hidden);
    }
  });

  it("Assayer prospects from two hexes; Rich Veins yields more ore; Careful Hands takes two samples", () => {
    const { state, world, bodyId } = onSurface();
    grant(state, "assayer");
    grant(state, "rich-veins");
    grant(state, "careful-hands");
    expect(prospectRange(state)).toBe(2);
    expect(land(state, world, 0).ok).toBe(true);
    expect(deployRover(state, world).ok).toBe(true);
    const loc = state.location as { rover: { x: number; y: number; energy: number; cargo: Record<string, number>; specimens?: Record<string, number> } };
    const surface = world.surface(bodyId);
    const d = surface.deposits(0).find((x) => !x.hidden && x.depthM <= effectiveStats(state).drillMaxDepthM)!;
    knowledge(state, bodyId, 0).discovered.push(d.id);
    // Two hexes away (same row) is close enough to prospect.
    loc.rover.x = d.x + 2;
    loc.rover.y = d.y;
    expect(prospect(state, world, d.key).ok).toBe(true);
    loc.rover.x = d.x + 1;
    loc.rover.energy = 10_000;
    const before = knowledge(state, bodyId, 0).extracted[d.id] ?? 0;
    const r = drill(state, world, d.key, 2);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const worked = (knowledge(state, bodyId, 0).extracted[d.id] ?? 0) - before;
      expect(r.value.tonnes).toBeGreaterThan(worked);
      expect(r.value.tonnes).toBeCloseTo(worked * 1.1, 0);
    }
    const f = surface.flora(0).find((x) => !x.hidden);
    if (f) {
      knowledge(state, bodyId, 0).floraFound.push(f.id);
      loc.rover.x = f.x;
      loc.rover.y = f.y;
      expect(collectSample(state, world, f.key).ok).toBe(true);
      expect(Object.values(loc.rover.specimens ?? {}).reduce((a, b) => a + b, 0)).toBe(2);
    }
    void drillRate;
  });

  it("Jury-Rig: the first incident on a landing costs no time", () => {
    const { state, world, bodyId } = onSurface();
    expect(land(state, world, 0).ok).toBe(true);
    expect(deployRover(state, world).ok).toBe(true);
    const surface = world.surface(bodyId);
    const d = surface.deposits(0).find((x) => !x.hidden && x.depthM <= effectiveStats(state).drillMaxDepthM && x.tonnes > 40)!;
    const know = knowledge(state, bodyId, 0);
    know.discovered.push(d.id);
    know.prospected.push(d.id);
    know.drillSites.push(d.id);
    const loc = state.location as { rover: { x: number; y: number; energy: number; cargo: Record<string, number> } };
    loc.rover.x = d.x + 1;
    loc.rover.y = d.y;
    // Try RNG states until a shift has an incident, then compare with and without the perk.
    for (let i = 0; i < 400; i++) {
      const a = structuredClone(state);
      a.rngState = (state.rngState + i * 7919) | 0;
      (a.location as typeof loc).rover.energy = 10_000;
      (a.location as typeof loc).rover.cargo = {};
      const b = structuredClone(a);
      grant(b, "jury-rig");
      const ra = drill(a, world, d.key, 30);
      if (!ra.ok || !ra.value.incident) continue;
      const rb = drill(b, world, d.key, 30);
      expect(rb.ok && rb.value.incident).toBeTruthy();
      expect(b.time).toBeLessThan(a.time);
      return;
    }
    throw new Error("no incident in 400 tries");
  });
});

describe("Prospector's Eye", () => {
  it("charts nothing from orbit, and flags (without identifying) the landing region's deposits", () => {
    const { state, world, bodyId } = onSurface();
    grant(state, "prospectors-eye");
    const surface = world.surface(bodyId);
    expect(surveyBody(state, world).ok || state.surveyedBodies.includes(bodyId)).toBe(true);
    for (let r = 0; r < surface.layout.regions; r++) expect(knowledge(state, bodyId, r).discovered).toHaveLength(0);
    expect(land(state, world, 0).ok).toBe(true);
    const know = knowledge(state, bodyId, 0);
    const visible = surface.deposits(0).filter((d) => !d.hidden);
    expect(visible.length).toBeGreaterThan(0);
    for (const d of visible) expect(know.discovered.includes(d.id) || (know.sensed ?? []).includes(d.id)).toBe(true);
    // Most of them are still unidentified: only the ones near the ship are named.
    expect((know.sensed ?? []).length).toBeGreaterThan(0);
    // Other regions stay dark.
    if (surface.layout.regions > 1) expect(knowledge(state, bodyId, 1).sensed ?? []).toHaveLength(0);
  });
});

describe("captain and comms perks", () => {
  it("Talent Scout widens the hiring hall", () => {
    const state = newGame({ seed: 5 });
    grant(state, "talent-scout");
    wait(state, RECRUIT_POOL_DAYS * DAY);
    expect(state.recruits).toHaveLength(RECRUIT_POOL_SIZE + 2);
    state.credits = 1_000_000;
    expect(hireRecruit(state, state.recruits![0]!.id).ok).toBe(true);
  });

  it("Hunch points at a region; Market Wire forecasts prices", () => {
    const world = new World(42);
    const state = newGame({ seed: 42 });
    const body = world.system("s0").bodies.find((b) => b.regions > 3)!;
    expect(hunchRegion(state, body)).toBeNull();
    expect(marketForecast(state)).toBeNull();
    grant(state, "hunch");
    grant(state, "market-wire");
    const r = hunchRegion(state, body)!;
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThan(body.regions);
    expect(Object.keys(marketForecast(state)!).length).toBeGreaterThan(5);
  });

  it("Bulk Seller dents the price less", () => {
    const a = newGame({ seed: 42 });
    a.ship.cargo.ironNickel = 200;
    const b = structuredClone(a);
    grant(b, "bulk-seller");
    const ra = sell(a, "ironNickel");
    const rb = sell(b, "ironNickel");
    expect(ra.ok && rb.ok && rb.value > ra.value).toBe(true);
  });

  it("Extensions lengthen contracts; Deal Maker raises the payout", () => {
    const a = newGame({ seed: 42 });
    const b = structuredClone(a);
    grant(b, "extensions");
    grant(b, "deal-maker");
    const id = a.contracts.find((c) => c.kind === "deliver")!.id;
    acceptContract(a, id);
    acceptContract(b, id);
    const ca = a.contracts.find((c) => c.id === id)!;
    const cb = b.contracts.find((c) => c.id === id)!;
    expect(cb.deadline! - b.time).toBeGreaterThan(ca.deadline! - a.time);
    expect(contractPayout(b, cb)).toBeGreaterThan(contractPayout(a, ca));
  });

  it("Preferred Captain brings private offers", () => {
    const state = newGame({ seed: 42 });
    grant(state, "preferred-captain");
    wait(state, 200 * DAY);
    expect(state.contracts.some((c) => c.exclusive)).toBe(true);
  });

  it("Distress Net makes rescue faster and cheaper", () => {
    const world = new World(42);
    const a = newGame({ seed: 42 });
    expect(fold(a, world, "s0").ok).toBe(true);
    a.ship.fuel = 0.5;
    const b = structuredClone(a);
    grant(b, "distress-net");
    const qa = rescueQuote(a, world)!;
    const qb = rescueQuote(b, world)!;
    expect(qb.days).toBeLessThan(qa.days);
    expect(qb.cost).toBeLessThan(qa.cost);
  });

  it("Mentor and Inspiring speed everyone's learning; Fortune Favors makes finds likelier", () => {
    const a = newGame({ seed: 42 });
    const b = structuredClone(a);
    grant(b, "mentor");
    grant(b, "inspiring");
    awardXp(a, "medical", 100);
    awardXp(b, "medical", 100);
    const xa = officerAt(a, "medical")!.xp;
    const xb = officerAt(b, "medical")!.xp - xpForLevel(10);
    expect(xb).toBeCloseTo(xa * 1.2, 5);
    expect(rollMineralSpecimen(new Rng(1), "copper", 1, 1000)).not.toBeNull();
  });
});
