/**
 * Planets, moons and asteroids. Each star system's bodies are regenerated deterministically
 * from the galaxy seed. Orbits are real-scale (AU) so that inner worlds are short hops and the
 * outer system is a long haul.
 */
import type { SeaKind } from "../data/seas";
import { ORE_IDS, type CommodityId } from "../data/commodities";
import { moonSuffix, roman } from "../data/names";
import type { SpectralClass, StarSystem } from "./galaxy";
import { rngFor, type Rng } from "./rng";
import { clamp, DAY, type Vec2 } from "./units";

export type BodyKind =
  | "asteroid"
  | "barren"
  | "desert"
  | "terrestrial"
  | "ocean"
  | "ice"
  | "hothouse"
  | "volcanic"
  | "gasGiant"
  | "iceGiant";

export type SurfaceType = "solid" | "ice" | "liquid" | "none";
export type Chemistry = "inert" | "toxic" | "corrosive";

export interface Body {
  id: string;
  name: string;
  kind: BodyKind;
  /** Null for bodies orbiting the star directly. */
  parentId: string | null;
  /** Orbital radius in AU, around the star or around the parent body. */
  orbitAU: number;
  /** Orbital angle at t = 0, radians. */
  phase: number;
  periodDays: number;
  radiusEarth: number;
  gravityG: number;
  /** Surface pressure; gas and ice giants report Infinity (no surface). */
  pressureAtm: number;
  tempC: number;
  chemistry: Chemistry;
  /** 0 (none) .. 4 (lethal) */
  radiation: number;
  /** 0 (calm) .. 4 (superstorms) */
  weather: number;
  /** 0 (dead) .. 4 (violently volcanic) */
  tectonics: number;
  surface: SurfaceType;
  /** Number of explorable surface regions. Big worlds hold a career's worth. */
  regions: number;
  /** Relative abundance 0..~2 of each commodity across the body. */
  resources: Partial<Record<CommodityId, number>>;
  life: boolean;
  moonIds: string[];
  /** A calm home-system world tuned for new captains: shallow seams, mild hazards. */
  easy?: boolean;
  /** Its seas, if they aren't water (world generation 3, AW-189). */
  sea?: SeaKind;
  /** What the crews call it, e.g. "the Meadow". */
  nickname?: string;
}

export interface SystemDetail {
  system: StarSystem;
  bodies: Body[];
  /** Ships fold in at this radius: the orbit of the outermost planet. */
  edgeAU: number;
  frostLineAU: number;
}

export const KIND_LABEL: Record<BodyKind, string> = {
  asteroid: "Asteroid",
  barren: "Barren world",
  desert: "Desert world",
  terrestrial: "Terrestrial world",
  ocean: "Ocean world",
  ice: "Ice world",
  hothouse: "Hothouse world",
  volcanic: "Volcanic world",
  gasGiant: "Gas giant",
  iceGiant: "Ice giant",
};

/** Which commodities each kind of body tends to hold. */
const RESOURCE_WEIGHTS: Record<BodyKind, Partial<Record<CommodityId, number>>> = {
  asteroid: { ironNickel: 1, platinum: 0.35, rareEarths: 0.2, waterIce: 0.3, plicite: 0.07 },
  barren: { ironNickel: 0.8, copper: 0.4, titanium: 0.5, rareEarths: 0.2, platinum: 0.1, uranium: 0.2, plicite: 0.03 },
  desert: { ironNickel: 0.6, copper: 0.5, titanium: 0.35, rareEarths: 0.3, uranium: 0.3 },
  terrestrial: { ironNickel: 0.5, copper: 0.5, titanium: 0.3, rareEarths: 0.2, uranium: 0.2, waterIce: 0.15 },
  ocean: { waterIce: 0.4, rareEarths: 0.2, copper: 0.2 },
  ice: { waterIce: 1, ironNickel: 0.3, rareEarths: 0.1, plicite: 0.05 },
  hothouse: { titanium: 0.6, platinum: 0.4, rareEarths: 0.5, plicite: 0.1 },
  volcanic: { copper: 0.6, titanium: 0.4, platinum: 0.3, uranium: 0.4, rareEarths: 0.3, plicite: 0.09 },
  gasGiant: {},
  iceGiant: {},
};

const STAR_RADIATION: Record<StarSystem["spectral"], number> = { M: 1.5, K: 0.8, G: 1, F: 1.5, A: 2.2 };

interface Ctx {
  sys: StarSystem;
  rng: Rng;
  bodies: Body[];
  /** World generation (see WORLD_GEN_LATEST). */
  gen?: number;
}

/**
 * World generations. Saves remember which one built their universe, so a new generator never
 * reshuffles a game in progress. 1: the original (rocky inside the frost line, giants outside,
 * everywhere). 2: architectures drawn from what the exoplanet surveys found (AW-145).
 */
export const WORLD_GEN_LATEST = 3;

export function generateSystem(galaxySeed: number, sys: StarSystem, gen = 1): SystemDetail {
  if (gen >= 2) return generateSystemV2(galaxySeed, sys, gen);
  const ctx: Ctx = { sys, rng: rngFor(galaxySeed, "system", sys.id), bodies: [] };
  const { rng } = ctx;
  const frost = 2.7 * Math.sqrt(sys.luminosity);
  const slots = sys.spectral === "M" ? rng.int(2, 6) : rng.int(3, 9);

  let a = Math.max(0.05, rng.range(0.25, 0.6) * Math.sqrt(sys.luminosity));
  let planetNumber = 0;
  let beltDone = false;
  let outerCount = 0;

  for (let slot = 0; slot < slots; slot++) {
    const outer = a >= frost;
    if (!beltDone && slot > 0 && rng.chance(outer ? 0.25 : 0.12)) {
      beltDone = true;
      addBelt(ctx, a);
    } else {
      planetNumber++;
      const id = `${sys.id}.p${planetNumber}`;
      const name = `${sys.name} ${roman(planetNumber)}`;
      const planet = outer ? makeOuterPlanet(ctx, id, name, a, outerCount++ === 0) : makeInnerPlanet(ctx, id, name, a);
      ctx.bodies.push(planet);
      addMoons(ctx, planet);
    }
    a *= rng.range(1.45, 2.1);
  }

  if (sys.home) makeHomely(ctx, galaxySeed, 1);
  const outermost = Math.max(...ctx.bodies.filter((b) => b.parentId === null).map((b) => b.orbitAU));
  return { system: sys, bodies: ctx.bodies, edgeAU: Math.max(1.5, outermost * 1.05), frostLineAU: frost };
}

function equilibriumK(sys: StarSystem, a: number): number {
  return 278 * Math.pow(sys.luminosity, 0.25) / Math.sqrt(a) * 0.93;
}

function greenhouseK(pressureAtm: number): number {
  return pressureAtm > 0 ? 30 * Math.pow(pressureAtm, 0.45) : 0;
}

function orbitalPeriodDays(sys: StarSystem, a: number): number {
  return 365.25 * Math.sqrt((a * a * a) / sys.mass);
}

function makeInnerPlanet(ctx: Ctx, id: string, name: string, a: number, radiusOverride?: number): Body {
  const { rng, sys } = ctx;
  const rolled = 0.25 + Math.pow(rng.next(), 1.5) * 1.6;
  const radius = radiusOverride ?? rolled;
  const gravity = radius * rng.range(0.8, 1.15);
  const teq = equilibriumK(sys, a);

  let pressure: number;
  if (radius < 0.45) pressure = rng.chance(0.15) ? rng.range(0.001, 0.05) : 0;
  else {
    const roll = rng.next();
    pressure = roll < 0.25 ? rng.range(0, 0.02) : roll < 0.75 ? rng.range(0.1, 3) : rng.range(5, 95);
  }
  if (teq > 500 && radius < 1) pressure *= 0.1; // stripped by the star
  const tempC = teq + greenhouseK(pressure) - 273;

  let kind: BodyKind;
  if (pressure >= 5 && tempC > 150) kind = "hothouse";
  else if (rng.chance(0.1 + (teq > 400 ? 0.1 : 0))) kind = "volcanic";
  else if (pressure < 0.02) kind = tempC < -120 && rng.chance(0.4) ? "ice" : "barren";
  else if (tempC > -5 && tempC < 90 && pressure >= 0.3) kind = rng.chance(0.4) ? "ocean" : "terrestrial";
  else if (tempC < -40) kind = "ice";
  else kind = "desert";

  return finishBody(ctx, {
    id,
    name,
    kind,
    parentId: null,
    orbitAU: a,
    periodDays: orbitalPeriodDays(sys, a),
    radiusEarth: radius,
    gravityG: gravity,
    pressureAtm: pressure,
    tempC,
  });
}

function makeOuterPlanet(ctx: Ctx, id: string, name: string, a: number, firstOuter: boolean): Body {
  const { rng, sys } = ctx;
  const teq = equilibriumK(sys, a);
  const kind: BodyKind = firstOuter && rng.chance(0.7)
    ? "gasGiant"
    : rng.weighted([["gasGiant", 40], ["iceGiant", 30], ["ice", 30]] as const);

  if (kind === "ice") {
    const radius = rng.range(0.25, 1.4);
    const pressure = radius > 0.4 && rng.chance(0.3) ? rng.range(0.3, 1.6) : 0;
    return finishBody(ctx, {
      id,
      name,
      kind,
      parentId: null,
      orbitAU: a,
      periodDays: orbitalPeriodDays(sys, a),
      radiusEarth: radius,
      gravityG: radius * rng.range(0.6, 0.9),
      pressureAtm: pressure,
      tempC: teq + greenhouseK(pressure) - 273,
    });
  }

  const giant = kind === "gasGiant";
  return finishBody(ctx, {
    id,
    name,
    kind,
    parentId: null,
    orbitAU: a,
    periodDays: orbitalPeriodDays(sys, a),
    radiusEarth: giant ? rng.range(6, 12) : rng.range(3, 5),
    gravityG: giant ? rng.range(1.0, 2.8) : rng.range(0.9, 1.3),
    pressureAtm: Infinity,
    tempC: teq - 273,
  });
}

function addBelt(ctx: Ctx, a: number): void {
  const { rng, sys } = ctx;
  const count = rng.int(1, 3);
  const greek = ["α", "β", "γ"];
  for (let i = 0; i < count; i++) {
    const radius = rng.range(0.01, 0.06);
    ctx.bodies.push(
      finishBody(ctx, {
        id: `${sys.id}.b${i + 1}`,
        name: `${sys.name} Belt ${greek[i]}`,
        kind: "asteroid",
        parentId: null,
        orbitAU: a * rng.range(0.95, 1.05),
        periodDays: orbitalPeriodDays(sys, a),
        radiusEarth: radius,
        gravityG: radius * 0.6,
        pressureAtm: 0,
        tempC: equilibriumK(sys, a) - 273,
      }),
    );
  }
}

function addMoons(ctx: Ctx, parent: Body): void {
  const { rng } = ctx;
  let count = 0;
  if (parent.kind === "gasGiant") count = rng.int(1, 5);
  else if (parent.kind === "iceGiant") count = rng.int(1, 3);
  else if (parent.radiusEarth > 0.8 && rng.chance(0.4)) count = 1;

  const outer = parent.kind === "gasGiant" || parent.kind === "iceGiant" || parent.kind === "ice";
  for (let i = 0; i < count; i++) {
    const radius = parent.kind === "gasGiant" && rng.chance(0.2) ? rng.range(0.4, 0.9) : rng.range(0.08, 0.45);
    const kind: BodyKind = outer ? rng.weighted([["ice", 60], ["barren", 30], ["volcanic", 10]] as const) : "barren";
    const pressure = radius > 0.35 && rng.chance(0.12) ? rng.range(0.4, 1.6) : 0;
    const baseK = parent.tempC + 273;
    const moon = finishBody(ctx, {
      id: `${parent.id}.m${i + 1}`,
      name: `${parent.name}-${moonSuffix(i)}`,
      kind,
      parentId: parent.id,
      orbitAU: parent.kind === "gasGiant" ? rng.range(0.0015, 0.02) : rng.range(0.0008, 0.004),
      periodDays: rng.range(1.2, 40),
      radiusEarth: radius,
      gravityG: radius * rng.range(0.55, 0.95),
      pressureAtm: pressure,
      tempC: baseK + greenhouseK(pressure) - 273 + (kind === "volcanic" ? 40 : 0),
    });
    parent.moonIds.push(moon.id);
    ctx.bodies.push(moon);
  }
}

type BodyCore = Pick<
  Body,
  "id" | "name" | "kind" | "parentId" | "orbitAU" | "periodDays" | "radiusEarth" | "gravityG" | "pressureAtm" | "tempC"
>;

/** Fill in environment details, resources and regions from the physical basics. */
function finishBody(ctx: Ctx, core: BodyCore): Body {
  const { rng, sys } = ctx;
  const giant = core.kind === "gasGiant" || core.kind === "iceGiant";
  const p = giant ? 0 : core.pressureAtm;

  let chemistry: Chemistry = "inert";
  if (core.kind === "hothouse") chemistry = rng.chance(0.7) ? "corrosive" : "toxic";
  else if (core.kind === "volcanic") chemistry = rng.weighted([["toxic", 60], ["corrosive", 20], ["inert", 20]] as const);
  else if (p > 0.1) chemistry = rng.weighted([["inert", 62], ["toxic", 30], ["corrosive", 8]] as const);

  const parentIsGiant = core.parentId !== null && ctx.bodies.some((b) => b.id === core.parentId && (b.kind === "gasGiant" || b.kind === "iceGiant"));
  const starAU = core.parentId === null ? core.orbitAU : ctx.bodies.find((b) => b.id === core.parentId)?.orbitAU ?? 1;
  const radiation = clamp(
    Math.round(
      // Generation 2 measures distance against the star's habitable zone, so a red dwarf's close-in
      // worlds aren't all lethal just for being a few hundredths of an AU out.
      STAR_RADIATION[sys.spectral] / Math.sqrt(Math.max(0.05, (ctx.gen ?? 1) >= 2 ? starAU / Math.sqrt(sys.luminosity) : starAU)) -
        Math.log10(1 + p) * 1.2 +
        (parentIsGiant ? 1.5 : 0) +
        rng.range(-0.4, 0.4),
    ),
    0,
    4,
  );
  const weather = giant ? 4 : p > 0 ? clamp(Math.round(Math.log10(1 + p) * 1.5 + rng.range(0, 1.5)), 0, 4) : 0;
  const tectonics =
    core.kind === "volcanic" ? 4 : core.kind === "asteroid" || giant ? 0 : rng.int(0, core.kind === "ice" ? 1 : 2);

  const surface: SurfaceType = giant ? "none" : core.kind === "ocean" ? "liquid" : core.kind === "ice" ? "ice" : "solid";
  const regions = core.kind === "asteroid" ? rng.int(1, 3) : giant ? 0 : clamp(Math.round(40 * core.radiusEarth ** 2), 4, 160);

  const resources: Partial<Record<CommodityId, number>> = {};
  const weights = RESOURCE_WEIGHTS[core.kind];
  const bonanza = rng.chance(0.1) ? rng.pick(ORE_IDS) : null;
  for (const id of ORE_IDS) {
    const w = weights[id] ?? 0;
    if (w <= 0) continue;
    let abundance = w * rng.range(0.3, 1.4) * (id === bonanza ? 2 : 1);
    if (abundance >= 0.08) resources[id] = Math.round(abundance * 100) / 100;
  }

  const life =
    ((core.kind === "terrestrial" || core.kind === "ocean") && core.tempC > -20 && core.tempC < 60 && rng.chance(0.6)) ||
    (core.kind === "ice" && p > 0.5 && rng.chance(0.1));

  return {
    ...core,
    phase: rng.range(0, Math.PI * 2),
    chemistry,
    radiation,
    weather,
    tectonics,
    surface,
    regions,
    resources,
    life,
    moonIds: [],
  };
}

const HOME_ORES: readonly CommodityId[] = ["ironNickel", "copper", "titanium", "rareEarths"];

/**
 * Home systems were the first scouts' proving ground. Tame two or three worlds into calm,
 * landable mining grounds, and in the nearest home system, raise a garden world.
 */
function makeHomely(ctx: Ctx, galaxySeed: number, gen: number): void {
  const { rng, sys } = ctx;
  const solid = ctx.bodies.filter((b) => b.surface === "solid" || b.surface === "ice");
  // Prefer bodies that are already mild; moons and small worlds are easy to tame.
  const score = (b: Body) => Math.abs(b.gravityG - 0.5) + Math.max(0, b.radiation - 1) + (b.kind === "hothouse" ? 3 : 0);
  const picks = [...solid].sort((a, b) => score(a) - score(b)).slice(0, 3);
  // Generation 2 promises three easy worlds per home system (new captains learn the trade there).
  while (picks.length < (gen >= 2 ? 3 : 2)) {
    const n = ctx.bodies.filter((b) => b.parentId === null).length + 1;
    // Generation 2 sets the extra world near the star's habitable zone (1 AU is frozen dark around a red dwarf).
    const a = gen >= 2 ? Math.sqrt(sys.luminosity) * rng.range(0.9, 1.4) : Math.max(0.4, Math.sqrt(sys.luminosity)) * rng.range(0.9, 1.4);
    const extra = finishBody(ctx, {
      id: `${sys.id}.p${n}`,
      name: `${sys.name} ${roman(n)}`,
      kind: "barren",
      parentId: null,
      orbitAU: a,
      periodDays: orbitalPeriodDays(sys, a),
      radiusEarth: 0.5,
      gravityG: 0.45,
      pressureAtm: 0,
      tempC: equilibriumK(sys, a) - 273,
    });
    ctx.bodies.push(extra);
    picks.push(extra);
  }

  for (const b of picks) {
    if (b.kind === "hothouse" || b.kind === "volcanic") b.kind = b.tempC < -40 ? "ice" : "barren";
    b.gravityG = Math.min(b.gravityG, 1.1);
    b.pressureAtm = Math.min(b.pressureAtm, 1.2);
    b.tempC = clamp(b.tempC, -140, 90);
    b.chemistry = "inert";
    b.radiation = Math.min(b.radiation, 1);
    b.weather = Math.min(b.weather, 1);
    b.tectonics = Math.min(b.tectonics, 1);
    b.regions = Math.max(b.regions, 6);
    b.easy = true;
    for (const id of HOME_ORES) {
      if ((b.resources[id] ?? 0) < 0.35 && rng.chance(0.75)) b.resources[id] = Math.round(rng.range(0.35, 0.8) * 100) / 100;
    }
  }

  // The nearest home system holds the Meadow: a small living world the Lyceum studies.
  const first = ctx.sys.id === "s0";
  if (first) {
    // Generation 2: the Meadow is a real planet (never a belt asteroid), the one nearest a mild climate.
    const garden =
      gen >= 2
        ? ([...picks].filter((b) => b.parentId === null && b.kind !== "asteroid").sort((x, y) => Math.abs(x.tempC - 15) - Math.abs(y.tempC - 15))[0] ??
          picks.find((b) => b.parentId === null) ??
          (picks[0] as Body))
        : (picks.find((b) => b.parentId === null) ?? (picks[0] as Body));
    garden.kind = "terrestrial";
    garden.surface = "solid";
    garden.radiusEarth = 0.8;
    garden.gravityG = 0.82;
    garden.pressureAtm = 0.9;
    garden.tempC = rngFor(galaxySeed, "meadow").range(8, 22);
    garden.radiation = 0;
    garden.weather = 1;
    garden.tectonics = 1;
    garden.life = true;
    garden.regions = 26;
    garden.nickname = "the Meadow";
  }
}

export function findBody(detail: SystemDetail, id: string): Body {
  const b = detail.bodies.find((body) => body.id === id);
  if (!b) throw new Error(`Unknown body ${id}`);
  return b;
}

/** Position in AU relative to the star at game time t. Moons ride along with their parent. */
export function bodyPosition(detail: SystemDetail, body: Body, t: number): Vec2 {
  const angle = body.phase + (2 * Math.PI * (t / DAY)) / body.periodDays;
  const local = { x: Math.cos(angle) * body.orbitAU, y: Math.sin(angle) * body.orbitAU };
  if (body.parentId === null) return local;
  const parent = bodyPosition(detail, findBody(detail, body.parentId), t);
  return { x: parent.x + local.x, y: parent.y + local.y };
}


// --- generation 2: realistic architectures (AW-145) -------------------------------------------
//
// Kepler, K2 and radial-velocity surveys found that our Solar System's layout is one pattern among
// several. Small planets (super-Earths and sub-Neptunes) are the most common, mostly well inside
// 1 AU, often in compact "peas in a pod" systems of similar, evenly spaced worlds. Red dwarfs host
// several small planets each but rarely giants. Hot Jupiters are rare (~1% of Sun-like stars; a
// little more common here, for variety). Giants are likelier around heavier, brighter stars.

export type Architecture = "compact" | "solar" | "hotJupiter" | "warmJupiter" | "sparse" | "giants";

const ARCHITECTURES: Record<SpectralClass, readonly (readonly [Architecture, number])[]> = {
  M: [["compact", 60], ["sparse", 25], ["solar", 10], ["warmJupiter", 5]],
  K: [["compact", 40], ["solar", 32], ["sparse", 14], ["warmJupiter", 9], ["hotJupiter", 5]],
  G: [["compact", 33], ["solar", 38], ["sparse", 13], ["warmJupiter", 10], ["hotJupiter", 6]],
  F: [["solar", 40], ["compact", 22], ["warmJupiter", 15], ["hotJupiter", 8], ["sparse", 10], ["giants", 5]],
  A: [["solar", 40], ["giants", 35], ["sparse", 20], ["hotJupiter", 5]],
};

type Slot = { a: number; type: "rock" | "superEarth" | "miniNeptune" | "giant" | "outer" | "belt" };

/** Which architecture a system has (for the system panel and tests). */
export function systemArchitecture(galaxySeed: number, sys: StarSystem): Architecture {
  return rngFor(galaxySeed, "system2-arch", sys.id).weighted(ARCHITECTURES[sys.spectral]);
}

function generateSystemV2(galaxySeed: number, sys: StarSystem, gen = 2): SystemDetail {
  const ctx: Ctx = { sys, rng: rngFor(galaxySeed, "system2", sys.id), bodies: [], gen };
  const { rng } = ctx;
  // Around a star of luminosity L, a world gets Earth's sunlight at sqrt(L) AU; the frost line sits ~2.7x out.
  const hz = Math.sqrt(sys.luminosity);
  const frost = 2.7 * hz;
  // Home systems are the first scouts' gentle proving grounds: solar-like, with room for easy worlds.
  const arch: Architecture = sys.home ? "solar" : systemArchitecture(galaxySeed, sys);
  const slots: Slot[] = [];
  const small = (): Slot["type"] => rng.weighted([["rock", 40], ["superEarth", 35], ["miniNeptune", 25]] as const);

  switch (arch) {
    case "compact": {
      // Peas in a pod: similar sizes, regular spacing, tucked in close.
      const base = small();
      let a = hz * rng.range(0.12, 0.3);
      for (let i = rng.int(3, 7); i > 0; i--) {
        slots.push({ a, type: rng.chance(0.75) ? base : small() });
        a *= rng.range(1.3, 1.75);
      }
      if (rng.chance(sys.spectral === "M" ? 0.05 : 0.25)) slots.push({ a: frost * rng.range(1.2, 2.5), type: "giant" });
      if (rng.chance(0.15)) slots.push({ a: a * rng.range(1.5, 3), type: "belt" });
      break;
    }
    case "solar": {
      let a = hz * rng.range(0.3, 0.6);
      let belt = false;
      for (let i = rng.int(3, sys.spectral === "M" ? 5 : 8); i > 0; i--) {
        if (!belt && slots.length > 0 && rng.chance(a >= frost ? 0.25 : 0.12)) {
          belt = true;
          slots.push({ a, type: "belt" });
        } else slots.push({ a, type: a >= frost ? "outer" : rng.chance(0.8) ? "rock" : "superEarth" });
        a *= rng.range(1.45, 2.1);
      }
      break;
    }
    case "hotJupiter": {
      slots.push({ a: hz * rng.range(0.04, 0.09), type: "giant" });
      let a = frost * rng.range(1, 1.8);
      for (let i = rng.int(0, 2); i > 0; i--) {
        slots.push({ a, type: "outer" });
        a *= rng.range(1.5, 2.2);
      }
      if (rng.chance(0.2)) slots.push({ a: a * rng.range(1.2, 1.8), type: "belt" });
      break;
    }
    case "warmJupiter": {
      const g = hz * rng.range(0.4, 1.5);
      slots.push({ a: g, type: "giant" });
      if (g > hz * 0.6 && rng.chance(0.6)) slots.push({ a: hz * rng.range(0.15, 0.35), type: small() });
      let a = Math.max(g * rng.range(1.8, 2.5), frost);
      for (let i = rng.int(0, 2); i > 0; i--) {
        slots.push({ a, type: "outer" });
        a *= rng.range(1.5, 2.2);
      }
      break;
    }
    case "sparse": {
      let a = hz * rng.range(0.3, 1);
      for (let i = rng.int(1, 3); i > 0; i--) {
        slots.push({ a, type: a >= frost ? "outer" : rng.weighted([["rock", 35], ["superEarth", 30], ["miniNeptune", 25], ["giant", 10]] as const) });
        a *= rng.range(1.8, 3.5);
      }
      break;
    }
    case "giants": {
      if (rng.chance(0.3)) slots.push({ a: hz * rng.range(0.3, 0.7), type: "rock" });
      let a = frost * rng.range(0.8, 1.2);
      for (let i = rng.int(2, 4); i > 0; i--) {
        slots.push({ a, type: rng.chance(0.65) ? "giant" : "outer" });
        a *= rng.range(1.6, 2.4);
      }
      if (rng.chance(0.3)) slots.push({ a: a * rng.range(1.1, 1.5), type: "belt" });
      break;
    }
  }

  slots.sort((x, y) => x.a - y.a);
  let planetNumber = 0;
  let outerCount = 0;
  let beltDone = false;
  for (const slot of slots) {
    const a = Math.max(0.012, slot.a);
    if (slot.type === "belt") {
      if (beltDone) continue;
      beltDone = true;
      addBelt(ctx, a);
      continue;
    }
    planetNumber++;
    const id = `${sys.id}.p${planetNumber}`;
    const name = `${sys.name} ${roman(planetNumber)}`;
    let planet: Body;
    switch (slot.type) {
      case "rock":
        planet = makeInnerPlanet(ctx, id, name, a, rng.range(0.3, 1.25));
        break;
      case "superEarth":
        planet = makeInnerPlanet(ctx, id, name, a, rng.range(1.25, 1.9));
        break;
      case "miniNeptune":
        planet = makeMiniGiant(ctx, id, name, a, "iceGiant", rng.range(2, 3.8));
        break;
      case "giant":
        // Hot Jupiters are puffed up by their star.
        planet = makeMiniGiant(ctx, id, name, a, "gasGiant", a < hz * 0.15 ? rng.range(10, 15) : rng.range(6, 12));
        break;
      case "outer":
        planet = makeOuterPlanet(ctx, id, name, a, outerCount++ === 0);
        break;
    }
    ctx.bodies.push(planet);
    addMoons(ctx, planet);
  }

  if (sys.home) makeHomely(ctx, galaxySeed, 2);
  // Number the planets in order from the star (home-system extras are appended at the end).
  const planets = ctx.bodies.filter((b) => b.parentId === null && b.kind !== "asteroid").sort((x, y) => x.orbitAU - y.orbitAU);
  planets.forEach((p, i) => {
    p.name = `${sys.name} ${roman(i + 1)}`;
    p.moonIds.forEach((mid, j) => {
      const moon = ctx.bodies.find((b) => b.id === mid);
      if (moon) moon.name = `${p.name}-${moonSuffix(j)}`;
    });
  });
  const outermost = Math.max(...ctx.bodies.filter((b) => b.parentId === null).map((b) => b.orbitAU));
  // The fold limit hugs the outermost world: compact red-dwarf systems are tiny.
  if (gen >= 3) addExoticSeas(galaxySeed, ctx.bodies);
  return { system: sys, bodies: ctx.bodies, edgeAU: Math.max(outermost * 1.5, hz * 0.8, 0.06), frostLineAU: frost };
}

/** A gas giant or mini-Neptune at any distance (hot ones included). */
function makeMiniGiant(ctx: Ctx, id: string, name: string, a: number, kind: "gasGiant" | "iceGiant", radius: number): Body {
  const { rng, sys } = ctx;
  return finishBody(ctx, {
    id,
    name,
    kind,
    parentId: null,
    orbitAU: a,
    periodDays: orbitalPeriodDays(sys, a),
    radiusEarth: radius,
    gravityG: kind === "gasGiant" ? rng.range(1.0, 2.8) : rng.range(0.8, 1.25),
    pressureAtm: Infinity,
    tempC: equilibriumK(sys, a) - 273,
  });
}

/**
 * What a world's seas are made of, if not water (world generation 3, AW-189): methane and ethane on
 * very cold worlds with air, ammonia on cold ones, sulfuric acid on hot corrosive ones. Water worlds,
 * volcanic worlds (lava), asteroids and the home systems' easy worlds keep what they had.
 */
export function exoticSea(b: Body): SeaKind | undefined {
  if (b.surface === "none" || b.easy) return undefined;
  if (b.kind === "ocean" || b.kind === "terrestrial" || b.kind === "volcanic" || b.kind === "asteroid") return undefined;
  const p = b.pressureAtm;
  const t = b.tempC;
  if (p >= 0.3 && t > -186 && t <= -150) return "methane";
  if (p >= 0.3 && t > -100 && t <= -35) return "ammonia";
  if (b.chemistry === "corrosive" && p >= 1 && t >= 100 && t <= 330) return "acid";
  return undefined;
}

/**
 * Generation 3's pass over a finished system: give worlds their exotic seas. It reads the bodies and
 * draws only from its own streams, so every body, orbit and deposit stays where generation 2 put it.
 * Some methane seas hold life.
 */
function addExoticSeas(galaxySeed: number, bodies: Body[]): void {
  for (const b of bodies) {
    const sea = exoticSea(b);
    if (!sea) continue;
    b.sea = sea;
    if (sea === "methane" && !b.life && rngFor(galaxySeed, b.id, "exo-life").chance(0.5)) b.life = true;
  }
}
