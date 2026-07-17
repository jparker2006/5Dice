# Goal 4 — Agentic harness (multi-browser sim), voice chat, HARNESS.md

## Context

Goals 1–3 shipped a deployed, playable Next.js + PartyKit rebuild. This goal finishes the two
remaining pieces: (a) the flagship verification tool — a Puppeteer multi-browser simulation —
plus documentation that makes this repo a great environment for agentic coding (this harness
is explicitly for Jake's dad, who builds with coding agents), and (b) voice chat, re-added on
top of the new server signaling.

Background: the legacy repo's git history is a long chain of networking fix-the-fix commits
because agents had no way to verify multiplayer behavior. `legacy/simulate_mesh*.js` are
earlier attempts at exactly this sim — finish the idea properly.

## Part A — Multi-browser simulation harness

1. `npm run sim` (Puppeteer, headless; already a dependency in the legacy package.json — add
   it properly to the new one): boots `partykit dev` + `next dev` if not running, launches N
   browser contexts (default 3, `--players=N` for 2–6), and plays a full game through the real
   UI — set names, create/join room, roll, hold, score — until game over.
2. Scripted chaos: one player's page is closed and reopened mid-game (rejoin path); one
   player attempts out-of-turn clicks (must be no-ops).
3. Assertions at game end: every browser shows the identical final scorecard; totals match an
   independent game-core computation of the action log; the declared winner is correct.
   Any console error in any browser fails the sim.
4. Output: concise pass/fail summary; on failure, dump screenshots + console logs per browser
   to `sim-output/` (gitignored).
5. Make it reliable: run 5 consecutive times green locally. Add a CI job (may be
   `workflow_dispatch`/nightly rather than per-push if runtime is long).

## Part B — Voice chat

1. WebRTC audio (mic) between players in a room, signaled through the PartyKit room party
   (offer/answer/ICE relay messages added to the zod protocol). No public MQTT, no public
   TURN. STUN: Google public STUN is fine; document that TURN is not configured and
   symmetric-NAT users may not get voice (game must be unaffected).
2. Mic and speaker toggle buttons in the game screen (port legacy UI affordances, including
   the "someone's mic is on" indicator). Mic permission requested only on first enable.
3. Support 3+ players: one audio element per remote peer (the legacy app had a single shared
   element — a known bug; fix it here).
4. Voice must be fully isolated: voice failure never affects game state or reconnection.
   Puppeteer test with fake media streams (`--use-fake-ui-for-media-stream`,
   `--use-fake-device-for-media-stream`) verifying two browsers establish an audio connection.

## Part C — HARNESS.md (the agentic-coding guide for Dad)

Write `HARNESS.md` at repo root, written for a developer using Claude Code (or similar) on
this repo. Contents:

1. **The feedback-loop ladder**: unit tests (`npm test`, seconds) → integration tests
   (`npm run test:integration`) → full sim (`npm run sim`, minutes) — and when to reach for
   each. Rule of thumb: never claim a networking change works without the tier that exercises it.
2. **Workflow habits**: write a failing repro test before fixing any bug; use plan mode for
   architectural changes; one problem per session; let CI be the arbiter.
3. **Repo invariants** agents must preserve (server-only state mutation, zod-validate all
   inbound messages, game-core stays pure and DOM-free).
4. **How this repo is laid out for agents**: small modules, CLAUDE.md orientation, where the
   reference implementation lives (`legacy/`).
5. Keep it short enough to actually read (≤ 2 pages).

Also update CLAUDE.md with the sim command and voice architecture.

## Done-criteria

- [ ] `npm run sim` passes 5 consecutive runs with 3 players, including the rejoin and
      out-of-turn chaos steps.
- [ ] Sim failure mode verified once deliberately (break something, confirm screenshots/logs
      land in `sim-output/`, then revert).
- [ ] Voice: two headless browsers with fake media establish audio (connectionState
      'connected' on the audio peer connection); mic/speaker toggles work; a voice failure
      (e.g. blocked mic) leaves the game fully playable.
- [ ] 3+ player rooms create one audio element per remote peer.
- [ ] HARNESS.md exists, is accurate (every command in it runs), and CLAUDE.md is updated.
- [ ] Lint, typecheck, all tests, CI green.
