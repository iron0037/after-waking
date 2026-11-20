/** AW-31: creature calls on the surface: which call a species makes, and which creature in earshot is heard. */
import { describe, expect, it } from "vitest";
import { CREATURES } from "../src/data/creatures";
import { CALL_RANGE, creatureCall, pickCreatureCall } from "../src/ui/audio/creatures";

const files = new Set(Object.keys(import.meta.glob("../public/assets/sfx/*.ogg")).map((p) => p.split("/").pop()));
const flat = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

describe("creature calls (AW-31)", () => {
  it("gives every species a call that ships with the game", () => {
    for (const c of CREATURES) expect(files.has(`${creatureCall(c)}.ogg`), c.id).toBe(true);
  });

  it("sea life moans, hunters growl, big grazers bellow, skittish things click, the rest chirp", () => {
    expect(creatureCall({ aquatic: true, temperament: "hostile", size: 2 })).toBe("creature-sea");
    expect(creatureCall({ temperament: "hostile", size: 1 })).toBe("creature-growl");
    expect(creatureCall({ temperament: "docile", size: 2 })).toBe("creature-bellow");
    expect(creatureCall({ temperament: "skittish", size: 1 })).toBe("creature-clicks");
    expect(creatureCall({ temperament: "docile", size: 1 })).toBe("creature-chirp");
  });

  it("hears only creatures in earshot and on their feet; nearer is louder, panned to its side", () => {
    const grazer = { temperament: "docile" as const, size: 2 as const };
    const me = { x: 10, y: 10 };
    expect(pickCreatureCall([{ x: 10 + CALL_RANGE + 1, y: 10, down: false, entry: grazer }], me, flat, () => 0)).toBeNull();
    expect(pickCreatureCall([{ x: 12, y: 10, down: true, entry: grazer }], me, flat, () => 0)).toBeNull();
    const near = pickCreatureCall([{ x: 11, y: 10, down: false, entry: grazer }], me, flat, () => 0)!;
    const far = pickCreatureCall([{ x: 2, y: 10, down: false, entry: grazer }], me, flat, () => 0)!;
    expect(near.call).toBe("creature-bellow");
    expect(near.gain).toBeGreaterThan(far.gain);
    expect(near.pan).toBeGreaterThan(0);
    expect(far.pan).toBe(-1);
  });
});
