/**
 * The bridge between the simulation and the UI. A GameSession owns the GameState and World,
 * runs actions, autosaves, and tells subscribed components to re-render.
 *
 * Components never mutate GameState directly: they call session.act(...) with a sim action.
 */
import { useEffect, useReducer } from "preact/hooks";
import { deserialize, newGame, serialize, World, type GameState, type Result } from "../sim";

export const SAVE_KEY = "after-waking/save";

/** UI-only navigation; not saved. Which views are valid depends on state.location. */
export type View = "hub" | "starmap" | "system" | "surface";

export interface Notice {
  id: number;
  text: string;
  kind: "error" | "info";
}

export class GameSession {
  view: View;
  notices: Notice[] = [];
  /** Set while an animation (flight, rover drive) is playing; input should be ignored. */
  busy = false;
  private listeners = new Set<() => void>();
  private noticeId = 0;

  constructor(
    public state: GameState,
    public world: World = new World(state.seed),
  ) {
    this.view = defaultView(state);
  }

  static fresh(seed: number, captainName?: string): GameSession {
    const session = new GameSession(newGame({ seed, captainName }));
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
  act<T>(fn: (state: GameState, world: World) => Result<T>): Result<T> {
    const result = fn(this.state, this.world);
    if (!result.ok) this.notify(result.reason, "error");
    const valid = validViews(this.state);
    if (!valid.includes(this.view)) this.view = defaultView(this.state);
    this.save();
    this.emit();
    return result;
  }

  go(view: View): void {
    if (!validViews(this.state).includes(view)) return;
    this.view = view;
    this.emit();
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
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
