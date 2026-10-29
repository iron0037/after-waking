import { useState } from "preact/hooks";
import { CAPTAIN_CLANS } from "../data/clans";
import { FIRST_NAMES, SURNAMES } from "../data/crew";
import { CLAN_NAMES, type ClanId } from "../data/ship";
import { captainTitle } from "../sim";
import { PortraitPicker } from "./portraits";
import { GameSession } from "./session";

const CLAN_ORDER = Object.keys(CAPTAIN_CLANS) as ClanId[];
const FALLBACK_NAME = "Reyes";
const DEFAULT_SHIP = "Second Chance";

function randomName(): string {
  const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)] ?? "Ada";
  const last = SURNAMES[Math.floor(Math.random() * SURNAMES.length)] ?? FALLBACK_NAME;
  return `${first} ${last}`;
}

type Page = "menu" | "new" | "options";

/** The title screen: New Game, Continue Game and Options; new-game settings live on their own page. */
export function TitleScreen({ onStart }: { onStart: (s: GameSession) => void }) {
  const saved = GameSession.load();
  const [page, setPage] = useState<Page>("menu");
  if (page === "new") return <NewGame saved={!!saved} onStart={onStart} onBack={() => setPage("menu")} />;
  if (page === "options") return <Options onBack={() => setPage("menu")} />;
  return (
    <div class="title-screen">
      <div class="title-card title-menu">
        <h1>AFTER WAKING</h1>
        <p class="title-sub">AW 30 · Thirty years since the Waking</p>
        <p class="title-blurb">
          Two million people woke among unknown stars. The Intrepid can't move without fuel no one has yet found.
          You've just signed for a third-rate freighter and a debt to the Exchange. Somewhere out in the Verge are
          ore, answers, and maybe a home.
        </p>
        <div class="title-buttons">
          <button class="btn big" onClick={() => setPage("new")}>
            New Game
          </button>
          <button class={`btn big ${saved ? "primary" : ""}`} disabled={!saved} onClick={() => saved && onStart(saved)} title={saved ? undefined : "No saved game yet"}>
            Continue Game
            {saved && (
              <span class="title-save small">
                {captainTitle(saved.state.captain.name)}, {saved.state.ship.name}
              </span>
            )}
          </button>
          <button class="btn big" onClick={() => setPage("options")}>
            Options
          </button>
        </div>
      </div>
    </div>
  );
}

function Options({ onBack }: { onBack: () => void }) {
  return (
    <div class="title-screen">
      <div class="title-card title-menu">
        <h2>Options</h2>
        <p class="muted">Coming soon: sound and music, text size, difficulty (fuel strictness, combat speed, clock pressure), and keyboard shortcuts.</p>
        <div class="title-buttons">
          <button class="btn big" onClick={onBack}>
            Back
          </button>
        </div>
      </div>
    </div>
  );
}

function NewGame({ saved, onStart, onBack }: { saved: boolean; onStart: (s: GameSession) => void; onBack: () => void }) {
  const [name, setName] = useState(randomName);
  const [face, setFace] = useState<number | null>(null);
  const [shipName, setShipName] = useState(DEFAULT_SHIP);
  const [clan, setClan] = useState<ClanId | null>(null);
  const [seed, setSeed] = useState(() => String(Math.floor(Math.random() * 1_000_000)));
  const [guidance, setGuidance] = useState(true);

  const start = () => {
    const n = Number.parseInt(seed, 10);
    onStart(GameSession.fresh(Number.isFinite(n) ? n : 1, name.trim() || FALLBACK_NAME, clan ?? undefined, shipName.trim() || DEFAULT_SHIP, face ?? undefined, guidance));
  };

  return (
    <div class="title-screen">
      <div class="title-card">
        <div class="new-game-head">
          <button class="btn" onClick={onBack}>
            ← Back
          </button>
          <h2>New game</h2>
        </div>
        <div class="new-game">
          <div class="new-game-fields">
            <label>
              Your name
              <span class="name-row">
                <input value={name} placeholder="Your name" onInput={(e) => setName((e.target as HTMLInputElement).value)} maxLength={32} />
                <button class="btn reroll" title="Pick another name" onClick={() => setName(randomName())}>
                  ↻
                </button>
              </span>
            </label>
            <label>
              Ship name
              <input value={shipName} placeholder={DEFAULT_SHIP} onInput={(e) => setShipName((e.target as HTMLInputElement).value)} maxLength={32} />
            </label>
            <label>
              Galaxy seed
              <input value={seed} onInput={(e) => setSeed((e.target as HTMLInputElement).value)} maxLength={9} />
            </label>
          </div>
          <p class="new-game-preview">
            You'll be <strong class="accent">{captainTitle(name.trim() || FALLBACK_NAME)}</strong> of the <strong>{shipName.trim() || DEFAULT_SHIP}</strong>.
          </p>

          <div class="clan-pick-head">
            <strong>Your portrait</strong>
            <span class="muted small">Or leave it to chance.</span>
          </div>
          <PortraitPicker age={28} value={face} onPick={setFace} />

          <div class="clan-pick-head">
            <strong>Your clan</strong>
            <span class="muted small">Every clan gives a perk and charges for it.</span>
          </div>
          <div class="clan-pick" role="radiogroup" aria-label="Starting clan">
            <button type="button" role="radio" aria-checked={clan === null} class={`clan-card ${clan === null ? "selected" : ""}`} onClick={() => setClan(null)}>
              <span class="clan-card-name">No clan (independent)</span>
              <span class="clan-card-line muted">No perk and no cost. You answer to nobody but the Exchange.</span>
            </button>
            {CLAN_ORDER.map((id) => (
              <button
                type="button"
                key={id}
                role="radio"
                aria-checked={clan === id}
                class={`clan-card ${clan === id ? "selected" : ""}`}
                onClick={() => setClan(id)}
              >
                <span class="clan-card-name">{CLAN_NAMES[id]}</span>
                <span class="clan-card-line is-perk">
                  <b>Perk</b> {CAPTAIN_CLANS[id].perk}
                </span>
                <span class="clan-card-line is-cost">
                  <b>Cost</b> {CAPTAIN_CLANS[id].cost}
                </span>
              </button>
            ))}
          </div>

          <label class="new-game-check">
            <input type="checkbox" checked={guidance} onChange={(e) => setGuidance((e.target as HTMLInputElement).checked)} />
            <span>
              Archive guidance (recommended for new captains)
              <span class="muted small"> The Archive annotates each new procedure once. Silence it any time from the Journal.</span>
            </span>
          </label>

          <button class="btn big primary" onClick={start}>
            Begin
          </button>
          {saved && <p class="muted small">Starting a new game overwrites the current save.</p>}
        </div>
      </div>
    </div>
  );
}
