import { useState } from "preact/hooks";
import { GameSession } from "./session";

export function TitleScreen({ onStart }: { onStart: (s: GameSession) => void }) {
  const saved = GameSession.load();
  const [name, setName] = useState("Captain Reyes");
  const [seed, setSeed] = useState(() => String(Math.floor(Math.random() * 1_000_000)));

  const start = () => {
    const n = Number.parseInt(seed, 10);
    onStart(GameSession.fresh(Number.isFinite(n) ? n : 1, name.trim() || "Captain Reyes"));
  };

  return (
    <div class="title-screen">
      <div class="title-card">
        <h1>AFTER WAKING</h1>
        <p class="title-sub">AW 30 · Thirty years since the Waking</p>
        <p class="title-blurb">
          Two million people woke among unknown stars. The Intrepid can't move without fuel no one has yet found.
          You've just signed for a third-rate freighter and a debt to the Exchange. Somewhere out in the Verge are
          ore, answers, and maybe a home.
        </p>
        {saved && (
          <button class="btn primary big" onClick={() => onStart(saved)}>
            Continue — {saved.state.captain.name}, {saved.state.ship.name}
          </button>
        )}
        <div class="new-game">
          <label>
            Captain
            <input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} maxLength={32} />
          </label>
          <label>
            Galaxy seed
            <input value={seed} onInput={(e) => setSeed((e.target as HTMLInputElement).value)} maxLength={9} />
          </label>
          <button class={`btn big ${saved ? "" : "primary"}`} onClick={start}>
            New game
          </button>
        </div>
        {saved && <p class="muted small">Starting a new game overwrites the current save.</p>}
      </div>
    </div>
  );
}
