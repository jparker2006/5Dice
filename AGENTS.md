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

- ✅ **Goal 1 — Foundation**: Next.js scaffold, the pure game engine in
  `src/game-core/`, tests, lint, typecheck, CI.
- ✅ **Goal 2 — Networking**: PartyKit room + lobby servers, zod protocol, server-side dice,
  reconnect/rejoin, integration tests against a real dev server.
- ⬜ **Goal 3 — UI port**: React lobby/game/scorecard, GSAP animation, 3D dice, PWA, deploy.
- ⬜ **Goal 4 — Harness + voice**: Puppeteer multi-browser sim, voice chat, HARNESS.md.

## Architecture

Three layers, two of which exist today:

1. **`src/game-core/`** *(exists)* — the pure, deterministic rules engine. No DOM, no network,
   no globals. Exports `createGame`, `applyAction` (the reducer), `calculateScore`, and the
   scorecard totals. RNG is injected, so games are reproducible under test.
2. **Authoritative server** *(exists — `party/`)* — PartyKit. `party/room.ts` is one instance
   per game: it seats players, auto-starts when full, holds the one true `GameState` in room
   storage (survives restarts; empty rooms self-destruct after 10 minutes), rolls all dice
   server-side, and routes every action through `applyAction`. `party/lobby.ts` is a singleton
   ("main") holding the room directory (rooms push summaries to it over party-to-party HTTP)
   and global chat with replay. Every inbound message is zod-validated via
   `src/protocol/parseMessage` — **never call `JSON.parse` on client input directly**.
3. **Next.js client** *(Goal 3)* — renders server state and sends actions via
   `src/lib/gameClient.ts` (`RoomClient`/`LobbyClient`: framework-free, auto-reconnecting,
   works in Node for tests). Imports `game-core` only to *preview* scores locally; it never
   decides the real state. Rejoin = reconnect with the same `playerId`; the server re-seats
   you and replies with the current snapshot.

The wire protocol lives in `src/protocol/index.ts` — zod schemas for every message, with
types inferred from them. Client→server schemas are `strict`: there is no field through which
a client can supply dice values or act as another player (the actor comes from the connection,
never message content). When you add a message type, add its schema here first.

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

## Visual style & animation

This game should feel **tactile and alive** — dice that tumble, scores that pop, colors that
morph between turns. Polished motion is a first-class feature here, not decoration.

- **GSAP is the animation library.** ([gsap.com](https://gsap.com) — free, all plugins
  included.) Reach for it for dice rolls, screen/scorecard transitions, score-commit flourishes,
  turn-change color morphs, celebration effects, and button/hover micro-interactions. Prefer
  GSAP timelines over ad-hoc CSS keyframes or `setInterval` animation. The **Flip** plugin is the
  right tool for layout/position transitions (e.g. dice snapping into place); **Draggable** and
  **MorphSVG** are available too.
- **The bar is "intentional," not "linear."** Motion should ease, stagger, overshoot slightly,
  and settle — never move at constant speed or snap without reason. Animate `transform` and
  `opacity` (GPU-cheap), not `top`/`left`/`width`; target 60fps and avoid layout thrash.
- **Centralize motion tokens.** Durations and easings live in one module (`src/lib/motion.ts`,
  created in Goal 3) so animations feel like one system. Don't scatter magic numbers.
- **Always respect `prefers-reduced-motion`** — provide a calm, instant fallback. Accessibility
  and low-power devices matter; the game must be fully playable with motion off.

Consistency beats novelty: a few reused, well-tuned motions read as "designed," while many
one-off animations read as slop.

## Commands

| Command                    | What it does                                                  |
| -------------------------- | ------------------------------------------------------------- |
| `npm run dev`              | Next.js dev server (http://localhost:3000)                    |
| `npm run party:dev`        | PartyKit dev server (rooms + lobby, http://localhost:1999)    |
| `npm test`                 | Unit tests (game-core), sub-second                            |
| `npm run test:watch`       | Vitest in watch mode                                          |
| `npm run test:integration` | Real client/server games against a self-booted `partykit dev` |
| `npm run coverage`         | Tests with a coverage report (game-core is kept at 100%)      |
| `npm run typecheck`        | `tsc --noEmit` — strict type checking                         |
| `npm run lint`             | ESLint (Next.js core-web-vitals + TypeScript rules)           |
| `npm run build`            | Production build                                              |

Before considering any change done: `npm test`, `npm run typecheck`, and `npm run lint` must
all pass — plus `npm run test:integration` for anything touching `party/`, `src/protocol/`, or
`src/lib/gameClient.ts` (it boots its own server on port 19990; nothing to start manually).
CI (`.github/workflows/ci.yml`) runs all of it on every push and PR.

## Verifying your work — run it in a browser

Tests prove the logic is right; they do **not** prove the UI looks right or the animation
actually plays. For any change that touches the interface — layout, styling, a GSAP animation,
a new screen — **open the running app in a browser and look at it before calling it done.**

Antigravity can drive the dev server directly (its browser tooling navigates, clicks, screenshots,
and reads the console); Claude Code has the equivalent Claude Browser tools. Either way:

1. `npm run dev` and open the app (note: if port 3000 is taken it will use 3001 — check the log).
2. Exercise the exact flow you changed — roll the dice, commit a score, trigger the transition.
3. **Screenshot it** and actually look: is the spacing right, does the animation ease and settle,
   is there any visual glitch?
4. Check the **browser console** for errors/warnings.
5. Check both **mobile (~375px)** and **desktop** widths — this game is played on phones.

A screenshot that looks right is the real acceptance test for graphics work. Treat "it renders
without a console error and looks correct at both sizes" as a required gate, the same as tests.

## The reference implementation

`legacy/` is the original working game — untouched, not part of the build (excluded from
tsconfig and eslint). It is the **behavioral source of truth** for game rules: when porting a
rule, match its behavior. `scoring.test.ts` even extracts the original `calculate5DiceScore`
from `legacy/five-dice.js` and asserts our port matches it for all 7,776 dice combinations.
`legacy/dice3d.js` is the 3D dice renderer to be ported in Goal 3. Never delete `legacy/`.

## Layout

```
party/
  room.ts         authoritative game room (one instance per game)
  lobby.ts        singleton lobby: room directory + global chat
src/
  app/            Next.js App Router (placeholder UI until Goal 3)
  game-core/      pure rules engine + its tests (the heart of the project)
  protocol/       zod schemas for every wire message (shared client/server)
  lib/            gameClient.ts — RoomClient/LobbyClient (framework-free)
tests/
  integration/    real-server tests: full games, rejoin, anti-cheat
goals/            the four milestone briefs
legacy/           the original vanilla-JS game (reference only)
partykit.json     PartyKit config (main = room party, "lobby" party alongside)
```
