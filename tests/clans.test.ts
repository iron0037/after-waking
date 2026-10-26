import { describe, expect, it } from "vitest";
import { CAPTAIN_CLANS } from "../src/data/clans";
import { UPGRADES_BY_ID } from "../src/data/ship";
import {
  bodyNickname,
  buyUpgrade,
  clanMods,
  dailyUpkeep,
  effectiveStats,
  fuelPriceFor,
  helmStatus,
  loanRate,
  newGame,
  officerAt,
  levelForXp,
  setNickname,
  stationLevel,
  World,
} from "../src/sim";

describe("starting clan (AW-146)", () => {
  it("every clan has a perk and a cost", () => {
    for (const c of Object.values(CAPTAIN_CLANS)) {
      expect(c.perk.length).toBeGreaterThan(10);
      expect(c.cost.length).toBeGreaterThan(10);
      expect(Object.keys(c.mods).length).toBeGreaterThan(0);
    }
  });

  it("no clan means no changes, and the name never carries the title", () => {
    const s = newGame({ seed: 3, captainName: "Captain Vasquez" });
    expect(s.captain.name).toBe("Vasquez");
    expect(s.captain.clan).toBeUndefined();
    expect(clanMods(s).loanRate).toBe(1);
  });

  it("Exchange: cheaper note and fuel", () => {
    const plain = newGame({ seed: 3 });
    const ex = newGame({ seed: 3, clan: "exchange" });
    expect(loanRate(ex)).toBeCloseTo(loanRate(plain) / 2);
    expect(fuelPriceFor(ex)).toBeLessThan(fuelPriceFor(plain));
  });

  it("Midshipmen: own gear 10% off, a seasoned engineer, pricier upkeep", () => {
    const s = newGame({ seed: 3, clan: "midshipmen" });
    expect(levelForXp(officerAt(s, "engineering")!.xp)).toBeGreaterThanOrEqual(3);
    expect(officerAt(s, "engineering")!.clan).toBe("midshipmen");
    s.credits = 100_000;
    const coil = UPGRADES_BY_ID.get("auxTanks")!;
    expect(coil.vendor).toBe("midshipmen");
    const before = s.credits;
    expect(buyUpgrade(s, "auxTanks").ok).toBe(true);
    expect(before - s.credits).toBeLessThan(coil.price);
    s.ship.upgrades.push("auxTanks");
    const plain = newGame({ seed: 3 });
    plain.ship.upgrades.push("auxTanks");
    expect(dailyUpkeep(s)).toBeGreaterThan(dailyUpkeep(plain));
  });

  it("Lyceum: researchers' berths cost hold space; Freebooters: more credits, no Helm fund", () => {
    expect(effectiveStats(newGame({ seed: 3, clan: "lyceum" })).cargoCapacityT).toBe(effectiveStats(newGame({ seed: 3 })).cargoCapacityT - 10);
    const fb = newGame({ seed: 3, clan: "freebooters" });
    expect(fb.credits).toBe(newGame({ seed: 3 }).credits + 3_000);
    expect(helmStatus(fb).eligible).toBe(false);
  });

  it("Helm: three more stars' worlds come scanned", () => {
    const plain = newGame({ seed: 3 });
    const helm = newGame({ seed: 3, clan: "helm" });
    expect(helm.scannedBodies.length).toBeGreaterThan(plain.scannedBodies.length);
    expect(stationLevel(helm, "captain")).toBe(1);
  });
});

describe("world nicknames (AW-147)", () => {
  it("name a world, clear it, and the scouts' name returns", () => {
    const state = newGame({ seed: 5 });
    const world = new World(5);
    const meadow = world.system("s0").bodies.find((b) => b.nickname)!;
    expect(bodyNickname(state, meadow)).toBe("the Meadow");
    expect(setNickname(state, meadow.id, "  Grandma's   Garden ").ok).toBe(true);
    expect(bodyNickname(state, meadow)).toBe("Grandma's Garden");
    expect(setNickname(state, meadow.id, "x".repeat(40)).ok).toBe(false);
    expect(setNickname(state, meadow.id, "").ok).toBe(true);
    expect(bodyNickname(state, meadow)).toBe("the Meadow");
  });
});
