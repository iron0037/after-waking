/**
 * Every source file must be UTF-8 (AW-183): a stray Latin-1 byte shows up as a garbled character in
 * the game. Vite reads the files as UTF-8, so an invalid byte arrives here as U+FFFD.
 */
import { expect, it } from "vitest";

const sources = import.meta.glob("../src/**/*.{ts,tsx,css}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

it("source files are valid UTF-8", () => {
  expect(Object.keys(sources).length).toBeGreaterThan(50);
  const bad = Object.entries(sources)
    .filter(([, text]) => text.includes("�"))
    .map(([path]) => path);
  expect(bad).toEqual([]);
});
