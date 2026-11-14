/** AW-257: can the crew work a surface site with the gear aboard? */
import { describe, expect, it } from "vitest";
import { newGame, siteReach, Terrain, World, type Vec2 } from "../src/sim";

const world = new World(42);
const sys = world.galaxy.systems.find((x) => x.home && world.system(x.id).bodies.some((b) => b.easy))!;
const body = world.system(sys.id).bodies.find((b) => b.easy)!;
const surface = world.surface(body.id);

function find(t: Terrain): Vec2 {
  for (let y = 0; y < surface.height; y++) for (let x = 0; x < surface.width; x++) if (surface.terrainAt(x, y) === t) return { x, y };
  throw new Error(`no ${t} on ${body.name}`);
}

describe("site reach (AW-257)", () => {
  it("plain ground is workable now; deeper than the drill needs gear", () => {
    const s = newGame({ seed: 42 });
    const p = find(Terrain.plain);
    expect(siteReach(s, world, body.id, p).tier).toBe("now");
    const deep = siteReach(s, world, body.id, p, 10_000);
    expect(deep.tier).toBe("gear");
    expect(deep.why).toMatch(/drill reaches/);
  });

  it("the sea needs a boat, the mountains treads", () => {
    const s = newGame({ seed: 42 });
    const sea = find(Terrain.liquid);
    expect(siteReach(s, world, body.id, sea)).toMatchObject({ tier: "gear", why: expect.stringMatching(/boat/) });
    s.ship.upgrades.push("boat");
    expect(siteReach(s, world, body.id, sea).tier).toBe("now");
    const peak = find(Terrain.mountain);
    expect(siteReach(s, world, body.id, peak)).toMatchObject({ tier: "gear", why: expect.stringMatching(/treads/) });
  });
});
