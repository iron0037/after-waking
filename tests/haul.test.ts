/** Playtest 12: haul exactly what an active delivery job still needs. */
import { expect, it } from "vitest";
import { deliveryShortfalls, newGame, type Contract } from "../src/sim";

it("counts what's aboard, ore and concentrate alike, against each active delivery", () => {
  const s = newGame({ seed: 1 });
  const job: Contract = { id: "d1", clan: "diggers", kind: "deliver", title: "Diggers: 150 t of copper", text: "", reward: 9_000, durationDays: 200, deadline: null, status: "active", commodity: "copper", tonnes: 150 };
  s.contracts.push(job, { ...job, id: "d2", status: "offered" }, { ...job, id: "d3", commodity: "titanium", title: "x" });
  s.ship.cargo = { copper: 40 };
  expect(deliveryShortfalls(s, "copper")).toEqual([{ contract: job, short: 110 }]);
  s.ship.cargo = { copper: 160 };
  expect(deliveryShortfalls(s, "copper")).toEqual([]);
});
