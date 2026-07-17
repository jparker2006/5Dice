# 🎲 5 Dice

A multiplayer, Yahtzee-style dice game. This repo is a ground-up rebuild of the original
peer-to-peer game by [JefParker](https://github.com/JefParker/5Dice) — moving it to
**Next.js + TypeScript** with a **server-authoritative** networking core so that game state has
a single source of truth instead of being reconciled across peers.

The original game is preserved, fully working, under [`legacy/`](legacy/) and remains the
behavioral reference for all game rules.

## Status

Built in four milestones (see [`goals/`](goals/README.md)):

| Milestone                    | State | What it delivers                                             |
| ---------------------------- | :---: | ------------------------------------------------------------ |
| **1. Foundation**            |  ✅   | Next.js scaffold, pure tested game engine, lint/typecheck/CI |
| **2. Server networking**     |  ⬜   | PartyKit authoritative room server, server-side dice         |
| **3. UI port**               |  ⬜   | React lobby/game/scorecard, 3D dice, installable PWA, deploy |
| **4. Harness + voice**       |  ⬜   | Multi-browser Puppeteer sim, voice chat, agent harness docs  |

The **game engine** (`src/game-core/`) is complete: pure, deterministic, and covered 100% by
tests — including a parity check against the original scoring function across every possible
roll.

## Getting started

```bash
npm install
npm run party:dev  # PartyKit game servers (localhost:1999)
npm run dev        # Next.js app → http://localhost:3000
```

Open two browser windows (use `?guest=SomeName` in one to get a second identity
from the same browser), create a room, join it, and play.

## Deploying

Two deploys, in this order:

1. **PartyKit** (game servers):
   ```bash
   npx partykit deploy        # first run opens a login; note the printed host
   ```
2. **Vercel** (the app): set the env var `NEXT_PUBLIC_PARTYKIT_HOST` to the host
   from step 1 (e.g. `5dice.<username>.partykit.dev`), then:
   ```bash
   npx vercel deploy --prod
   ```

The app is an installable PWA; a fresh deploy takes over on the next load
(no stale-cache limbo — the service worker precaches hashed assets and
serves documents network-first).

## Development

```bash
npm test           # run the test suite
npm run coverage   # tests + coverage report
npm run typecheck  # strict TypeScript checking
npm run lint       # ESLint
```

All three of test, typecheck, and lint run in CI on every push and pull request. See
[`AGENTS.md`](AGENTS.md) for architecture and the core invariant that only the server mutates
game state.

## Project layout

```
AGENTS.md        agent/contributor guide (CLAUDE.md symlinks to it)
src/app/         Next.js App Router (UI arrives in milestone 3)
src/game-core/   the pure rules engine — the heart of the project
goals/           the four milestone briefs
legacy/          the original vanilla-JS game (reference only)
```

## Credits

Original game and design by **JefParker**. This rebuild preserves the gameplay and extends the
networking and tooling.
