/**
 * The Archive as first-run guidance (AW-24): each entry shows once, the first time its subject comes
 * up. Some triggers are read from the state here; screens raise the rest (what's on screen). The
 * entries themselves live in src/data/archive.ts.
 */
import { ARCHIVE, ARCHIVE_BY_ID, type ArchiveEntry, type ArchiveTrigger } from "../data/archive";
import { fail, ok, type Result } from "./result";
import { cargoTonnes } from "./ship";
import { crewFreePoints, effectiveStats } from "./perks";
import type { GameState } from "./state";
import { DAY } from "./units";

/** Is the Archive speaking? On unless the captain has silenced it. */
export function guidanceOn(state: GameState): boolean {
  return state.guidance !== false;
}

/** Triggers that hold in the current state (screens add their own). */
export function archiveStateTriggers(state: GameState): ArchiveTrigger[] {
  const out: ArchiveTrigger[] = ["start"];
  const loc = state.location;
  if (loc.kind === "intrepid") out.push("intrepid");
  if (loc.kind === "space") {
    out.push("system");
    if (loc.orbiting) out.push("orbit");
    if (loc.orbiting && state.scannedBodies.includes(loc.orbiting)) out.push("orbit-scanned");
  }
  if (loc.kind === "surface") out.push("surface");
  const stats = effectiveStats(state);
  if (cargoTonnes(state.ship.cargo) >= stats.cargoCapacityT * 0.9) out.push("hold-full");
  if (state.ship.fuel < stats.fuelCapacity * 0.2 && loc.kind !== "intrepid") out.push("fuel-low");
  if (state.encounter) out.push("raider");
  const d = state.ship.damage;
  if (d && d.hull + d.drives + d.weapons + d.sensors > 0) out.push("damage");
  if (Object.values(state.ship.specimens ?? {}).some((n) => n > 0)) out.push("specimens");
  if (state.loan.balance > 0 && state.loan.nextDue - state.time < 30 * DAY) out.push("loan-due");
  if (crewFreePoints(state) > 0) out.push("perk-points");
  return out;
}

/** The next entry due, given what's on screen: the first unread one whose trigger holds. */
export function archiveNext(state: GameState, screen: readonly ArchiveTrigger[] = []): ArchiveEntry | null {
  if (!guidanceOn(state)) return null;
  const active = new Set<ArchiveTrigger>([...archiveStateTriggers(state), ...screen]);
  const seen = new Set(state.archiveSeen ?? []);
  return ARCHIVE.find((e) => active.has(e.trigger) && !seen.has(e.id)) ?? null;
}

/** Mark an entry read. */
export function dismissArchive(state: GameState, id: string): Result<ArchiveEntry> {
  const entry = ARCHIVE_BY_ID.get(id);
  if (!entry) return fail("No such Archive entry.");
  state.archiveSeen ??= [];
  if (!state.archiveSeen.includes(id)) state.archiveSeen.push(id);
  return ok(entry);
}

/** Silence the Archive, or let it speak again. */
export function setGuidance(state: GameState, on: boolean): Result<boolean> {
  state.guidance = on;
  return ok(on);
}

/** Start over: every entry shows again as its subject comes up. */
export function resetArchive(state: GameState): Result<number> {
  const n = (state.archiveSeen ?? []).length;
  state.archiveSeen = [];
  state.guidance = true;
  return ok(n);
}

/** Entries read so far, in Archive order, for re-reading in the Journal. */
export function archiveRead(state: GameState): ArchiveEntry[] {
  const seen = new Set(state.archiveSeen ?? []);
  return ARCHIVE.filter((e) => seen.has(e.id));
}

/**
 * How far along the Awaken path the captain is (M5). Nothing advances it yet; once something does,
 * the Archive's help starts to read strangely.
 */
export function awakening(state: GameState): number {
  return state.awakening ?? 0;
}

/** What an entry says to this captain: its usual text, or the strange one on the Awaken path. */
export function archiveText(state: GameState, entry: ArchiveEntry): string {
  return awakening(state) >= 1 && entry.strange ? entry.strange : entry.text;
}
