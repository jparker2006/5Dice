# Goal 4 — Agentic harness (the priority), multi-browser sim, voice chat

## Context

Goals 1–3 shipped a deployed, playable Next.js + PartyKit rebuild. This goal delivers the
project's **most important outcome**: making this repo an excellent place to build with an AI
agent. Jake's dad works primarily through **Antigravity** and vibecoding, so the harness must
make his agent sessions faster, more reliable, and produce better-looking output on the first
try. Everything else in this goal serves that.

Three parts: (a) the flagship automated verification tool — a Puppeteer multi-browser simulation
that plays real games through the UI; (b) `HARNESS.md`, the vibecoding guide tuned for
Antigravity; and (c) voice chat, re-added on top of the new server signaling (lowest priority —
do it last, and never let it compromise the game or the harness).

Background: the legacy repo's git history is a long chain of networking fix-the-fix commits
because agents had no way to verify multiplayer behavior. `legacy/simulate_mesh*.js` are
earlier attempts at exactly this sim — finish the idea properly. The whole point of the harness
is to end that fix-the-fix cycle: give the agent a way to *see* and *prove* that a change works.

## Part A — Multi-browser simulation harness

1. `npm run sim` (Puppeteer, headless; already a dependency in the legacy package.json — add
   it properly to the new one): boots `partykit dev` + `next dev` if not running, launches N
   browser contexts (default 3, `--players=N` for 2–6), and plays a full game through the real
   UI — set names, create/join room, roll, hold, score — until game over.
2. Scripted chaos: one player's page is closed and reopened mid-game (rejoin path); one
   player attempts out-of-turn clicks (must be no-ops).
3. Assertions at game end: every browser shows the identical final scorecard; totals match an
   independent game-core computation of the action log; the declared winner is correct.
   Any console error in any browser (including during animations) fails the sim.
4. Light visual/animation smoke check: capture a screenshot at each key state (lobby, mid-roll,
   scorecard, game-over) from at least one browser and save them as run artifacts, and assert the
   dice DOM/canvas actually changes during a roll (animation ran, didn't silently no-op).
5. Output: concise pass/fail summary; always save the state screenshots, and on failure dump
   full screenshots + console logs per browser to `sim-output/` (gitignored).
6. Make it reliable: run 5 consecutive times green locally. Add a CI job (may be
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

## Part C — HARNESS.md (the vibecoding guide, tuned for Antigravity) — THE PRIORITY

This is the most valuable deliverable in the whole project. Write `HARNESS.md` at repo root for a
developer vibecoding this repo with **Antigravity** (and other agents). It should make someone's
next agent session noticeably better. Keep it genuinely readable — punchy, ≤ 2 pages, skimmable
headings, concrete commands. Contents:

1. **The verification ladder** — the core idea: never trust "it should work," prove it. In order
   of speed:
   - **Types & lint** (`npm run typecheck`, `npm run lint`) — seconds.
   - **Unit tests** (`npm test`) — game-core logic, seconds.
   - **Integration tests** (`npm run test:integration`) — the PartyKit protocol, a few seconds.
   - **Look at it in a browser** — for any UI/animation change, drive the running app with
     Antigravity's browser tools (or Claude Browser), screenshot it, check the console. A test
     says the logic works; a screenshot says it *looks* right.
   - **Full multi-browser sim** (`npm run sim`) — real multiplayer games end-to-end, minutes.
   Rule of thumb: match the tier to the change — never claim a networking change works without the
   sim, never claim an animation looks right without a screenshot.
2. **Getting good output from the agent (vibecoding tips)**:
   - Point the agent at `AGENTS.md` first; it carries the architecture, the invariant, and the
     GSAP/motion conventions.
   - For bugs, have the agent write a failing repro test *before* fixing — then the green test is
     the proof.
   - Scope a session to one problem; let CI be the neutral arbiter of "done."
   - For visual work, ask for a screenshot as the deliverable, not just "done." Antigravity's
     browser tooling and artifacts (task lists, walkthroughs, screenshots) are built for exactly
     this verify-by-looking loop — lean on them.
3. **Design & animation guardrails** (so vibecoded UI looks intentional, not sloppy): use the
   GSAP motion tokens in `src/lib/motion.ts`; reuse existing animations before inventing new ones;
   honor `prefers-reduced-motion`; animate transform/opacity only. Point to the "Visual style &
   animation" section of `AGENTS.md` as the source of truth rather than duplicating it.
4. **Repo invariants** agents must preserve: server-only state mutation via `applyAction`,
   zod-validate all inbound messages, `game-core` stays pure and DOM-free.
5. **How the repo is laid out for agents**: small modules, `AGENTS.md` orientation, the
   reference implementation in `legacy/`, and the one-command verifiers above.

Also update `AGENTS.md` (canonical; `CLAUDE.md` symlinks to it): add the `sim` command to the
Commands table, note the voice architecture, and refresh the layout/architecture for the final
shape. `AGENTS.md` is what the agent reads every session, so keeping it accurate is itself a
harness deliverable.

## Done-criteria

- [ ] `npm run sim` passes 5 consecutive runs with 3 players, including the rejoin and
      out-of-turn chaos steps, and saves per-state screenshots as artifacts each run.
- [ ] Sim failure mode verified once deliberately (break something, confirm screenshots/logs
      land in `sim-output/`, then revert).
- [ ] Voice: two headless browsers with fake media establish audio (connectionState
      'connected' on the audio peer connection); mic/speaker toggles work; a voice failure
      (e.g. blocked mic) leaves the game fully playable.
- [ ] 3+ player rooms create one audio element per remote peer.
- [ ] **HARNESS.md exists and is genuinely useful** — every command in it runs, it names the
      verification ladder (types/lint → unit → integration → browser look → sim), and it gives
      Antigravity-specific vibecoding guidance. Sanity-check it by following it cold to verify one
      small change end-to-end.
- [ ] `AGENTS.md` updated: `sim` in the Commands table, voice architecture noted, layout current.
- [ ] Lint, typecheck, all tests, CI green.
