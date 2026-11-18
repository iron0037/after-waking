/**
 * Which sounds an action makes (AW-31): worked out from the game before and after it, so the rules in
 * src/sim stay silent. Pure, so it's tested without a browser.
 */
import { DAY, type GameState } from "../../sim";
import type { SoundId } from "./synth";

export interface SoundSnapshot {
  kind: GameState["location"]["kind"];
  systemId: string | null;
  orbiting: string | null;
  credits: number;
  levelUps: number;
  time: number;
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
  };
}

/**
 * The sounds for an action that went through: the move it made (a fold, a landing, docking), then a
 * level-up, a find, or money changing hands. At most two, so a busy action doesn't make a din.
 */
export function soundsFor(before: SoundSnapshot, after: SoundSnapshot, newJournalKinds: readonly string[]): SoundId[] {
  const out: SoundId[] = [];
  // Where the ship went.
  if (before.kind !== "intrepid" && after.kind === "intrepid") out.push("dock");
  else if (before.kind === "intrepid" && after.kind !== "intrepid") out.push("undock", "fold");
  else if (before.kind === "space" && after.kind === "surface") out.push("land");
  else if (before.kind === "surface" && after.kind === "space") out.push("liftoff");
  else if ((before.kind === "space" || before.kind === "deep") && (after.kind === "space" || after.kind === "deep") && (before.kind !== after.kind || before.systemId !== after.systemId))
    out.push("fold");
  // (Entering orbit sounds when the flight's animation arrives, not when the burn is planned: SystemView.)
  const moved = out.length > 0 || (after.kind === "space" && !!after.orbiting && after.orbiting !== before.orbiting);

  if (after.levelUps > before.levelUps) out.push("levelup");
  else if (!moved && newJournalKinds.includes("discovery")) out.push("discovery");
  else if (!moved && after.time - before.time < DAY) {
    // Money changing hands on the spot: a sale, a bounty, a purchase. (Days passing pay wages: no sound.)
    if (after.credits - before.credits >= 1) out.push("credits");
    else if (before.credits - after.credits >= 1) out.push("purchase");
  }
  return out.slice(0, 2);
}
