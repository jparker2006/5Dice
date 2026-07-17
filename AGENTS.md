# AGENTS.md

Orientation for coding agents (and humans) working in this repo. This is the canonical agent
guide, read by Antigravity, Claude Code, Cursor, Codex, and other tools that follow the
`AGENTS.md` convention. `CLAUDE.md` is a symlink to this file, so there is one source of truth —
edit this file, never a copy.

## What this is

**5 Dice** — a multiplayer, Yahtzee-style dice game. This repository is a ground-up rebuild
of a vanilla-JS peer-to-peer original (preserved under `legacy/`, by JefParker) into a
**Next.js + TypeScript** app backed by a **server-authoritative** networking layer.

The rebuild is happening in four milestones tracked in [`goals/`](goals/README.md). **Milestone
status:**

- ✅ **Goal 1 — Foundation** (this milestone): Next.js scaffold, the pure game engine in
  `src/game-core/`, tests, lint, typecheck, CI.
- ⬜ **Goal 2 — Networking**: PartyKit room server, zod protocol, server-side dice.
- ⬜ **Goal 3 — UI port**: React lobby/game/scorecard, 3D dice, PWA, deploy.
- ⬜ **Goal 4 — Harness + voice**: Puppeteer multi-browser sim, voice chat, HARNESS.md.

## Architecture

Three layers, one of which exists today:

1. **`src/game-core/`** *(exists)* — the pure, deterministic rules engine. No DOM, no network,
   no globals. Exports `createGame`, `applyAction` (the reducer), `calculateScore`, and the
   scorecard totals. RNG is injected, so games are reproducible under test.
2. **Authoritative server** *(Goal 2 — PartyKit)* — will hold exactly one `GameState` per room,
   roll all dice server-side, and route every player action through `applyAction`.
3. **Next.js client** *(Goal 3)* — renders server state and sends actions. Imports `game-core`
   only to *preview* scores locally; it never decides the real state.

## The load-bearing invariant

**Game state changes in exactly one place: `applyAction` in `src/game-core/reducer.ts`.**

Everything else follows from this. The server is the only thing that calls `applyAction` for
real; it validates every inbound message and rejects out-of-turn or malformed actions with a
typed error rather than trusting the client. Dice are rolled only by the server's RNG. A client
can never produce a state the rules forbid, because it doesn't mutate state at all.

When adding rules, put them in the reducer/scoring modules and cover them with tests. Do not
scatter game logic into UI or network code.

`src/game-core/` must stay pure — no `window`, `document`, `fetch`, or timers. This is what lets
the same code run on the server and in tests.

## Commands

| Command             | What it does                                             |
| ------------------- | -------------------------------------------------------- |
| `npm run dev`       | Next.js dev server (http://localhost:3000)               |
| `npm test`          | Run the Vitest suite once                                |
| `npm run test:watch`| Vitest in watch mode                                     |
| `npm run coverage`  | Tests with a coverage report (game-core is kept at 100%) |
| `npm run typecheck` | `tsc --noEmit` — strict type checking                    |
| `npm run lint`      | ESLint (Next.js core-web-vitals + TypeScript rules)      |
| `npm run build`     | Production build                                          |

Before considering any change done: `npm test`, `npm run typecheck`, and `npm run lint` must
all pass. CI (`.github/workflows/ci.yml`) runs the same three on every push and PR.

## The reference implementation

`legacy/` is the original working game — untouched, not part of the build (excluded from
tsconfig and eslint). It is the **behavioral source of truth** for game rules: when porting a
rule, match its behavior. `scoring.test.ts` even extracts the original `calculate5DiceScore`
from `legacy/five-dice.js` and asserts our port matches it for all 7,776 dice combinations.
`legacy/dice3d.js` is the 3D dice renderer to be ported in Goal 3. Never delete `legacy/`.

## Layout

```
src/
  app/            Next.js App Router (placeholder UI until Goal 3)
  game-core/      pure rules engine + its tests (the heart of the project)
goals/            the four milestone briefs
legacy/           the original vanilla-JS game (reference only)
```
