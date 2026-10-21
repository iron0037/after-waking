/** Save files are the GameState as JSON. The universe regenerates from the seed. */
import { SAVE_VERSION, type GameState } from "./state";

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

export function deserialize(json: string): GameState {
  const data = JSON.parse(json) as GameState;
  if (typeof data !== "object" || data === null || typeof data.seed !== "number") {
    throw new Error("Not an After Waking save file.");
  }
  if (data.version !== SAVE_VERSION) {
    throw new Error(`Save version ${data.version} isn't supported (expected ${SAVE_VERSION}).`);
  }
  // Fields added after the first M1 builds.
  data.surveyedBodies ??= [];
  data.payrollOwed ??= 0;
  data.contracts ??= [];
  data.nextContractAt ??= data.time;
  data.catalogedSpecies ??= [];
  return data;
}
