# After Waking

A Starflight-inspired space exploration game. TypeScript + Preact + Vite, played in the browser during development (desktop packaging later).

## Commands
Node is at `C:\Program Files\nodejs`. In Git Bash, prefix commands with `export PATH="/c/Program Files/nodejs:$PATH";`.
- `npx tsc --noEmit`: type-check (strict, `noUncheckedIndexedAccess`)
- `npx vitest run`: unit tests plus the headless bot (`tests/bot.test.ts` plays 10 full trips per seed)
- `npm run dev`: dev server on http://localhost:5173 (`.claude/launch.json` entry "after-waking")

## Architecture
- `src/sim/`: game rules. Pure TypeScript, with **no DOM or rendering imports**, and deterministic.
  - The universe (galaxy, systems, bodies, surface regions) is regenerated from `GameState.seed` via `World`; it is never saved.
  - `GameState` is plain JSON and is the save file.
  - All time passes through `advanceTime` (`state.ts`).
  - Player verbs live in `actions.ts`. They return `Result` with a human-readable `reason` on failure and never throw for gameplay errors.
- `src/data/`: typed content (commodities, upgrades, names).
- `src/ui/`: Preact components.
  - `GameSession` (`session.ts`) wraps state and world. Components call `session.act((state, world) => action(...))` and never mutate state directly.
  - Screens live in `src/ui/screens/`. Each returns `.viewport` + `.side`, or `.full`.
  - Maps draw with the `Canvas` component (2D canvas).
- `docs/`: design docs. Settled decisions are marked **[DECIDED]**; read them before design work.

## Issue tracking (Jira)
- Site: https://afterwaking.atlassian.net (cloudId `8f6f89c0-15e1-4b75-bd28-2a35fe229b8e`), project "The Waking Team". The key is being renamed SCRUM → AW; old keys redirect.
- Epics: M2 Crew & Research, M3 Combat, M4 Clans & Outposts, M5 Story & Endings, M6 Aliens, Art & Audio, UX & Polish, Balance & Economy, Tech & Tooling.
- Every bug gets an issue (type Bug), even when it's fixed in the same session; it's the audit trail.
- Commit messages cite the issue key. After a fix: comment with the commit hash, then move the issue to Done.

## Rules
- Lore constraints: humans only at the start; **no androids or AI crew, ever**; probes are remote-piloted by people.
- Keep sim logic out of the UI. If a screen needs a computed value, add a function to `src/sim`.
- New gameplay needs a test. If it touches the core loop, keep `tests/bot.test.ts` passing.
