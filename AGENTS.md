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
- ✅ **Goal 3 — UI port**: React lobby/game/scorecard, GSAP motion system, 3D physics dice,
  PWA (Serwist), two-browser E2E, deploy-ready.
- ✅ **Goal 4 — Harness + voice**: N-player Puppeteer sim (`npm run sim`), WebRTC voice chat,
  and [`HARNESS.md`](HARNESS.md) — the vibecoding guide.
- ⬜ **Goal 5 — Visual overhaul**: design-skill-driven redesign of every screen (the legacy look
  is retired), GSAP set-pieces, restyled 3D dice, and the dice-truthfulness fix (the roll
  animation must land showing exactly the server's dice — sim-asserted).

## Architecture

Three layers, all in place:

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
3. **Next.js client** *(exists)* — renders server state and sends actions via
   `src/lib/gameClient.ts` (`RoomClient`/`LobbyClient`: framework-free, auto-reconnecting,
   works in Node for tests), wrapped for React by `src/hooks/useGameRoom.ts` and
   `src/hooks/useLobby.ts`. Imports `game-core` only to *preview* scores locally; it never
   decides the real state. Rejoin = reconnect with the same `playerId`; the server re-seats
   you and replies with the current snapshot. Identity lives in localStorage
   (`src/lib/identity.ts`); `?guest=<tag>` gives a per-tab sessionStorage identity so one
   browser can hold multiple players (used by tests and manual two-tab testing).
   The GSAP motion tokens live in `src/lib/motion.ts`; the 3D physics dice (Three.js +
   cannon-es, ported from legacy) in `src/lib/dice3d.ts`, driven imperatively by
   `GameRoom.tsx`. While the overlay is active, `body.dice3d-active` hides the 2D dice
   (they remain as position targets); `body[data-dice-animating]` is set during a tumble —
   tests use it to await animations.

The wire protocol lives in `src/protocol/index.ts` — zod schemas for every message, with
types inferred from them. Client→server schemas are `strict`: there is no field through which
a client can supply dice values or act as another player (the actor comes from the connection,
never message content). When you add a message type, add its schema here first.

**Voice chat** *(exists)* is a small WebRTC audio mesh (`src/lib/voice.ts`, `src/hooks/useVoice.ts`),
signaled by relaying `voice-signal` messages through the room server (which never interprets
them). One `RTCPeerConnection` and one `<audio>` element per remote peer; perfect-negotiation
handles glare. STUN only (Google's public server) — no TURN, so symmetric-NAT users may not get
voice, and that's fine: **voice is fully isolated — a mic or peer failure never touches game
state or reconnection.** Each peer audio element mirrors its connection state onto
`dataset.state` so the harness can assert "connected".

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

**[`DESIGN.md`](DESIGN.md) is the full design source of truth — read it before any UI work and
extend it, don't reinvent it.** The direction is an **"elevated felt game table"**: a warm,
atmospheric dark table with a green-felt dice tray, ivory 3D dice, and gold accents; the
background tints toward the **current player's color** (identity survives as light on the felt,
not a flat flood). The legacy navy-utility look is retired.

- **Type**: **Fraunces** (`--font-display`) for the gold wordmark/titles, **Figtree**
  (`--font-ui`) for everything else (tabular figures power the scorecard). Self-hosted via
  `next/font` — no runtime font requests (PWA stays offline-capable). Never Inter/Roboto/system
  as the brand face. *(next/font gotcha: a font can take `weight` OR `axes`, not both.)*
- **Color**: warm tokens in `globals.css` `:root` — `--table*`/`--felt*` (atmosphere),
  `--panel*` (surfaces), `--cream*` (ink), `--gold*` (accents — reserved for meaning, not
  decoration), player accents (identity, kept AA-legible). The felt grain is one inline SVG on
  `body::before`; the turn tint is `--turn-color`, GSAP-animated on `.game-screen`.
- **GSAP** ([gsap.com](https://gsap.com), free) is the animation library. Tokens live in
  `src/lib/motion.ts` (`durations` incl. `beat` for set-pieces, `easings`); the `tween`/`timeline`
  wrappers collapse to instant under reduced motion. Set-pieces in place: turn handoff (bg morph +
  status beat + tray pulse), score-commit pop, screen entrance, winner reveal (banner bounce +
  gold confetti + podium row stagger), and micro-interactions (roll-coin press, held-die lift,
  card/chip stagger, toasts).
- **The bar is "intentional," not "linear."** Ease, stagger, overshoot, settle. Animate
  `transform`/`opacity` only; 60fps; **always** honor `prefers-reduced-motion`.

Consistency beats novelty: reuse the tokens and existing motions before inventing new ones —
a few well-tuned ones read as "designed," many one-offs read as slop.

## Commands

| Command                    | What it does                                                  |
| -------------------------- | ------------------------------------------------------------- |
| `npm run dev`              | Next.js dev server (http://localhost:3000)                    |
| `npm run party:dev`        | PartyKit dev server (rooms + lobby, http://localhost:1999)    |
| `npm test`                 | Unit tests (game-core), sub-second                            |
| `npm run test:watch`       | Vitest in watch mode                                          |
| `npm run test:integration` | Real client/server games against a self-booted `partykit dev` |
| `npm run coverage`         | Tests with a coverage report (game-core is kept at 100%)      |
| `npm run sim`              | Flagship harness: N real browsers play a full game with chaos (`--players=N`, 2–6) — boots its own servers |
| `npm run e2e`              | Fast 2-player alias of the sim                                |
| `npm run voice`           | Voice-chat test: two fake-media browsers establish audio      |
| `npm run typecheck`        | `tsc --noEmit` — strict type checking                         |
| `npm run lint`             | ESLint (Next.js core-web-vitals + TypeScript rules)           |
| `npm run build`            | Production build (also builds the service worker)             |

Before considering any change done: `npm test`, `npm run typecheck`, and `npm run lint` must
all pass — plus `npm run test:integration` for anything touching `party/`, `src/protocol/`, or
`src/lib/gameClient.ts` (it boots its own server on port 19990; nothing to start manually), and
`npm run sim` for anything that could affect multiplayer. CI (`.github/workflows/ci.yml`) runs
typecheck/lint/unit/integration on every push and PR; the sim runs on demand (`workflow_dispatch`).
See [`HARNESS.md`](HARNESS.md) for the full verification ladder and vibecoding guidance.

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
`legacy/dice3d.js` is the 3D dice renderer (ported in Goal 3). Never delete `legacy/`.

## Layout

```
party/
  room.ts         authoritative game room (one instance per game); relays voice
  lobby.ts        singleton lobby: room directory + global chat
src/
  app/            Next.js App Router: / (settings→lobby), /room/[roomId], sw.ts,
                  manifest.ts, [path]/route.ts (serves the built service worker)
  components/     GameRoom (orchestrator + GSAP choreography), Lobby,
                  ScoreCards, SettingsForm, Toasts
  hooks/          useGameRoom, useLobby, useVoice, useWakeLock
  game-core/      pure rules engine + its tests (the heart of the project)
  protocol/       zod schemas for every wire message (shared client/server)
  lib/            gameClient (RoomClient/LobbyClient), motion (GSAP tokens),
                  dice3d (3D physics dice), voice (WebRTC mesh), identity, config
scripts/
  sim.mjs         flagship N-browser sim with chaos (npm run sim / e2e)
  voice-test.mjs  fake-media voice-connection test (npm run voice)
tests/
  integration/    real-server tests: full games, rejoin, anti-cheat
goals/            the four milestone briefs
legacy/           the original vanilla-JS game (reference only)
partykit.json     PartyKit config (main = room party, "lobby" party alongside)
```
