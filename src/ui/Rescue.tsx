/** Shown when the tanks can't get the ship home: the way out is a (costly) distress call. */
import { callForRescue, fuelToGetHome, rescueQuote } from "../sim";
import { cr } from "./format";
import type { GameSession } from "./session";

export function RescuePanel({ session, busy = false }: { session: GameSession; busy?: boolean }) {
  const { state, world } = session;
  const quote = rescueQuote(state, world);
  if (!quote) return null;
  const need = fuelToGetHome(state, world);
  return (
    <section class="panel rescue-panel">
      <h3 class="danger">Not enough fuel to get home</h3>
      <p class="small">
        Getting back to the Intrepid takes about {need.toFixed(1)} units of plicite; the tanks hold {state.ship.fuel.toFixed(1)}.
      </p>
      <button class="btn primary" disabled={busy} onClick={() => session.act((s, w) => callForRescue(s, w))}>
        Send a distress call
      </button>
      <p class="muted small">
        An Exchange tender brings {quote.fuel} units in about {quote.days} days. {cr(quote.cost)} goes on your note. Expensive, but
        nobody gets left out here.
      </p>
    </section>
  );
}
