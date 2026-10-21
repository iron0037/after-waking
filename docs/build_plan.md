# Build Plan — *After Waking*

## Tech Stack **[PROPOSED]**
| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** | Type safety across a large codebase; agents write it well |
| Simulation core | Pure TS module (`src/sim`) with **no rendering or DOM imports**, using a seeded RNG | Deterministic, so it can be tested headlessly and agents can verify their own work |
| Rendering | **Canvas 2D** for M1 (PixiJS installed for later) | Star map, system view and surface maps are simple enough for plain canvas; PixiJS returns when combat effects and sprites need it |
| UI (menus, panels, tooltips, journal) | **Preact + CSS** overlaid on the canvas | Modern mouse-and-keyboard UI is far easier in HTML/CSS than in a game engine |
| Content | Typed TypeScript data modules (`src/data/`) | Compile-time checked content. Planets, items, crew perks and clans are data, not code. Move to JSON with schema validation if non-programmers or mods need to author content. |
| Tests | **Vitest**, plus a headless bot that plays the core loop | Every change is checked automatically |
| Build / dev | **Vite** | Instant reload; I can play it in the built-in browser to verify |
| Desktop packaging | **Electron** (or Tauri later) | A double-click desktop app on Windows. During development it runs in a browser. |

**Prerequisite:** Node.js 24 LTS (installed 2026-10-21).

## Repo Layout
```
after-waking/
  docs/                 design docs (these files)
  src/sim/              game rules: time, galaxy, fold, flight, bodies, surface, mining, economy, crew, save
  src/render/           Pixi scenes: starmap, system, orbit, surface
  src/ui/               Preact panels: hub, cargo, crew, journal, tooltips
  src/data/             JSON content + Zod schemas
  tools/art/            SD/MOSS asset pipeline (manifest → generate → pixel-snap → palette)
  tests/                unit tests + headless playthrough bot
```

## Milestone 1: Vertical Slice ("one trip, start to finish")
**Goal:** a playable core loop. Leave the Intrepid, fold to a system, fly inward, land, drill, return, sell, upgrade.

| Area | M1 scope |
|---|---|
| **Intrepid hub** | Market (sell ore, buy fuel), shipyard (2–3 upgrades), crew roster (fixed starting crew), Exchange loan balance |
| **Galaxy** | About 15 procedurally generated systems near the Intrepid. Seeded and deterministic. |
| **Fold** | Star-map click → cost preview (linear: mass × distance) → recharge time |
| **System flight** | Arrive at the outermost planet's orbit. Click a body to auto-fly, with time compression. Clock and captain age shown. |
| **Orbit** | Scan → environment profile + region hints. Landing allowed or blocked by hull ratings, with the reason shown. |
| **Surface** | Top-down rover on a region tile map generated from the planet's seed. Find deposits, prospect, drill (timed), haul to the ship. |
| **Body types** | Rocky and icy worlds and asteroids. (Gas giants and oceans come in M2.) |
| **Persistence** | Save/load, autosave at the hub |
| **Art** | Mostly procedural (planets, terrain, starfield) plus a few generated sprites (freighter, rover, the Intrepid) through the art pipeline |

**Done when:** the headless bot completes 10 full trips without errors, and you can play a trip by hand and it feels like a trip.

## How the Work Is Split
1. **Foundation (me, no parallel agents):** repo, architecture, sim core (clock, RNG, save), data schemas, scene manager, UI shell. Foundations need one mind.
2. **Systems (parallel agents in git worktrees, each with a spec and tests):**
   - galaxy + fold
   - system flight + time compression
   - body generation + environment profiles
   - surface map + rover + mining
   - hub UI + economy
   - art pipeline script
3. **Integration (me):** merge, play-test in the browser, fix seams.
4. **Model use:** specs and integration on the main model; well-specified modules on Sonnet; bulk content and mechanical tasks on Haiku.

## Later Milestones
| Milestone | Adds |
|---|---|
| M2 | Crew XP and skill trees, research projects and unlocks, specimens, gas-giant probes, boat, ore processing |
| M3 | Turn-based combat (ships-of-the-line model), interdiction, surrender and prizes |
| M4 | Clans, reputation, job board, outposts |
| M5 | Story spine: the Archive, the Covenant's clue trail, crises and clocks, endings |
| M6 | Aliens (design tabled for now) |

## Balance Log
**2026-10-21: first bot runs** (10 trips × 3 seeds)
- The core loop completes on every seed with zero errors.
- **Trips are too fast:** 10–17 days each, against a target of 1–3 months. Levers: slower drilling, on-site processing, longer fold recharge, crew rest.
- **Too generous:** about 280–350k credits earned in roughly 4 months; all upgrades bought by trip 10. The loan is trivial.
- **Fixed already:**
  - Jackpot variance: precious ores now come in smaller deposits (sqrt price scaling).
  - Deep-seam dead ends: depth is now skewed shallow, so about 46% of seams are within the starting drill's reach.
- **Design gap:** a broke captain can be stranded at the Intrepid without fuel money. The Exchange could extend fuel credit, at a price.

## M1 Status (2026-10-21)
**Playable end to end.** One complete trip was played by hand in the real UI:
- Hub → fuel → star map → fold → system orrery → animated flight → scan.
- Landing was blocked on Mercy I (gravity, radiation), with the reasons shown.
- Fold → land → rover sweep → prospect (one seam too deep) → drill → unload → launch → edge → wait → fold home → sell.
- Tests: 21 passing, including the bot's 10-trip runs. The production build is 123 KB of JS.

**Fixed during the playtest:**
- New games weren't saved until the first action.
- The star map suggested Mercy, a system with no landable worlds, as the first destination.
- There was no way to wait for the fold drive while in a system.
- Shortcuts fired during animations.

## Backlog from Playtesting
1. **"Work this deposit" loop.** A 200 t hold takes about 10 rover loads, and every load is click-drill, click-return, click-stow, click-deploy, click-drive. Add a crew-run cycle (drill → haul → unload → return) that repeats until the hold, the deposit or rover energy runs out, and stops on any event. The crew does it, not an AI, so it fits the lore.
2. **Economy pacing** (see the balance log). One rover load of iron-nickel (740 cr) doesn't cover a fold's fuel (~1,700 cr). That's fine as a lesson, but the first trip should be guided toward a profitable target.
3. **Small-window layout.** At around 800×350 the top bar scrolls sideways and the maps get cramped. Add a compact top bar and a collapsible side panel.
4. **First-run guidance.** Explain region signal strength, sensor rings and drill depth the first time each comes up. The Archive "tutorial" voice from the lore fits here.
5. **Sprites.** Generate the freighter, rover, lander, Intrepid and title art with `tools/art/generate.py` once Stable Diffusion is running.
6. **Desktop packaging** (Electron) once M1 polish is done.
