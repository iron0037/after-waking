/**
 * The Awaken clue trail (AW-25): evidence that the world is not what it seems, gathered in the
 * Covenant's dossier. Clues come from finds (a crystal, a moss, what certain perks notice) and from
 * the Covenant's errands. See docs/lore.md (The Deep Mystery) and sim/covenant.ts.
 */

export type ClueId = "folded-plicite" | "song-moss" | "fold-curve" | "missing-world" | "signal" | "seams" | "future-log";

export interface Clue {
  id: ClueId;
  title: string;
  /** A vague pointer shown in the dossier before it's found. */
  hint: string;
  /** What you found. */
  found: string;
  /** What the Covenant makes of it. */
  covenant: string;
}

export const CLUES: readonly Clue[] = [
  {
    id: "folded-plicite",
    title: "Folded plicite",
    hint: "Something in the plicite cores.",
    found: "A plicite crystal whose lattice folds back through itself. The Lyceum has no model for it and asked you not to mention it.",
    covenant: "\"Natural crystals have flaws. This one has a design. Plicite is the fuel of the whole fleet, and it was made to be found.\"",
  },
  {
    id: "song-moss",
    title: "Song moss",
    hint: "Something on a temperate world that sings.",
    found: "A moss that vibrates at a steady 432 hertz, on a world nobody from Earth had ever seen.",
    covenant: "\"Four hundred and thirty-two. An old Earth tuning standard. Why would an alien moss hum a note our great-grandparents argued about?\"",
  },
  {
    id: "fold-curve",
    title: "The fold curve",
    hint: "The Covenant wants a recorder carried through the fold.",
    found: "The Covenant's recorder logged three folds. The fuel each one burned fits mass times distance to the twelfth decimal place.",
    covenant: "\"Nature is never that tidy. Real engines have losses, wobbles, bad days. Ours burn exactly what the formula says. Every time.\"",
  },
  {
    id: "missing-world",
    title: "The missing world",
    hint: "The Covenant's old catalogue lists a world the Helm's charts don't.",
    found: "Where the first-year catalogue listed a world, you found an orbit with nothing in it: no debris, no dust, a perfectly circular lane of empty space.",
    covenant: "\"Worlds don't leave. They get removed. And whatever removed it tidied up afterwards.\"",
  },
  {
    id: "signal",
    title: "The impossible signal",
    hint: "Someone should listen on 432 hertz out past the charted stars.",
    found: "A carrier on 432 hertz from no source at all, repeating a pattern your comms officer recognised: the Intrepid's own maintenance codes, from before the anomaly.",
    covenant: "\"Nobody out here should know those codes. Unless they were never out here at all.\"",
  },
  {
    id: "seams",
    title: "The seams",
    hint: "A trained eye might notice something wrong with a world's surface.",
    found: "A stretch of terrain that repeats exactly, hex for hex, like a floor laid in tiles.",
    covenant: "\"You've seen a seam. Once you've seen one, you'll see them everywhere. We're sorry.\"",
  },
  {
    id: "future-log",
    title: "A log from the future",
    hint: "Read your own journal carefully.",
    found: "An entry in your ship's journal, in your own words, stamped with a date that hasn't happened yet.",
    covenant: "\"We have a box of these. Captains bring them to us. None of the dates have come yet. Keep it safe.\"",
  },
];

export const CLUES_BY_ID = new Map(CLUES.map((c) => [c.id, c] as const));

/** Clues it takes for the Covenant to show you where every thread leads. */
export const CLUES_FOR_FINALE = 5;
/** Clues after which the Archive's help starts to read strangely. */
export const CLUES_FOR_STRANGE = 3;

export type ErrandKind = "recorder" | "missing-world" | "listen";

export interface ErrandDef {
  kind: ErrandKind;
  clue: ClueId;
  title: string;
  /** The ask, as the Covenant puts it. {star} is replaced with the target star's name. */
  ask: string;
  /** What doing it on site looks like (the action's label), for errands done in a system. */
  action?: string;
  /** Hours the on-site task takes. */
  hours?: number;
  /** Clues needed before it's offered (Covenant captains get the first one at once). */
  afterClues: number;
  stipend: number;
}

export const ERRANDS: readonly ErrandDef[] = [
  {
    kind: "recorder",
    clue: "fold-curve",
    title: "Carry the recorder",
    ask: "A Covenant listener presses a battered recorder into your hands. \"Carry it through three folds, anywhere you like, and bring it back. Don't let the Lyceum see it.\"",
    afterClues: 0,
    stipend: 1_000,
  },
  {
    kind: "missing-world",
    clue: "missing-world",
    title: "Count the worlds at {star}",
    ask: "\"Our copy of the first-year catalogue lists one more world at {star} than the Helm's charts do. The Helm says it was a clerical error. Go and look where it should be.\"",
    action: "Search the empty orbit",
    hours: 8,
    afterClues: 1,
    stipend: 2_000,
  },
  {
    kind: "listen",
    clue: "signal",
    title: "Listen at {star}",
    ask: "\"Out past the charted stars, at {star}, our listeners swear they've heard something on 432 hertz. Sit at the edge of the system for a day with your comms open, and tell us what you hear.\"",
    action: "Listen on 432 hertz",
    hours: 24,
    afterClues: 2,
    stipend: 2_500,
  },
];

export const ERRANDS_BY_KIND = new Map(ERRANDS.map((e) => [e.kind, e] as const));

/** The Covenant's word once the dossier is thick enough: where every thread leads. */
export const FINALE_TEXT =
  "The Covenant's eldest listener reads your dossier twice. \"Every thread runs outward. Past the last charted star our listeners hear nothing at all: not silence, nothing, the way a wall sounds. When you have a ship that can cross the dark between the stars, go and look at the edge. We'll be waiting.\"";
