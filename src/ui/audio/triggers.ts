/**
 * Which sounds an action makes (AW-31, AW-281): worked out from the game before and after it, so the
 * rules in src/sim stay silent. Pure, so it's tested without a browser.
 */
import { DAY, type GameState } from "../../sim";
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
}

function surfaceSnapshot(state: GameState): SurfaceSnapshot | null {
  const loc = state.location;
  if (loc.kind !== "surface") return null;
  let deposits = 0;
  let flora = 0;
  let extracted = 0;
  const prefix = `${loc.bodyId}#`;
  for (const [key, k] of Object.entries(state.regions)) {
    if (!key.startsWith(prefix)) continue;
    deposits += k.discovered.length;
    flora += k.floraFound?.length ?? 0;
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
  };
}

/**
 * The sounds for an action: the move it made (a fold, a landing, a hop), what the crew did (refuel,
 * launch the rover, drill), what turned up (call-outs, at most one of each), then a level-up, a find,
 * or money changing hands if nothing else spoke. At most three, so a busy action doesn't make a din.
 */
export function soundsFor(before: SoundSnapshot, after: SoundSnapshot, newJournalKinds: readonly string[]): SoundId[] {
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
  const LONG: Partial<Record<SoundId, number>> = { bayOpen: 1.6, hop: 2.4, mineral: 1.7, land: 1.5 };
  let at = 0;
  return ids.map((id, i) => {
    const prev = ids[i - 1];
    // Voices, a splash after the bay, and the recharge wait for what came before; the rest layer.
    if (prev && (id === "mineral" || id === "lifeform" || id === "splash")) at += LONG[prev] ?? 0.4;
    return { id, delay: at };
  });
}
