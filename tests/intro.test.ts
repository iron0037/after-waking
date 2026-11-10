/** AW-234: the new-career intro has a picture and a voice clip for every line. */
import { describe, expect, it } from "vitest";
import script from "../src/data/intro.json";

const files = Object.keys(import.meta.glob("../public/assets/intro/*", { query: "?url", eager: false })).map((p) => p.split("/").pop());

describe("the intro (AW-234)", () => {
  it("every scene has its picture and its voiceover", () => {
    expect(script.scenes.length).toBeGreaterThan(0);
    script.scenes.forEach((s, i) => {
      expect(files, s.image).toContain(`${s.image}.png`);
      expect(files, `vo-${i + 1}`).toContain(`vo-${i + 1}.ogg`);
      expect(s.text.length).toBeGreaterThan(0);
    });
  });

  it("the narrator says the dates as words", () => {
    for (const s of script.scenes) {
      const spoken = (s as { say?: string }).say ?? s.text;
      expect(spoken, s.image).not.toMatch(/\d{4}/);
    }
  });
});
