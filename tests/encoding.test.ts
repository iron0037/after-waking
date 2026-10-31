/** Every source file must be UTF-8: a stray Latin-1 byte shows up as a garbled character in the game. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|css|html|json)$/.test(name) ? [p] : [];
  });
}

it("source files are valid UTF-8", () => {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const bad = files("src").filter((p) => {
    try {
      decoder.decode(readFileSync(p));
      return false;
    } catch {
      return true;
    }
  });
  expect(bad).toEqual([]);
});
