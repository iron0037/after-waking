/** AW-205: new-game settings, fixed for the career. */
import { describe, expect, it } from "vitest";
import {
  awardXp,
  baseSeed,
  changeRep,
  DEFAULT_UNIVERSE,
  deserialize,
  interdictionChance,
  newGame,
  officerAt,
  regionDeposits,
  regionFlora,
  reputation,
  sentimentOnDocked,
  serialize,
  tickSentiment,
  universeOf,
  universeSeed,
  World,
  type GameState,
  type UniverseSettings,
  systemsNeeded,
  requirementProgress,
} from "../src/sim";
import { DAY } from "../src/sim/units";

function totals(u: UniverseSettings) {
  const seed = universeSeed(42, u);
  const w = new World(seed);
  let deposits = 0;
  let flora = 0;
  let living = 0;
  for (const sys of w.galaxy.systems.slice(0, 16)) {
    for (const b of w.system(sys.id).bodies) {
      if (b.life) living++;
      for (let r = 0; r < Math.min(b.regions, 6); r++) {
        deposits += regionDeposits(seed, b, r).reduce((n, d) => n + d.tonnes, 0);
        flora += regionFlora(seed, b, r).length;
      }
    }
  }
  return { deposits, flora, living, stars: w.galaxy.systems.length, charted: w.galaxy.systems.filter((s) => s.charted).length };
}

describe("universe settings (AW-205)", () => {
  it("pack into the seed, and all-normal leaves the seed alone", () => {
    expect(universeSeed(42, DEFAULT_UNIVERSE)).toBe(42);
    const u: UniverseSettings = { stars: 30, ore: "plentiful", life: "scarce", hostile: "none" };
    const seed = universeSeed(42, u);
    expect(seed).toBeGreaterThan(2 ** 32);
    expect(universeOf(seed)).toEqual({ ...u, outposts: 3 }); // left out, outposts take the default (AW-23)
    expect(baseSeed(seed)).toBe(42);
    expect(universeOf(42)).toEqual(DEFAULT_UNIVERSE);
    // The game state carries the packed seed, so every World built from it agrees.
    const state = newGame({ seed: 42, universe: u });
    expect(state.seed).toBe(seed);
  });

  it("star count sets the galaxy's size and its charted share", () => {
    for (const stars of [16, 22, 30, 40] as const) {
      const t = totals({ ...DEFAULT_UNIVERSE, stars });
      expect(t.stars).toBe(stars);
      expect(t.charted).toBe({ 16: 9, 22: 12, 30: 15, 40: 18 }[stars]);
    }
    // The same base seed starts from the same nearest star.
    const a = new World(42).galaxy.systems[0]!;
    const b = new World(universeSeed(42, { ...DEFAULT_UNIVERSE, ore: "scarce" })).galaxy.systems[0]!;
    expect(b.pos).toEqual(a.pos);
  });

  it("ore and life abundance change what the worlds hold", () => {
    const scarce = totals({ ...DEFAULT_UNIVERSE, ore: "scarce", life: "scarce" });
    const normal = totals(DEFAULT_UNIVERSE);
    const plenty = totals({ ...DEFAULT_UNIVERSE, ore: "plentiful", life: "plentiful" });
    expect(scarce.deposits).toBeLessThan(normal.deposits * 0.8);
    expect(plenty.deposits).toBeGreaterThan(normal.deposits * 1.3);
    expect(scarce.flora).toBeLessThan(normal.flora);
    expect(plenty.flora).toBeGreaterThan(normal.flora);
    expect(scarce.living).toBeLessThanOrEqual(normal.living);
    expect(plenty.living).toBeGreaterThanOrEqual(normal.living);
  });
});

describe("people settings (AW-205)", () => {
  const game = (people: Partial<GameState["settings"]> = {}) => newGame({ seed: 42, people: people as never });

  it("new games default to Normal; old saves keep the steadier legacy crew", () => {
    const state = game();
    expect(state.settings?.reliability).toBe("normal");
    expect(state.settings?.turnover).toBe(true);
    const old = JSON.parse(serialize(state)) as GameState;
    delete old.settings;
    expect(deserialize(JSON.stringify(old)).settings?.reliability).toBe("unwavering");
  });

  it("leveling rate scales experience", () => {
    const xp = (crewXp: "slow" | "normal" | "fast") => {
      const s = game({ crewXp });
      const m = officerAt(s, "engineering")!;
      m.xp = 0;
      awardXp(s, "engineering", 100);
      return m.xp;
    };
    expect(xp("slow")).toBeLessThan(xp("normal"));
    expect(xp("fast")).toBeGreaterThan(xp("normal") * 1.5);
  });

  it("clan trust growth scales goodwill gains, not losses", () => {
    const gain = (clanTrust: "slow" | "fast") => {
      const s = game({ clanTrust });
      const before = reputation(s, "diggers");
      changeRep(s, "diggers", 10, "test", false);
      return reputation(s, "diggers") - before;
    };
    expect(gain("fast")).toBeGreaterThan(gain("slow") * 2);
    const loss = (clanTrust: "slow" | "fast") => {
      const s = game({ clanTrust });
      const before = reputation(s, "diggers");
      changeRep(s, "diggers", -10, "test", false);
      return reputation(s, "diggers") - before;
    };
    expect(loss("fast")).toBeCloseTo(loss("slow"));
  });

  it("pirate frequency scales the raid chance", () => {
    const world = new World(42);
    const sys = world.galaxy.systems.find((s) => s.charted && !s.home)!;
    const chance = (pirates: "rare" | "normal" | "frequent") => {
      const s = game({ pirates });
      s.ship.cargo = { platinum: 20 };
      return interdictionChance(s, world, sys.id);
    };
    expect(chance("normal")).toBeGreaterThan(0);
    expect(chance("rare")).toBeCloseTo(chance("normal") * 0.4);
    expect(chance("frequent")).toBeCloseTo(chance("normal") * 1.7);
  });

  it("reliability: a long haul sours a Limited crew far more than an Unwavering one", () => {
    const after = (reliability: "limited" | "unwavering") => {
      const s = game({ reliability });
      s.location = { kind: "deep", pos: { x: 5, y: 5 } };
      s.lastDockedAt = s.time;
      for (let d = 0; d < 150; d++) {
        s.time += DAY;
        tickSentiment(s, DAY);
      }
      return officerAt(s, "science")!.happiness!;
    };
    expect(after("limited")).toBeLessThan(after("unwavering") - 15);
  });

  it("with turnover off, nobody gives notice", () => {
    for (const turnover of [true, false]) {
      const s = game({ turnover });
      for (const m of s.crew!) {
        m.happiness = 5;
        m.loyalty = 5;
      }
      sentimentOnDocked(s, null);
      const notices = s.crew!.filter((m) => m.noticeAt !== undefined).length;
      expect(notices > 0).toBe(turnover);
    }
  });
});

describe("research scales with the Verge (AW-222)", () => {
  it("'visit N systems' follows the star count, leaving two to spare", () => {
    const at = (stars: 16 | 22 | 30 | 40) => ({ seed: universeSeed(42, { ...DEFAULT_UNIVERSE, stars }) });
    expect(systemsNeeded(at(22), 20)).toBe(20);
    expect(systemsNeeded(at(16), 20)).toBe(14);
    expect(systemsNeeded(at(30), 20)).toBe(27);
    expect(systemsNeeded(at(40), 20)).toBe(36);
    expect(systemsNeeded(at(16), 6)).toBe(4);
    const s = newGame({ seed: 42, universe: { ...DEFAULT_UNIVERSE, stars: 16 } });
    expect(requirementProgress(s, { kind: "systems", count: 20 }).need).toBe(14);
  });
});
