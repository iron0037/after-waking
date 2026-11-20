# Contributing to After Waking

Thanks for your interest! The game is in early development, so the most useful contributions right now are **playtest feedback and bug reports**.

## Reporting a bug or suggesting an idea

Open an [issue](https://github.com/iron0037/after-waking/issues/new/choose) and pick a template. For bugs, the most useful details are what you did, what you expected, and what happened instead. A screenshot helps a lot.

Please check the open issues first, in case someone has already reported it.

## Code changes

Small fixes are welcome as pull requests. For anything larger, such as a new feature, a new system or a balance change, open an issue first so we can agree on the design. The design docs in [`docs/`](docs/) mark settled decisions **[DECIDED]**.

### Setup

You need [Node.js](https://nodejs.org/) 20 or newer.

```bash
npm install
npm run dev          # http://localhost:5173
npx tsc --noEmit     # type-check
npx vitest run       # unit tests and the headless bot
```

### Ground rules

- **Game rules live in `src/sim/`.** That code is pure TypeScript with no DOM or rendering imports, and it's deterministic: the universe is regenerated from the save's seed. The interface (`src/ui/`, Preact) never changes game state directly. It calls actions through the session.
- **New gameplay needs a test.** If you touch the core loop, keep `tests/bot.test.ts` passing.
- **Saves are plain JSON.** Don't rename ids that saves store.
- **Writing:** game text uses US spelling (color, armor, defense).
- **Lore:** the crew are humans only. There are no androids or AI crew members, ever, and probes are piloted remotely by people.

### Pull requests

- Keep each pull request to one change, and describe what it does and why.
- Make sure the type-check and the tests pass.
- Include a screenshot for anything visible.

## Art and audio

Much of the game's art and sound is generated with local tools (see [`docs/art_pipeline.md`](docs/art_pipeline.md) and [`docs/audio.md`](docs/audio.md)). If you'd like to contribute assets, open an issue first, and say where they came from and what license they're under.
