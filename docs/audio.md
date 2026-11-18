# Audio: sound effects (AW-31)

Music is its own ticket (AW-274). This covers the game's sound effects and ambience.

## Decisions [DECIDED]

- **Style:** retro and synthesized, close to the intro's music. Soft by default; nothing plays every frame.
- **Three sources, each where it fits best:**
  1. **Synthesized in the browser** (Web Audio, `src/ui/audio/synth.ts`): clicks, beeps, scanner sweeps,
     pings, alarms, zaps, and anything abstract. No files, easy to tweak, no licensing.
  2. **Free CC0 libraries** for physical one-offs (clunks, impacts, hisses, splashes): Kenney's Sci-Fi,
     Interface and Impact packs; the Sonniss game-sound bundles; Freesound filtered to CC0. Every file's
     license goes in `public/assets/sfx/CREDITS.md`.
  3. **Stable Audio Open, run locally** on the RTX 3060 Ti (installed on E:, like Kokoro and MOSS; it can't
     share the GPU with Stable Diffusion) for custom sounds the libraries won't have: the drill loop, rover
     motors, alien creature calls, each world type's surface ambience. Re-check its license (Stability's
     Community License) before shipping.
- **The rules stay silent.** Sounds are triggered in the interface, from things that already happen: an
  action's result and the change it made (`src/ui/audio/triggers.ts`), notices, and the animations that
  start and stop loops.

## The engine

`src/ui/audio/engine.ts`: one AudioContext, created on the first click or key (browsers require it), with
a bus per kind of sound under a master gain: **interface**, **effects**, **ambience**, **music**. Volumes and
a mute are set in Options and the top bar's Sound menu, and remembered in the browser. The intro's music
and narration follow them too.

## What needs sound

| Area | Sounds |
|---|---|
| Everywhere | button click, blocked thunk, notice chime, credits in, purchase, level-up, discovery ping |
| Travel | fold (spool-up and boom), drive ready, burn rumble (loop), entering orbit, docking, undocking |
| System view | scan sweep, survey hum, probe launch, probe static and events, probe recovered or lost, Helm tow |
| Surface | landing, lift-off, hop, rover deploy and stow, rover motor (loop), boat launch, sailing (loop), drill (loop), prospect, sample sealed, recharge, deposit found, unknown reading, storm or quake, rover hit or wrecked, stun prod, net |
| Combat | hail, laser, kinetic battery, shield hit, hull hit, system damage alarm, they strike their colors, victory, losing cargo |
| The Intrepid | market sale, fuel pump, gear fitted, contract signed, contract complete, research started |
| Ambience (loops) | the Intrepid's hum, space drone, surface ambience per world type, Badlands creature calls |

## Phases

1. **Done:** the engine, volume settings, and the synthesized interface and travel sounds: click, blocked,
   notice, credits, purchase, level-up, discovery, fold, land, lift-off, dock, undock, orbit, and the burn loop.
2. The surface: rover, boat, drill, scans, samples, capture, and per-world ambience (Stable Audio Open).
3. Combat.
