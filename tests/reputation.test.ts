/** AW-22: clan relations. */
import { describe, expect, it } from "vitest";
import { UPGRADES_BY_ID } from "../src/data/ship";
import {
  acceptContract,
  advanceTime,
  buyUpgrade,
  changeRep,
  clanRefuses,
  clanStandings,
  completeContract,
  contractPayout,
  DAY,
  newGame,
  reputation,
  tierOf,
  upgradePriceFor,
  YEAR,
  type Contract,
  type GameState,
} from "../src/sim";

function job(state: GameState, clan: Contract["clan"], reward = 5_000): Contract {
  const c: Contract = { id: `t-${clan}`, clan, kind: "deliver", title: "Test job", text: "", reward, durationDays: 100, deadline: null, status: "offered", commodity: "copper", tonnes: 1 };
  state.contracts.push(c);
  return c;
}

describe("clan relations", () => {
  it("starts neutral, friendly with your own clan, and cool with the law for a Freebooter", () => {
    const plain = newGame({ seed: 1 });
    expect(tierOf(plain, "helm")).toBe("neutral");
    const lyc = newGame({ seed: 1, clan: "lyceum" });
    expect(tierOf(lyc, "lyceum")).toBe("friendly");
    const fb = newGame({ seed: 1, clan: "freebooters" });
    expect(tierOf(fb, "helm")).toBe("cool");
    expect(tierOf(fb, "exchange")).toBe("cool");
  });

  it("ripples to allies and rivals", () => {
    const s = newGame({ seed: 1 });
    changeRep(s, "helm", 20, "test");
    expect(reputation(s, "helm")).toBe(20);
    expect(reputation(s, "midshipmen")).toBeGreaterThan(0);
    expect(reputation(s, "freebooters")).toBeLessThan(0);
    expect(reputation(s, "diggers")).toBe(0);
    expect(clanStandings(s).find((c) => c.clan === "helm")!.rivals).toContain("freebooters");
  });

  it("delivering contracts builds standing, and friends pay more", () => {
    const s = newGame({ seed: 1 });
    s.ship.cargo = { copper: 50 };
    const c = job(s, "diggers");
    const neutralPay = contractPayout(s, c);
    acceptContract(s, c.id);
    expect(completeContract(s, c.id).ok).toBe(true);
    expect(reputation(s, "diggers")).toBeGreaterThan(5);
    changeRep(s, "diggers", 30, "test");
    expect(tierOf(s, "diggers")).toBe("friendly");
    expect(contractPayout(s, job(s, "diggers"))).toBeGreaterThan(neutralPay);
  });

  it("a lapsed contract costs standing", () => {
    const s = newGame({ seed: 1 });
    const c = job(s, "exchange");
    acceptContract(s, c.id);
    advanceTime(s, 120 * DAY);
    expect(c.status).toBe("failed");
    expect(reputation(s, "exchange")).toBeLessThan(0);
  });

  it("a hostile clan won't sell, and gear is cheaper from friends", () => {
    const s = newGame({ seed: 1 });
    s.credits = 1_000_000;
    const gear = [...UPGRADES_BY_ID.values()].find((u) => u.vendor === "diggers" && !u.requires)!;
    const base = upgradePriceFor(s, "diggers", gear.price);
    changeRep(s, "diggers", 60, "test");
    expect(upgradePriceFor(s, "diggers", gear.price)).toBeLessThan(base);
    changeRep(s, "diggers", -130, "test");
    expect(clanRefuses(s, "diggers")).toBe(true);
    expect(buyUpgrade(s, gear.id).ok).toBe(false);
  });

  it("extreme standings drift back toward where they started", () => {
    const s = newGame({ seed: 1 });
    changeRep(s, "helm", -60, "test", false);
    advanceTime(s, 3 * YEAR);
    expect(reputation(s, "helm")).toBeGreaterThan(-60);
    expect(reputation(s, "helm")).toBeLessThan(0);
  });
});
