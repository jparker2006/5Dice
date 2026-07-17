# HARNESS.md — vibecoding this repo

A short guide to getting great results building 5 Dice with an AI agent
(Antigravity, Claude Code, Cursor, …). The one idea: **never trust "it should
work" — prove it, at the cheapest tier that can.** Start every session by
pointing the agent at [`AGENTS.md`](AGENTS.md); it carries the architecture, the
load-bearing invariant, and the GSAP/motion conventions.

## The verification ladder

Match the check to the change. Run the cheap ones always; climb only as far as
the change demands.

| Tier | Command | Proves | When |
| --- | --- | --- | --- |
| Types | `npm run typecheck` | it compiles under strict TS | every change |
| Lint | `npm run lint` | style + React-hooks rules | every change |
| Unit | `npm test` | game-core rules (100% covered) | any rules/scoring change |
| Integration | `npm run test:integration` | the PartyKit protocol, rejoin, anti-cheat | any `party/`, `protocol/`, or `gameClient` change |
| **Look at it** | `npm run dev` + a browser | it *looks* right and the animation plays | any UI/animation change |
| Sim | `npm run sim` | N real browsers play a full game with chaos | any change that could affect multiplayer |
| Voice | `npm run voice` | WebRTC audio connects between browsers | any `voice`/signaling change |

Rules of thumb:

- **Never claim a networking change works without `npm run sim`.** The legacy
  repo's history is a wall of "fix the fix" networking commits precisely because
  there was no way to prove multiplayer behavior. The sim is that proof: it
  plays real games, injects a mid-game rejoin and out-of-turn clicks, and checks
  every browser converges on the same state.
- **Never claim an animation or layout looks right without a screenshot.** A
  green test says the logic works; a screenshot says it looks right. They are
  different claims.
- `npm run sim`/`e2e`/`voice` boot the dev servers themselves if they aren't
  already up. The sim writes state screenshots to `sim-output/` every run and
  dumps full screenshots + console logs there on failure — read them first when
  it's red.

## Getting good output from the agent

- **Point it at `AGENTS.md` first.** Don't re-explain the architecture; it's
  written down and kept current (updating it is part of every milestone).
- **For bugs, ask for a failing repro test *before* the fix.** Then the green
  test — not the agent's say-so — is the proof the bug is gone. game-core bugs
  get a `*.test.ts`; protocol/networking bugs get an integration test.
- **Scope a session to one problem.** Let CI be the neutral arbiter of "done":
  it runs typecheck, lint, unit, and integration on every push.
- **For visual work, ask for a screenshot as the deliverable**, not just "done."
  Antigravity's browser tooling and artifacts (task lists, walkthroughs,
  screenshots) are built for exactly this verify-by-looking loop — lean on them.
  The design bugs found while building this app (misnamed dice images, dice
  flying over the winner screen) were caught by *looking*, not by tests.

## Design & animation guardrails

So vibecoded UI reads as intentional, not sloppy:

- Use the motion tokens in [`src/lib/motion.ts`](src/lib/motion.ts) — reuse an
  existing animation before inventing a new one. A few reused motions read as
  "designed"; many one-offs read as slop.
- Animate `transform`/`opacity` only (GPU-cheap); target 60fps.
- Always honor `prefers-reduced-motion` (the `tween`/`timeline` helpers already
  collapse to instant under it).
- The full source of truth is the **"Visual style & animation"** section of
  [`AGENTS.md`](AGENTS.md).

## Invariants an agent must never break

1. **Game state changes in exactly one place:** `applyAction` in
   [`src/game-core/reducer.ts`](src/game-core/reducer.ts). The server is the only
   thing that calls it for real. Put new rules there with tests — never in UI or
   network code.
2. **Every inbound server message is zod-validated** via `src/protocol`. Never
   `JSON.parse` client input directly.
3. **`game-core` stays pure** — no `window`, `document`, `fetch`, or timers. That
   purity is what lets the same rules run on the server and in tests.
4. **Voice is isolated** — a mic or peer-connection failure must never affect the
   game or reconnection.

## How the repo is laid out for agents

- Small, single-purpose modules over monoliths (see the layout in `AGENTS.md`).
- `legacy/` is the original vanilla-JS game — the behavioral reference for game
  rules and the source for the 3D dice port. Never delete it.
- One-command verifiers for every tier (the table above) so "prove it" is always
  a single command away.
