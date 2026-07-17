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
npm run dev        # http://localhost:3000
```

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
