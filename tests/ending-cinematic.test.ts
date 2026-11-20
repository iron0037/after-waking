/** AW-277: the endings' cinematics: every panel has its art and voice, and the Return's coda follows the clues. */
import { describe, expect, it } from "vitest";
import awaken from "../src/data/ending-awaken.json";
import script from "../src/data/ending-return.json";
import { newGame, returnCoda } from "../src/sim";

// What's in the cinematic's folder (Vite lists it; nothing is loaded).
const FILES = new Set(Object.keys(import.meta.glob("../public/assets/ending-return/*")).map((p) => p.split("/").pop()));
const AWAKEN_FILES = new Set(Object.keys(import.meta.glob("../public/assets/ending-awaken/*")).map((p) => p.split("/").pop()));
const coda = (s: (typeof script.scenes)[number]): string | undefined => ("when" in s ? s.when : undefined);

describe("the Return cinematic (AW-277)", () => {
  it("has the art and the voice for every panel", () => {
    for (const s of script.scenes) {
      expect(FILES.has(`${s.image}.png`), s.image).toBe(true);
      expect(FILES.has(`vo-${s.id}.ogg`), `vo-${s.id}`).toBe(true);
    }
  });

  it("plays one coda or the other, never both", () => {
    const plain = script.scenes.filter((s) => coda(s) !== "covenant");
    const covenant = script.scenes.filter((s) => coda(s) !== "plain");
    expect(plain.map((s) => s.id)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
    expect(covenant.map((s) => s.id)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8c", "9c"]);
  });

  it("gives the Covenant's coda to a captain with three clues", () => {
    const state = newGame({ seed: 42 });
    expect(returnCoda(state)).toBe("plain");
    state.clues = [0, 1, 2].map((i) => ({ id: `clue-${i}`, t: 0 })) as unknown as typeof state.clues;
    expect(returnCoda(state)).toBe("covenant");
  });
});

describe("the Awaken cinematic (AW-277)", () => {
  it("has the art and the voice for every panel", () => {
    for (const s of awaken.scenes) {
      expect(AWAKEN_FILES.has(`${s.image}.png`), s.image).toBe(true);
      expect(AWAKEN_FILES.has(`vo-${s.id}.ogg`), `vo-${s.id}`).toBe(true);
    }
  });

  it("ends on the choice the ending card closes with", () => {
    expect(awaken.scenes.at(-1)?.text).toBe("You could go back to sleep. Or you could start waking the others.");
  });
});
