# Audio: sound effects (AW-31)

Music is its own ticket (AW-274). This covers the game's sound effects and ambience.

## Decisions [DECIDED]

- **Style:** retro and synthesized, close to the intro's music. Soft by default; nothing plays every frame.
- **Voice call-outs** are recorded alerts in the intro narrator's voice (Kokoro, offline): a recording, not a crewmate.
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

## Stable Audio Open (setup)

- **Where:** `E:\StableAudio`. A Python 3.11 venv (`.venv`: PyTorch cu128, diffusers, transformers, torchsde), and the
  model in diffusers format in `models\stable-audio-open-1.0` (5 GB; the duplicate full checkpoints are skipped).
- **Model access:** the model is gated on Hugging Face. The license was accepted on the user's account, and the CLI is
  logged in with their read token (`E:\StableAudio\.venv\Scripts\hf.exe auth login`). `E:\StableAudio\download.py`
  re-downloads it, retrying through dropped connections.
- **Making sounds:** prompts live in `tools/audio/sfx.json`; `tools/audio/sfx.py` renders takes to
  `tools/audio/output/<id>/` (not committed). Copy the chosen take into `public/assets/sfx/`. About 22 s per 3-second
  clip on the 3060 Ti after a 25 s model load. It shares the GPU, so don't run it alongside MOSS or the SD WebUI.
- **License:** Stability AI Community License. Re-check its terms before shipping anything it made.

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
   **Pass 2 (AW-281), done:** every sound gets a shared reverb and stereo; notices and credits no longer
   chime like bells. New: refuel (pouring liquid), orbital scan, survey (stylus on a chart), probe whoosh,
   raider-hail danger sting, rover bay open and close, boat splash, ship hop, recharge (power-up), drilling
   (hammer strikes for as long as the job's time-lapse runs), the rover and boat motors while driving, and
   the voice call-outs "Mineral detected" and "Lifeform detected" (intro narrator, Kokoro bf_emma;
   `tools/audio/callouts.py`), at most one of each per action.
2. **The rest of the surface (AW-285), done, synthesized:** prospecting (core sampler), a sample sealed, the
   stun prod, the net, the rover disabled (crunch and alarm), drill trouble (storm, quake, breakdown), and the
   background beds on the new Ambience slider: each world's weather by kind (thin wind, desert, living world,
   ocean surf, ice, hothouse, volcanic, airless), a lapping exotic sea, and the Intrepid's hum while docked
   (`src/ui/audio/ambience.ts`). The drill sound is hammer strikes only (AW-284).
   **Creature calls (Stable Audio Open), done:** five calls in `public/assets/sfx/creature-*.ogg`, one per kind:
   sea life moans, hunters growl, big grazers bellow, skittish things click, the rest chirp
   (`src/ui/audio/creatures.ts`). Every 7 s or so, a creature within 9 hexes of the rover (or the ship) may call,
   louder when near and panned to its side, on the ambience bus. Takes are mastered to even loudness by
   `tools/audio/master_sfx.py`.
3. **Combat (AW-286), done:** each battle turn plays in order: thrusters when the range changes, our lasers
   and kinetic battery, the far-off explosion when they land, their fire coming in, then a hull impact, a
   shield shimmer or a near miss, and the klaxon when a system is knocked past half or out. Endings: a fanfare
   when they strike their colors, a falling phrase and the hold being stripped when you lose, a drive surge
   when you escape, two warm notes when it's talked down or they break off. The hail keeps its danger sting.
