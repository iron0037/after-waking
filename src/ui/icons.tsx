/**
 * Line icons for the action rail (AW-255). 24×24, drawn in currentColor so they follow the button's state.
 * Kept as plain paths, no icon font, so they work offline and in the desktop build.
 */
import type { JSX } from "preact";

export type IconName =
  | "rover"
  | "boat"
  | "boatRover"
  | "home"
  | "stow"
  | "bolt"
  | "compass"
  | "ashore"
  | "board"
  | "rescue"
  | "move"
  | "liftoff"
  | "prospect"
  | "drill"
  | "sample"
  | "edge"
  | "clock"
  | "starmap"
  | "fly"
  | "scan"
  | "survey"
  | "land"
  | "probe"
  | "fold"
  | "capture"
  | "tow"
  | "outpost";

const PATHS: Record<IconName, JSX.Element> = {
  // A rover: body, mast, and three wheels.
  rover: (
    <>
      <rect x="4" y="9" width="16" height="7" rx="1.5" />
      <path d="M8 9V6h4l2 3" />
      <circle cx="6.5" cy="18.5" r="1.8" />
      <circle cx="12" cy="18.5" r="1.8" />
      <circle cx="17.5" cy="18.5" r="1.8" />
    </>
  ),
  // A boat on a wave.
  boat: (
    <>
      <path d="M4 13h16l-2.5 4h-11z" />
      <path d="M12 13V5l5 6h-5" />
      <path d="M3 20c2 0 2-1.2 4.5-1.2S10 20 12 20s2-1.2 4.5-1.2S19 20 21 20" />
    </>
  ),
  // A boat with a crate (the rover) on deck.
  boatRover: (
    <>
      <path d="M3 14h18l-2.5 4h-13z" />
      <rect x="8" y="8" width="8" height="6" rx="1" />
      <path d="M3 21c2 0 2-1 4.5-1S10 21 12 21s2-1 4.5-1S19 21 21 21" />
    </>
  ),
  // Home: back to the ship.
  home: (
    <>
      <path d="M4 11l8-7 8 7" />
      <path d="M6 10v9h12v-9" />
      <path d="M10 19v-5h4v5" />
    </>
  ),
  // A tray with an arrow into it: unload and stow.
  stow: (
    <>
      <path d="M12 3v10" />
      <path d="M8 9l4 4 4-4" />
      <path d="M4 14v5h16v-5" />
    </>
  ),
  bolt: <path d="M13 3L5 14h6l-1 7 8-11h-6z" />,
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2 5-5 2 2-5z" />
    </>
  ),
  // From the boat onto the shore.
  ashore: (
    <>
      <path d="M3 18c2 0 2-1 4-1s2 1 4 1" />
      <path d="M13 20h8v-6" />
      <path d="M6 13l6-6" />
      <path d="M8 7h4v4" />
    </>
  ),
  // Up the ramp into the boat.
  board: (
    <>
      <path d="M3 15h18l-2.5 4h-13z" />
      <path d="M12 3v8" />
      <path d="M8 7l4 4 4-4" />
    </>
  ),
  // A lifebuoy: the ship comes to fetch it.
  rescue: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M6 6l3.5 3.5M18 6l-3.5 3.5M6 18l3.5-3.5M18 18l-3.5-3.5" />
    </>
  ),
  // Four-way arrows: hop the ship.
  move: (
    <>
      <path d="M12 3v18M3 12h18" />
      <path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />
    </>
  ),
  // A magnifier over a core: prospect.
  prospect: (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="M14.5 14.5L20 20" />
      <path d="M8 10h4M10 8v4" />
    </>
  ),
  // A pick: work the deposit.
  drill: (
    <>
      <path d="M4 8c4-4 12-4 16 0" />
      <path d="M12 5.5V20" />
      <path d="M10 20h4" />
    </>
  ),
  // A sample tube with a sprig in it: collect a living sample.
  sample: (
    <>
      <path d="M9 3h6" />
      <path d="M10 3v14a2 2 0 0 0 4 0V3" />
      <path d="M12 15c0-3 1.5-4.5 3.5-5M12 12.5c0-2-1-3-2.5-3.5" />
    </>
  ),
  // Out past the dashed fold limit.
  edge: (
    <>
      <circle cx="9" cy="12" r="6.5" stroke-dasharray="2.5 2.5" />
      <path d="M9 12h12" />
      <path d="M17 8l4 4-4 4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  // Three stars: the star map.
  starmap: (
    <>
      <path d="M7 4l1 2.5 2.5 1-2.5 1L7 11l-1-2.5-2.5-1 2.5-1z" />
      <path d="M17 9l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
      <path d="M10 15l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
    </>
  ),
  // A course to a world.
  fly: (
    <>
      <circle cx="17" cy="7" r="3.5" />
      <path d="M4 20c3-1 7-4 10-9" stroke-dasharray="2.5 2.2" />
      <path d="M3.5 20.5l3-1-2-2z" />
    </>
  ),
  // A sensor sweep.
  scan: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 12l6-6" />
    </>
  ),
  // A world with a grid over it: the detailed survey.
  survey: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c-3 3-3 14 0 17M12 3.5c3 3 3 14 0 17" />
    </>
  ),
  // A dome with a pennant: a clan outpost, as on the maps.
  outpost: (
    <>
      <path d="M5 18a7 7 0 0 1 14 0z" />
      <path d="M3 18h18" />
      <path d="M12 11V4" />
      <path d="M12 4l4.5 1.5L12 7" />
    </>
  ),
  // A net: capture a creature.
  capture: (
    <>
      <path d="M4 5c5 2 11 2 16 0l-2 14c-4 1.5-8 1.5-12 0z" />
      <path d="M9 5.8l1 13.9M15 5.8l-1 13.9M4.6 10c5 1.5 9.8 1.5 14.8 0M5.3 15c4.6 1.3 8.8 1.3 13.4 0" />
    </>
  ),
  // A tug's line: a tow home.
  tow: (
    <>
      <rect x="2.5" y="9" width="6" height="6" rx="1.5" />
      <path d="M8.5 12c3 0 4-3 7-3" stroke-dasharray="2 2" />
      <path d="M15 6.5l6 2.5-6 2.5z" />
      <path d="M15.5 13.5l5 3.5" />
    </>
  ),
  // A fold: space pinched between two stars.
  fold: (
    <>
      <circle cx="5" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
      <path d="M7 12c3-5 7-5 10 0" />
      <path d="M7 12c3 5 7 5 10 0" />
    </>
  ),
  // A probe dropping into cloud bands.
  probe: (
    <>
      <path d="M12 3v3" />
      <path d="M9 6h6l-1 6h-4z" />
      <path d="M12 12v3" />
      <path d="M3 17c3 0 3-1.5 6-1.5s3 1.5 6 1.5 3-1.5 6-1.5" />
      <path d="M3 21c3 0 3-1.5 6-1.5s3 1.5 6 1.5 3-1.5 6-1.5" />
    </>
  ),
  // Down onto the ground.
  land: (
    <>
      <path d="M12 3v11" />
      <path d="M8 10l4 4 4-4" />
      <path d="M4 19h16" />
      <path d="M7 19l-1.5 2M17 19l1.5 2" />
    </>
  ),
  // Up to orbit.
  liftoff: (
    <>
      <path d="M12 3c3 2.5 4 6 4 10l-2 3h-4l-2-3c0-4 1-7.5 4-10z" />
      <circle cx="12" cy="9.5" r="1.5" />
      <path d="M10 19l-1 2M14 19l1 2M12 19v2.5" />
    </>
  ),
};

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg
      class="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
