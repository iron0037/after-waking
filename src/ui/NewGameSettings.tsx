/**
 * The second new-game page (AW-205): the Universe and People settings, fixed for the career.
 */
import type { ComponentChildren } from "preact";
import {
  SETTING_LABELS,
  STAR_COUNTS,
  type Abundance,
  type Pace,
  type PeopleSettings,
  type PirateFrequency,
  type PirateStrength,
  type Reliability,
  type SettingChoice,
  type HostileLife,
  type StarCount,
  type UniverseSettings,
} from "../sim";

const HINTS = {
  stars: { 16: "A tight little Verge: 16 stars, 9 of them charted.", 22: "22 stars, 12 of them charted by the first scouts.", 30: "30 stars, 15 charted. More to find, farther to fly.", 40: "40 stars, 18 charted. A career won't see them all." } as Record<StarCount, string>,
  ore: {
    scarce: "Fewer, smaller seams. Every tonne counts.",
    normal: "Seams as the Exchange's surveyors expect them.",
    plentiful: "Half again as many seams, and bigger ones.",
  } as Record<Abundance, string>,
  life: {
    scarce: "Fewer living worlds, and fewer plants on them. Rare specimens are a real hunt.",
    normal: "About three temperate worlds in five carry life.",
    plentiful: "Most temperate worlds are alive and crowded with plants. Rare specimens turn up more often.",
  } as Record<Abundance, string>,
  hostile: {
    none: "Every creature out there is harmless. No Badlands worlds.",
    normal: "Some creatures defend their ground or hunt rovers. A few uncharted worlds are Badlands, ruled by apex predators.",
    plentiful: "Hunters are common, and twice as many uncharted living worlds are Badlands.",
  } as Record<HostileLife, string>,
  crewXp: {
    slow: "Officers learn their trade 40% slower.",
    normal: "Officers learn at the usual pace.",
    fast: "Officers learn 60% faster.",
  } as Record<Pace, string>,
  reliability: {
    limited: "Moods sour fast on long hauls and loyalty erodes quickly. Expect to rebuild your crew.",
    normal: "Officers need shore leave, fair pay and good trips, or they'll think about leaving.",
    unwavering: "Officers put up with almost anything. (How earlier versions played.)",
  } as Record<Reliability, string>,
  clanTrust: {
    slow: "Goodwill with the clans builds 40% slower.",
    normal: "Goodwill builds at the usual pace.",
    fast: "Goodwill builds 50% faster.",
  } as Record<Pace, string>,
  pirates: {
    rare: "Raiders find you less than half as often.",
    normal: "Raiders work the lanes as usual.",
    frequent: "Raiders find you 70% more often.",
  } as Record<PirateFrequency, string>,
  pirateStrength: {
    easy: "Raider hulls, guns and shields 25% weaker; bounties smaller.",
    normal: "Raiders as Helm's patrol reports describe them.",
    hard: "Raider ships 30% tougher; bounties bigger.",
  } as Record<PirateStrength, string>,
};

function Row({ label, hint, children }: { label: string; hint: string; children: ComponentChildren }) {
  return (
    <div class="setting-row">
      <span class="setting-label">{label}</span>
      <div class="setting-control">{children}</div>
      <span class="setting-hint muted small">{hint}</span>
    </div>
  );
}

function Segmented<T extends string | number>({ name, choices, value, onPick }: { name: string; choices: SettingChoice<T>[]; value: T; onPick: (v: T) => void }) {
  return (
    <div class="segmented" role="radiogroup" aria-label={name}>
      {choices.map((c) => (
        <button key={String(c.value)} type="button" role="radio" aria-checked={c.value === value} class={c.value === value ? "selected" : ""} onClick={() => onPick(c.value)}>
          {c.label}
        </button>
      ))}
    </div>
  );
}

/** 0–7 clans with an outpost (AW-23). */
const OUTPOST_CHOICES: SettingChoice<number>[] = Array.from({ length: 8 }, (_, n) => ({ value: n, label: String(n) }));

function outpostHint(n: number): string {
  if (n === 0) return "No outposts: the Intrepid is the only port in the Verge.";
  if (n === 7) return "Every clan keeps an outpost out in the Verge.";
  return `${n} of the seven clans keep${n === 1 ? "s" : ""} a small outpost out in the Verge: fuel, a shipyard and harder jobs, far from home.`;
}

const STAR_CHOICES: SettingChoice<StarCount>[] = [...STAR_COUNTS].sort((a, b) => a - b).map((n) => ({ value: n, label: String(n) }));

export function NewGameSettings({
  seed,
  onSeed,
  universe,
  onUniverse,
  people,
  onPeople,
}: {
  seed: string;
  onSeed: (s: string) => void;
  universe: UniverseSettings;
  onUniverse: (u: UniverseSettings) => void;
  people: PeopleSettings;
  onPeople: (p: PeopleSettings) => void;
}) {
  const u = <K extends keyof UniverseSettings>(k: K) => (v: UniverseSettings[K]) => onUniverse({ ...universe, [k]: v });
  const p = <K extends keyof PeopleSettings>(k: K) => (v: PeopleSettings[K]) => onPeople({ ...people, [k]: v });
  return (
    <div class="new-game-settings">
      <p class="muted small">These are fixed for the whole career: choose the Verge you want to fly.</p>
      <section class="settings-group">
        <h3>Universe</h3>
        <Row label="Galaxy seed" hint="The same seed lays out the same stars and worlds.">
          <input class="seed-input" value={seed} onInput={(e) => onSeed((e.target as HTMLInputElement).value)} maxLength={9} inputMode="numeric" />
        </Row>
        <Row label="Number of stars" hint={HINTS.stars[universe.stars]}>
          <Segmented name="Number of stars" choices={STAR_CHOICES} value={universe.stars} onPick={u("stars")} />
        </Row>
        <Row label="Ore abundance" hint={HINTS.ore[universe.ore]}>
          <Segmented name="Ore abundance" choices={SETTING_LABELS.abundance} value={universe.ore} onPick={u("ore")} />
        </Row>
        <Row label="Life abundance" hint={HINTS.life[universe.life]}>
          <Segmented name="Life abundance" choices={SETTING_LABELS.abundance} value={universe.life} onPick={u("life")} />
        </Row>
        <Row label="Hostile life" hint={HINTS.hostile[universe.hostile]}>
          <Segmented name="Hostile life" choices={SETTING_LABELS.hostile} value={universe.hostile} onPick={u("hostile")} />
        </Row>
        <Row label="Clan outposts" hint={outpostHint(universe.outposts ?? 3)}>
          <Segmented name="Clan outposts" choices={OUTPOST_CHOICES} value={universe.outposts ?? 3} onPick={u("outposts")} />
        </Row>
      </section>
      <section class="settings-group">
        <h3>People</h3>
        <Row label="Crew leveling rate" hint={HINTS.crewXp[people.crewXp]}>
          <Segmented name="Crew leveling rate" choices={SETTING_LABELS.pace} value={people.crewXp} onPick={p("crewXp")} />
        </Row>
        <Row label="Crew reliability" hint={HINTS.reliability[people.reliability]}>
          <Segmented name="Crew reliability" choices={SETTING_LABELS.reliability} value={people.reliability} onPick={p("reliability")} />
        </Row>
        <Row
          label="Retirement and quitting"
          hint={people.turnover ? "Veterans retire in their late fifties and sixties, and unhappy officers give notice." : "Nobody ever leaves the ship. Unhappy officers still work below their best."}
        >
          <label class="setting-toggle">
            <input type="checkbox" checked={people.turnover} onChange={(e) => p("turnover")((e.target as HTMLInputElement).checked)} />
            <span>{people.turnover ? "On" : "Off"}</span>
          </label>
        </Row>
        <Row label="Clan trust growth" hint={HINTS.clanTrust[people.clanTrust]}>
          <Segmented name="Clan trust growth" choices={SETTING_LABELS.pace} value={people.clanTrust} onPick={p("clanTrust")} />
        </Row>
        <Row label="Pirate frequency" hint={HINTS.pirates[people.pirates]}>
          <Segmented name="Pirate frequency" choices={SETTING_LABELS.pirates} value={people.pirates} onPick={p("pirates")} />
        </Row>
        <Row label="Pirate difficulty" hint={HINTS.pirateStrength[people.pirateStrength]}>
          <Segmented name="Pirate difficulty" choices={SETTING_LABELS.pirateStrength} value={people.pirateStrength} onPick={p("pirateStrength")} />
        </Row>
      </section>
    </div>
  );
}
