/** AW-31 phase 1: which sound an action makes, from the game before and after it. */
import { describe, expect, it } from "vitest";
import {
  answerHail,
  autoExplore,
  combatTurn,
  maybeInterdict,
  buyFuel,
  DAY,
  INCIDENT_TEXT,
  deployRover,
  flyTo,
  land,
  landingBlockers,
  newGame,
  rechargeRover,
  stowRover,
  World,
  type GameState,
  type Result,
} from "../src/sim";
import { ambienceFor } from "../src/ui/audio/ambience";
import { combatSoundsFor, soundSchedule, soundSnapshot, soundsFor, type CombatSnapshot, type SoundSnapshot, type SurfaceSnapshot } from "../src/ui/audio/triggers";

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

  it("on the ground: the bay, the boat, a hop, recharge, drilling, call-outs (AW-281)", () => {
    const ground: SurfaceSnapshot = { bodyId: "b", shipX: 5, shipY: 5, rover: null, deposits: 2, flora: 1, extracted: 0 };
    const on = (patch: Partial<SurfaceSnapshot>): SoundSnapshot => snap({ kind: "surface", surface: { ...ground, ...patch } });
    const rover = { vehicle: "rover" as const, x: 5, y: 6, energy: 10 };
    const boat = { ...rover, vehicle: "boat" as const };
    expect(soundsFor(on({}), on({ rover }), [])).toEqual(["bayOpen"]);
    expect(soundsFor(on({}), on({ rover: boat }), [])).toEqual(["bayOpen", "splash"]);
    expect(soundsFor(on({ rover }), on({}), [])).toEqual(["bayClose"]);
    expect(soundsFor(on({ rover }), on({ rover: boat }), [])).toEqual(["splash"]);
    expect(soundsFor(on({}), on({ shipX: 9 }), [])).toEqual(["hop"]);
    expect(soundsFor(on({ rover }), on({ rover: { ...rover, energy: 30 } }), [])).toEqual(["recharge"]);
    expect(soundsFor(on({ rover }), on({ rover, extracted: 4 }), [])).toEqual(["drill"]);
    // A drive that turns up three deposits and two plants: one call-out of each, the words in turn.
    const drove = soundsFor(on({ rover }), on({ rover: { ...rover, x: 9, energy: 6 }, deposits: 5, flora: 3 }), ["discovery"]);
    expect(drove).toEqual(["mineral", "lifeform"]);
    expect(soundSchedule(drove).map((s) => s.delay)).toEqual([0, 1.7]);
  });

  it("aboard and in orbit: fuel, scans, surveys, probes, a raider's hail (AW-281)", () => {
    expect(soundsFor(snap({ fuel: 10 }), snap({ fuel: 40, credits: 500 }), [])).toEqual(["refuel"]);
    expect(soundsFor(snap({ scanned: 1 }), snap({ scanned: 2 }), ["discovery"])).toEqual(["scan"]);
    expect(soundsFor(snap({ surveyed: 0 }), snap({ surveyed: 1 }), [])).toEqual(["survey"]);
    expect(soundsFor(snap({}), snap({ probing: true }), [])).toEqual(["probe"]);
    expect(soundsFor(snap({}), snap({ encounter: true }), [])).toEqual(["danger"]);
  });

  it("real actions make the right sounds (AW-281)", () => {
    const world = new World(42);
    const run = (s: GameState, fn: (s: GameState) => Result<unknown>) => {
      const before = soundSnapshot(s);
      const j = s.journal.length;
      const r = fn(s);
      if (!r.ok) throw new Error(r.reason);
      return soundsFor(before, soundSnapshot(s), s.journal.slice(j).map((e) => e.kind));
    };
    const home = newGame({ seed: 42 });
    home.ship.fuel = 5;
    home.credits = 100_000;
    expect(run(home, (s) => buyFuel(s, 20))).toEqual(["refuel"]);

    for (const sys of world.galaxy.systems.filter((x) => !x.home)) {
      const detail = world.system(sys.id);
      for (const body of detail.bodies.filter((b) => b.regions > 0 && (b.kind === "barren" || b.kind === "desert" || b.kind === "terrestrial"))) {
        const s = newGame({ seed: 42 });
        s.location = { kind: "space", systemId: sys.id, pos: { x: detail.edgeAU, y: 0 }, orbiting: null };
        s.ship.fuel = 60;
        if (!flyTo(s, world, { bodyId: body.id }).ok) continue;
        const region = Array.from({ length: Math.min(body.regions, 20) }, (_, r) => r).find((r) => landingBlockers(s, world, r).length === 0);
        if (region === undefined) continue;
        expect(run(s, (x) => land(x, world, region))[0]).toBe("land");
        expect(run(s, (x) => deployRover(x, world))).toEqual(["bayOpen"]);
        const swept = run(s, (x) => autoExplore(x, world));
        expect(swept).toContain("mineral");
        expect(swept.filter((id) => id === "mineral")).toHaveLength(1);
        const loc = s.location as unknown as Extract<GameState["location"], { kind: "surface" }>;
        loc.rover!.energy = 5;
        expect(run(s, (x) => rechargeRover(x, world))).toEqual(["recharge"]);
        expect(run(s, (x) => stowRover(x, world))[0]).toBe("bayClose");
        return;
      }
    }
    throw new Error("nowhere to land");
  });

  it("the rest of the surface: prospecting, samples, fights, drill trouble (AW-285)", () => {
    const ground: SurfaceSnapshot = { bodyId: "b", shipX: 5, shipY: 5, rover: { vehicle: "rover", x: 5, y: 6, energy: 50 }, deposits: 2, flora: 1, extracted: 0, prospected: 0, sampled: 0, specimens: 0 };
    const on = (patch: Partial<SurfaceSnapshot>, more: Partial<SoundSnapshot> = {}): SoundSnapshot => snap({ kind: "surface", surface: { ...ground, ...patch }, ...more });
    expect(soundsFor(on({}), on({ prospected: 1 }), [])).toEqual(["prospect"]);
    expect(soundsFor(on({}), on({ sampled: 1, specimens: 2 }), [])).toEqual(["sample"]);
    const fight = (id: number, mode: "defend" | "capture", outcome: "captured" | "down" | "escaped" | "broke off" | "disabled") => ({ fight: { id, mode, outcome } });
    expect(soundsFor(on({}), on({ specimens: 1 }, fight(1, "capture", "captured")), [])).toEqual(["stun", "net"]);
    expect(soundsFor(on({}), on({}, fight(1, "defend", "escaped")), [])).toEqual(["stun"]);
    expect(soundsFor(on({}, fight(1, "defend", "down")), on({}, fight(2, "defend", "disabled")), [])).toEqual(["roverHit"]);
    // An old fight doesn't sound again.
    expect(soundsFor(on({}, fight(3, "capture", "down")), on({}, fight(3, "capture", "down")), [])).toEqual([]);
    const stormy = soundsFor(on({}), on({ extracted: 3 }), ["info", "warning"], ["Drilled 3 t of copper.", `${INCIDENT_TEXT.storm} Lost 12h.`]);
    expect(stormy).toEqual(["drill", "storm"]);
    expect(soundSchedule(stormy).map((x) => x.delay)).toEqual([0, 2]);
    expect(soundsFor(on({}), on({ extracted: 1 }), [], [INCIDENT_TEXT.quake])).toEqual(["drill", "quake"]);
  });

  it("each world gets its own background (AW-285)", () => {
    expect(ambienceFor({ kind: "desert", pressureAtm: 0.6 })).toEqual(["desert"]);
    expect(ambienceFor({ kind: "barren", pressureAtm: 0 })).toEqual(["vacuum"]);
    expect(ambienceFor({ kind: "ice", pressureAtm: 1.4, sea: "methane" })).toEqual(["ice", "surf"]);
    expect(ambienceFor({ kind: "ocean", pressureAtm: 1 })).toEqual(["ocean"]);
  });

  it("a battle turn: maneuver, our guns, their fire, hits, alarms; and how it ends (AW-286)", () => {
    const c: CombatSnapshot = { stage: "battle", range: 1, myHull: 100, myWorst: 0, myShields: 10, myLaser: true, myKinetic: false, theirHull: 80, theirArmed: true };
    const at = (patch: Partial<CombatSnapshot>, more: Partial<SoundSnapshot> = {}): SoundSnapshot => snap({ encounter: true, combat: { ...c, ...patch }, ...more });
    const turn = combatSoundsFor(at({}), at({ range: 0, theirHull: 70, myHull: 90 }), ["Range medium to close.", "Your guns hit for 10.", "They hit you for 10."]);
    expect(turn).toEqual(["thrusters", "laser", "hitThem", "enemyFire", "hullHit"]);
    expect(soundSchedule(turn).map((x) => x.delay)).toEqual([0, 0.2, 0.75, 1.0, 1.35]);
    // Their fire soaked by the shields; ours wide; a system knocked out.
    expect(combatSoundsFor(at({}), at({ myWorst: 100 }), ["Your shots go wide.", "Their fire misses."])).toEqual(["laser", "enemyFire", "shieldHit", "alarm"]);
    expect(combatSoundsFor(at({ myShields: 0 }), at({ myShields: 0 }), ["Their fire misses."])).toEqual(["enemyFire", "nearMiss"]);
    // Endings.
    expect(combatSoundsFor(at({}), at({ stage: "prize" }), [])).toEqual(["victory"]);
    const over = (o: SoundSnapshot["lastOutcome"]) => combatSoundsFor(at({}), snap({ combat: null, lastOutcome: o }), []);
    expect(over("escaped")).toEqual(["escape"]);
    expect(over("overwhelmed")).toEqual(["defeat"]);
    expect(over("talked off")).toEqual(["talked"]);
    expect(over("paid")).toEqual(["purchase"]);
  });

  it("a real raider fight makes battle sounds (AW-286)", () => {
    const world = new World(42);
    for (let i = 0; i < 200; i++) {
      const sys = world.galaxy.systems.find((x) => !x.home && !x.charted)!;
      const s = newGame({ seed: 42 });
      s.location = { kind: "space", systemId: sys.id, pos: { x: 40, y: 0 }, orbiting: null };
      s.ship.cargo = { platinum: 40, copper: 60 };
      s.rngState = (42 * 7919 + i) >>> 0;
      if (!maybeInterdict(s, world, sys.id)) continue;
      expect(soundSnapshot(s).encounter).toBe(true);
      answerHail(s, "fight");
      const heard = new Set<string>();
      for (let t = 0; t < 25 && s.encounter?.stage === "battle"; t++) {
        const b = soundSnapshot(s);
        const n = s.encounter.log.length;
        combatTurn(s, { helm: "close", guns: "hull", engineering: "guns", comms: "quiet" });
        const lines = s.encounter ? s.encounter.log.slice(n) : [];
        for (const id of combatSoundsFor(b, soundSnapshot(s), lines)) heard.add(id);
      }
      expect(heard.has("enemyFire")).toBe(true);
      expect([...heard].some((id) => id === "laser" || id === "kinetic")).toBe(true);
      expect([...heard].some((id) => ["victory", "defeat", "talked", "escape"].includes(id))).toBe(true);
      return;
    }
    throw new Error("no raider in 200 departures");
  });
});
