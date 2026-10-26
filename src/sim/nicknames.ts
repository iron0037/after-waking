/**
 * Worlds the captain has given their own names (AW-147). Catalogue names stay as they are; the
 * nickname shows beneath them, like the scouts' "the Meadow".
 */
import type { Body } from "./bodies";
import { fail, ok, type Result } from "./result";
import type { GameState } from "./state";

export const NICKNAME_MAX = 24;

/** The name the captain (or the first scouts) gave a world, if any. */
export function bodyNickname(state: Pick<GameState, "nicknames">, body: Pick<Body, "id" | "nickname">): string | null {
  return state.nicknames?.[body.id] ?? body.nickname ?? null;
}

/** Name a world (an empty name clears yours, and the scouts' name shows again). */
export function setNickname(state: GameState, bodyId: string, name: string): Result<string | null> {
  const clean = name.replace(/\s+/g, " ").trim();
  if (clean.length > NICKNAME_MAX) return fail(`Keep it under ${NICKNAME_MAX} characters.`);
  state.nicknames ??= {};
  if (clean === "") {
    delete state.nicknames[bodyId];
    return ok(null);
  }
  state.nicknames[bodyId] = clean;
  return ok(clean);
}
