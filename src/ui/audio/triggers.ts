/**
 * Which sounds an action makes (AW-31, AW-281): worked out from the game before and after it, so the
 * rules in src/sim stay silent. Pure, so it's tested without a browser.
 */
import { DAY, incidentKindOf, playerSide, type EncounterOutcome, type GameState } from "../../sim";
import type { SoundId } from "./synth";

export interface SurfaceSnapshot {
  bodyId: string;
  shipX: number;
  shipY: number;
  rover: { vehicle: "rover" | "boat"; x: number; y: number; energy: number } | null;
  /** Deposits and plant sites found on this world so far, and tonnes drilled out of it. */
  deposits: number;
  flora: number;
  extracted: number;
  /** Seams prospected, plant sites sampled, and specimens riding in the vehicle's cases (AW-285). */
  prospected?: number;
  sampled?: number;
  specimens?: number;
}

/** A fight with raiders in progress (AW-286): both ships' state, to hear what a turn did. */
export interface CombatSnapshot {
  stage: "contact" | "hail" | "battle" | "prize";
  range: number;
  myHull: number;
  /** Worst damage to any of our systems (0-100). */
  myWorst: number;
  myShields: number;
  myLaser: boolean;
  myKinetic: boolean;
  theirHull: number;
  theirArmed: boolean;
}

/** The last creature fight (AW-285): a new id means one just happened. */
export interface FightSnapshot {
  id: number;
  mode: "defend" | "capture";
  outcome: "captured" | "down" | "escaped" | "broke off" | "disabled";
}

export interface SoundSnapshot {
  kind: GameState["location"]["kind"];
  systemId: string | null;
  orbiting: string | null;
  credits: number;
  levelUps: number;
  time: number;
  fuel?: number;
  scanned?: number;
  surveyed?: number;
  probing?: boolean;
  encounter?: boolean;
  surface?: SurfaceSnapshot | null;
  fight?: FightSnapshot | null;
  combat?: CombatSnapshot | null;
  /** How the last encounter ended (AW-286). */
  lastOutcome?: EncounterOutcome | null;
}

function combatSnapshot(state: GameState): CombatSnapshot | null {
  const e = state.encounter;
  if (!e) return null;
  const me = playerSide(state);
  return {
    stage: e.stage,
    range: e.range,
    myHull: me.hull,
    myWorst: Math.max(...Object.values(me.damage)),
    myShields: me.shields,
    myLaser: me.laser > 0 && me.damage.weapons < 100,
    myKinetic: me.kinetic > 0 && me.damage.weapons < 100,
    theirHull: e.enemy.hull,
    theirArmed: e.enemy.damage.weapons < 100 && e.enemy.laser + e.enemy.kinetic > 0,
  };
}

/**
 * A raider fight (AW-286): one turn's maneuver, both sides' fire and what it hit, alarms; or how it ended.
 * `lines` are the turn's new log lines (they say whether our guns fired: "Your guns hit" / "Your shots go wide").
 */
export function combatSoundsFor(before: SoundSnapshot, after: SoundSnapshot, lines: readonly string[]): SoundId[] {
  const b = before.combat;
  const a = after.combat;
  if (!b) return [];
  if (!a) {
    // It's over.
    const end = after.lastOutcome;
    if (end === "escaped" || end === "slipped past") return ["escape"];
    if (end === "surrendered" || end === "overwhelmed") return ["defeat"];
    if (end === "talked off" || end === "driven off") return ["talked"];
    if (end === "paid") return ["purchase"];
    return [];
  }
  const out: SoundId[] = [];
  if (a.stage === "prize" && b.stage !== "prize") return ["victory"];
  if (a.stage !== "battle" || b.stage !== "battle") return out;
  if (a.range !== b.range || lines.some((l) => l.startsWith("Range "))) out.push("thrusters");
  const fired = lines.some((l) => l.startsWith("Your guns hit") || l.startsWith("Your shots go wide"));
  if (fired && b.myLaser) out.push("laser");
  if (fired && b.myKinetic) out.push("kinetic");
  if (a.theirHull < b.theirHull - 0.01) out.push("hitThem");
  if (b.theirArmed) {
    out.push("enemyFire");
    if (a.myHull < b.myHull - 0.01 || lines.some((l) => l.startsWith("They hit you"))) out.push("hullHit");
    else out.push(b.myShields > 0 ? "shieldHit" : "nearMiss");
  }
  // A system knocked past half, or out entirely.
  if ((b.myWorst < 50 && a.myWorst >= 50) || (b.myWorst < 100 && a.myWorst >= 100)) out.push("alarm");
  return out;
}

/** When each combat sound lands in a turn: the maneuver, our guns, their fire, the hits, then any alarm. */
const COMBAT_AT: Partial<Record<SoundId, number>> = {
  thrusters: 0,
  laser: 0.2,
  kinetic: 0.3,
  hitThem: 0.75,
  enemyFire: 1.0,
  hullHit: 1.35,
  shieldHit: 1.35,
  nearMiss: 1.3,
  alarm: 1.8,
};

function surfaceSnapshot(state: GameState): SurfaceSnapshot | null {
  const loc = state.location;
  if (loc.kind !== "surface") return null;
  let deposits = 0;
  let flora = 0;
  let extracted = 0;
  let prospected = 0;
  let sampled = 0;
  const prefix = `${loc.bodyId}#`;
  for (const [key, k] of Object.entries(state.regions)) {
    if (!key.startsWith(prefix)) continue;
    deposits += k.discovered.length;
    flora += k.floraFound?.length ?? 0;
    prospected += k.prospected.length;
    sampled += k.floraSampled?.length ?? 0;
    for (const t of Object.values(k.extracted)) extracted += t;
  }
  const r = loc.rover;
  return {
    bodyId: loc.bodyId,
    shipX: loc.ship?.x ?? -1,
    shipY: loc.ship?.y ?? -1,
    rover: r ? { vehicle: r.vehicle ?? "rover", x: r.x, y: r.y, energy: r.energy } : null,
    deposits,
    flora,
    extracted,
    prospected,
    sampled,
    specimens: r ? Object.values(r.specimens ?? {}).reduce((a, b) => a + b, 0) : 0,
  };
}

export function soundSnapshot(state: GameState): SoundSnapshot {
  const loc = state.location;
  return {
    kind: loc.kind,
    systemId: loc.kind === "space" || loc.kind === "surface" ? loc.systemId : null,
    orbiting: loc.kind === "space" ? loc.orbiting : null,
    credits: state.credits,
    levelUps: state.levelUps?.length ?? 0,
    time: state.time,
    fuel: state.ship.fuel,
    scanned: state.scannedBodies.length,
    surveyed: state.surveyedBodies?.length ?? 0,
    probing: !!state.probeDive,
    encounter: !!state.encounter,
    surface: surfaceSnapshot(state),
    fight: state.lastFight ? { id: state.lastFight.id, mode: state.lastFight.mode, outcome: state.lastFight.outcome } : null,
    combat: combatSnapshot(state),
    lastOutcome: state.encounter ? null : (state.lastEncounter?.outcome ?? null),
  };
}

/**
 * The sounds for an action: the move it made (a fold, a landing, a hop), what the crew did (refuel,
 * launch the rover, drill), what turned up (call-outs, at most one of each), then a level-up, a find,
 * or money changing hands if nothing else spoke. At most three, so a busy action doesn't make a din.
 */
export function soundsFor(before: SoundSnapshot, after: SoundSnapshot, newJournalKinds: readonly string[], newJournalTexts: readonly string[] = []): SoundId[] {
  const out: SoundId[] = [];
  // Trouble first: a raider's hail.
  if (after.encounter && !before.encounter) out.push("danger");

  // Where the ship went.
  if (before.kind !== "intrepid" && after.kind === "intrepid") out.push("dock");
  else if (before.kind === "intrepid" && after.kind !== "intrepid") out.push("undock", "fold");
  else if (before.kind === "space" && after.kind === "surface") out.push("land");
  else if (before.kind === "surface" && after.kind === "space") out.push("liftoff");
  else if ((before.kind === "space" || before.kind === "deep") && (after.kind === "space" || after.kind === "deep") && (before.kind !== after.kind || before.systemId !== after.systemId))
    out.push("fold");
  // (Entering orbit sounds when the flight's animation arrives, not when the burn is planned: SystemView.)
  let moved = out.length > 0 || (after.kind === "space" && !!after.orbiting && after.orbiting !== before.orbiting);

  // On the ground.
  const bs = before.surface;
  const as = after.surface;
  if (bs && as && bs.bodyId === as.bodyId) {
    if (bs.shipX !== as.shipX || bs.shipY !== as.shipY) {
      out.push("hop");
      moved = true;
    }
    const br = bs.rover;
    const ar = as.rover;
    if (!br && ar) out.push(...(ar.vehicle === "boat" ? (["bayOpen", "splash"] as const) : (["bayOpen"] as const)));
    else if (br && !ar) out.push("bayClose");
    else if (br && ar) {
      if (br.vehicle === "rover" && ar.vehicle === "boat") out.push("splash");
      else if (br.x === ar.x && br.y === ar.y && ar.energy - br.energy > 0.5) out.push("recharge");
    }
    if (as.extracted - bs.extracted > 0.001) out.push("drill");
    // Trouble at the drill site: a storm, a quake, a jammed head.
    const incident = newJournalTexts.map(incidentKindOf).find((k) => k !== null);
    if (incident) out.push(incident);
    if ((as.prospected ?? 0) > (bs.prospected ?? 0)) out.push("prospect");
    // A creature fight: the prod, then the net if it went down, or the crunch if the rover took it.
    const fought = after.fight && after.fight.id !== before.fight?.id ? after.fight : null;
    if (fought) {
      if (fought.outcome === "disabled") out.push("roverHit");
      else out.push(...(fought.mode === "capture" && (fought.outcome === "captured" || fought.outcome === "down") ? (["stun", "net"] as const) : (["stun"] as const)));
    } else if ((as.sampled ?? 0) > (bs.sampled ?? 0) || (as.specimens ?? 0) > (bs.specimens ?? 0)) out.push("sample");
    // The call-outs: one per kind, however many turned up on the drive.
    if (as.deposits > bs.deposits) out.push("mineral");
    if (as.flora > bs.flora) out.push("lifeform");
  }

  // Aboard and in orbit.
  if ((after.fuel ?? 0) - (before.fuel ?? 0) >= 0.5 && !moved) out.push("refuel");
  if ((after.scanned ?? 0) > (before.scanned ?? 0)) out.push("scan");
  if ((after.surveyed ?? 0) > (before.surveyed ?? 0)) out.push("survey");
  if (after.probing && !before.probing) out.push("probe");

  const spoke = out.length > 0;
  if (after.levelUps > before.levelUps) out.push("levelup");
  else if (!spoke && !moved && newJournalKinds.includes("discovery")) out.push("discovery");
  else if (!spoke && !moved && after.time - before.time < DAY) {
    // Money changing hands on the spot: a sale, a bounty, a purchase. (Days passing pay wages: no sound.)
    if (after.credits - before.credits >= 1) out.push("credits");
    else if (before.credits - after.credits >= 1) out.push("purchase");
  }
  return out.slice(0, 3);
}

/** When each sound starts, in seconds: sounds that would talk over each other wait their turn. */
export function soundSchedule(ids: readonly SoundId[]): { id: SoundId; delay: number }[] {
  // A battle turn plays out in order (AW-286).
  if (ids.some((id) => id in COMBAT_AT)) return ids.map((id) => ({ id, delay: COMBAT_AT[id] ?? 0 }));
  const LONG: Partial<Record<SoundId, number>> = { bayOpen: 1.6, hop: 2.4, mineral: 1.7, land: 1.5, stun: 0.5, drill: 2.0 };
  let at = 0;
  return ids.map((id, i) => {
    const prev = ids[i - 1];
    // Voices, a splash after the bay, the net after the prod, and trouble after the drill wait their turn; the rest layer.
    const waits: SoundId[] = ["mineral", "lifeform", "splash", "net", "storm", "quake", "breakdown"];
    if (prev && waits.includes(id)) at += LONG[prev] ?? 0.4;
    return { id, delay: at };
  });
}
