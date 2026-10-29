/**
 * The bridge between the simulation and the UI. A GameSession owns the GameState and World,
 * runs actions, autosaves, and tells subscribed components to re-render.
 *
 * Components never mutate GameState directly: they call session.act(...) with a sim action.
 */
import { useEffect, useReducer } from "preact/hooks";
import type { Station } from "../data/crew";
import type { ClanId } from "../data/ship";
import type { ProbeDepth } from "../data/probes";
import {
  chooseProbeOption,
  deserialize,
  depthBand,
  migrateSurfaceCoords,
  newGame,
  serialize,
  World,
  type DiveResult,
  type EncounterResult,
  type GameState,
  type Orders,
  type Result,
} from "../sim";

export const SAVE_KEY = "after-waking/save";

/** UI-only navigation; not saved. Which views are valid depends on state.location. */
export type View = "hub" | "starmap" | "system" | "surface";

/** A long action is playing back as a time-lapse clock. */
export interface TimeLapse {
  from: number;
  to: number;
  startMs: number;
  durMs: number;
}

/** Actions that pass at least this many game minutes play a time-lapse (unless opted out). */
const TIMELAPSE_MIN_MINUTES = 4 * 60;

export interface ActOptions {
  /** Skip the time-lapse clock, for actions the screen already animates (flights, rover drives). */
  timelapse?: boolean;
}

/** A finished probe dive on its way to the debrief (UI only; the sim has already played it out). */
export interface ProbeReport {
  /** "signal": the link is gone and the ballast timer is running; "debrief": the result is in. */
  stage: "signal" | "debrief";
  bodyName: string;
  depth: ProbeDepth;
  bandName: string;
  km: number;
  choices: string[];
  result: DiveResult;
}

/** A finished raider encounter on its way to the debrief (UI only; the sim has already settled it). */
export interface EncounterDebrief {
  result: EncounterResult;
  raiderName: string;
  captain: string;
  /** The whole exchange, oldest first. */
  log: string[];
}

export const DEFAULT_ORDERS: Orders = { helm: "hold", guns: "hull", engineering: "guns", comms: "quiet" };

export interface Notice {
  id: number;
  text: string;
  kind: "error" | "info";
}

export class GameSession {
  view: View;
  notices: Notice[] = [];
  timelapse: TimeLapse | null = null;
  /** Set while an animation (flight, rover drive) is playing; input should be ignored. */
  private animating = false;
  /** True while an animation or the time-lapse clock plays: input waits until the time has passed. */
  get busy(): boolean {
    return this.animating || this.timelapse !== null;
  }
  /** The dive that just ended, until the player closes the debrief. */
  probeReport: ProbeReport | null = null;
  /** The encounter that just ended, until the player closes the debrief. */
  encounterDebrief: EncounterDebrief | null = null;
  /** The star the captain was folding to when a raider hailed (so the debrief can offer to carry on). */
  pendingFold: string | null = null;
  /** The last battle orders given: they carry over turn to turn. */
  orders: Orders = { ...DEFAULT_ORDERS };
  /** Whose perk tree is open (UI only; any screen can open it). */
  perkTree: Station | null = null;
  /** Set by "go to the hiring hall"; the Hub picks it up (switching to the Crew tab and scrolling) and clears it. */
  hallRequested = false;
  private listeners = new Set<() => void>();
  private noticeId = 0;

  constructor(
    public state: GameState,
    public world: World = new World(state.seed, state.worldGen ?? 1),
  ) {
    migrateSurfaceCoords(state, this.world);
    this.view = defaultView(state);
  }

  static fresh(seed: number, captainName?: string, clan?: ClanId, shipName?: string, face?: number): GameSession {
    const session = new GameSession(newGame({ seed, captainName, clan, shipName, face }));
    session.save();
    return session;
  }

  static load(): GameSession | null {
    try {
      const json = localStorage.getItem(SAVE_KEY);
      return json ? new GameSession(deserialize(json)) : null;
    } catch {
      return null;
    }
  }

  /** Run a sim action. Failures become an on-screen notice. Always re-renders and autosaves. */
  act<T>(fn: (state: GameState, world: World) => Result<T>, options: ActOptions = {}): Result<T> {
    const before = this.state.time;
    const journalBefore = this.state.journal.length;
    const encounterBefore = this.state.encounter;
    const result = fn(this.state, this.world);
    const encounterAfter = this.state.encounter;
    // An encounter that ended during this action: keep its story for the debrief.
    if (encounterBefore && !encounterAfter && this.state.lastEncounter) {
      this.encounterDebrief = {
        result: this.state.lastEncounter,
        raiderName: encounterBefore.raiderName,
        captain: encounterBefore.captain,
        log: [...encounterBefore.log],
      };
    }
    // Mineral specimens turn up while drilling; say so on screen, not just in the journal.
    for (const e of this.state.journal.slice(journalBefore)) if (e.text.startsWith("Mineral specimen:")) this.notify(e.text, "info");
    const passed = this.state.time - before;
    if (options.timelapse !== false && passed >= TIMELAPSE_MIN_MINUTES) this.playTimelapse(before, this.state.time);
    // A raider's hail fails the fold, but it isn't an error: the encounter window says it all.
    if (!result.ok && !(encounterAfter && !encounterBefore)) this.notify(result.reason, "error");
    const valid = validViews(this.state);
    if (!valid.includes(this.view)) this.view = defaultView(this.state);
    this.save();
    this.emit();
    return result;
  }

  /** Make the call at the current probe decision point. After the last one, the descent plays out and a debrief follows. */
  chooseProbe(option: 0 | 1): void {
    const dive = this.state.probeDive;
    if (!dive || this.timelapse) return;
    const bodyName = this.world.body(dive.bodyId).body.name;
    const res = this.act((s, w) => chooseProbeOption(s, w, option));
    if (!res.ok || !res.value.done || !res.value.result) return;
    const band = depthBand(dive.depth);
    const report: ProbeReport = {
      stage: "signal",
      bodyName,
      depth: dive.depth,
      bandName: band.name,
      km: band.km,
      choices: [...dive.choices],
      result: res.value.result,
    };
    this.probeReport = report;
    this.emit();
    // Let the signal-lost beat land, and the time-lapse clock (if the dive was long enough for one) finish, before the result.
    setTimeout(
      () =>
        this.whenIdle(() => {
          if (this.probeReport === report) {
            report.stage = "debrief";
            this.emit();
          }
        }),
      2200,
    );
  }

  closeProbeReport(): void {
    this.probeReport = null;
    this.emit();
  }

  closeEncounterDebrief(): void {
    this.encounterDebrief = null;
    this.pendingFold = null;
    this.emit();
  }

  /** Show the clock sweeping from `from` to `to`: longer stretches play a little longer (1–3.5 s). */
  playTimelapse(from: number, to: number): void {
    const hours = (to - from) / 60;
    const durMs = Math.min(3500, Math.max(1200, 900 + Math.log2(hours) * 420));
    const lapse: TimeLapse = { from, to, startMs: performance.now(), durMs };
    this.timelapse = lapse;
    setTimeout(() => {
      if (this.timelapse === lapse) {
        this.timelapse = null;
        this.emit();
        const queued = this.idleQueue.splice(0);
        for (const fn of queued) fn();
      }
    }, durMs + 700);
  }

  private idleQueue: (() => void)[] = [];

  /** Run `fn` once the time-lapse clock (if any) has finished, so nothing jumps ahead of it. */
  whenIdle(fn: () => void): void {
    if (this.timelapse) this.idleQueue.push(fn);
    else fn();
  }

  go(view: View): void {
    if (!validViews(this.state).includes(view)) return;
    this.view = view;
    this.emit();
  }

  /** Take the captain to the hiring hall: the Hub's Crew tab, scrolled to the recruits. Only while docked. */
  showHiringHall(): void {
    if (this.state.location.kind !== "intrepid") return;
    this.hallRequested = true;
    this.view = "hub";
    this.emit();
  }

  openPerkTree(station: Station | null): void {
    this.perkTree = station;
    this.emit();
  }

  setBusy(busy: boolean): void {
    this.animating = busy;
    this.emit();
  }

  notify(text: string, kind: Notice["kind"] = "info"): void {
    const id = ++this.noticeId;
    this.notices = [...this.notices.slice(-3), { id, text, kind }];
    this.emit();
    setTimeout(() => {
      this.notices = this.notices.filter((n) => n.id !== id);
      this.emit();
    }, Math.min(12_000, (kind === "error" ? 6000 : 3500) + text.length * 40)); // long reports stay up longer
  }

  save(): void {
    try {
      localStorage.setItem(SAVE_KEY, serialize(this.state));
    } catch {
      /* storage unavailable: the game still runs, it just can't be resumed */
    }
  }

  /** Force subscribers to redraw (e.g. after an animation frame changes UI-only state). */
  emit(): void {
    for (const l of this.listeners) l();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export function validViews(state: GameState): View[] {
  switch (state.location.kind) {
    case "intrepid":
      return ["hub", "starmap"];
    case "space":
      return ["system", "starmap"];
    case "surface":
      return ["surface"];
  }
}

export function defaultView(state: GameState): View {
  return validViews(state)[0] as View;
}

/** Re-render the calling component whenever the session changes. */
export function useSession(session: GameSession): GameSession {
  const [, bump] = useReducer((n: number, _: void) => n + 1, 0);
  useEffect(() => session.subscribe(() => bump()), [session]);
  return session;
}
