/**
 * Naming. The first scouts named the nearest stars after things they'd lost: people, cities,
 * rivers, songs. Everything farther out still carries an Intrepid Verge catalog number.
 */

export const STAR_NAMES = [
  "Halden",
  "New Lisbon",
  "Okonkwo's Star",
  "Tamsin",
  "Brightwater",
  "Kestrel",
  "Lantern",
  "Sorrow's Reach",
  "Marisol",
  "Antrim",
  "Juniper",
  "Vasquez",
  "Old Lamplight",
  "Calder",
  "Ishikari",
  "Nightingale",
  "Hesper",
  "Dunmore",
  "Ravel",
  "Second Hope",
  "Tolliver",
  "Esperance",
  "Kalinda",
  "Mercy",
] as const;

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV"];

export function roman(n: number): string {
  return ROMAN[n - 1] ?? String(n);
}

/** Moons are lettered: Halden IV-a, IV-b ... */
export function moonSuffix(index: number): string {
  return String.fromCharCode("a".charCodeAt(0) + index);
}

export function catalogName(index: number): string {
  return `IV-${String(410 + index * 7).padStart(4, "0")}`;
}
