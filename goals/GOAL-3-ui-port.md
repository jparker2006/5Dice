# Goal 3 — Full UI port: lobby, game, scorecard, 3D dice, PWA, deploy

## Context

Goals 1–2 delivered the Next.js scaffold, tested game-core, and a PartyKit backend with a
typed client library (`src/lib/gameClient.ts`). This goal ports the entire player-facing UI
to React and ships it. The legacy UI in `legacy/index.html`, `legacy/styles.css`,
`legacy/five-dice.js`, and `legacy/dice3d.js` is the visual/behavioral reference — keep its
personality (player colors as backgrounds, the playful dice-heavy styling) while cleaning up
the rough edges.

**Polish is a headline feature of this milestone, not a nice-to-have.** The game should feel
tactile and delightful — animation is a first-class deliverable here. Use **GSAP**
([gsap.com](https://gsap.com), free, all plugins) as the animation library throughout, per the
"Visual style & animation" section of `AGENTS.md`. And because this is visual work, **verify it
in a real browser** (Antigravity's browser tools or Claude Browser) as you go — a passing test
doesn't tell you whether an animation eases correctly or the layout holds at 375px; a screenshot
does.

Scope reminders: 5 Dice only (no tic-tac-toe). Voice chat is Goal 4 — leave mic/speaker
buttons out for now.

## Screens & features

1. **First-run settings**: display name + color picker (persisted in localStorage alongside
   the playerId from Goal 2). Reachable later via a settings gear.
2. **Lobby**: live room list from the lobby party (name, host, seats remaining, join/rejoin
   button), create-room flow (name, 2–6 players), lobby chat sidebar (collapsible on mobile),
   connection status indicator.
3. **Game screen**:
   - Dice row with hold toggling (only on your turn, only after first roll), roll button with
     rolls-left counter, turns-left counter.
   - Scorecard: your card interactive during your turn — clicking a category shows the
     computed score with commit/undo confirmation (use game-core `calculateScore` for the
     preview; the server remains authoritative on commit). Between turns show the multi-player
     comparison scorecard, sorted by total at game over.
   - Turn indicator: background color = current player's color (from legacy behavior),
     status line "Your turn!" / "<name>'s turn". Morph the background color with GSAP on turn
     change rather than snapping.
   - Presence: "reconnecting…" badge for disconnected players; toast on join/leave/host events
     (animate toasts in/out with GSAP).
   - Game over: winner banner, a celebration for the winner (GSAP timeline and/or confetti),
     tie handling, Play Again button.
4. **3D dice**: port `legacy/dice3d.js` as a client-only component/module. It animates rolls
   and snaps dice to the 2D dice positions when idle. If the port fights the React lifecycle,
   wrap it imperatively (ref + mount/unmount) rather than rewriting the math. Coordinate the
   *choreography* around the dice (roll button feedback, held-die lift, dice→scorecard handoff)
   with GSAP even where the dice faces themselves keep their existing renderer; GSAP **Flip** is
   ideal for the snap-to-position transition. A reduced-motion / low-power fallback to static
   dice faces is required and should be automatic on `prefers-reduced-motion`.
5. **State management**: a React hook wrapping gameClient (e.g. `useGameRoom`) exposing state
   + action senders. Server state is the source of truth; optimistic UI only for hold toggles.
6. **PWA**: installable app via Serwest/`@serwist/next` (manifest, icons from `legacy/images/`,
   offline shell). The app must never serve a stale JS bundle after deploy (network-first or
   proper versioned precache — this bit the legacy app, which is on cache v58).
7. **Mobile polish**: playable one-handed on a phone; wake-lock during games (port legacy
   `requestWakeLock`); safe-area insets; no horizontal scroll.
8. **Deploy**: PartyKit via `partykit deploy`, Next.js via Vercel. Wire the production
   PartyKit host through an env var. Document both in README. If credentials for either
   platform are unavailable in the session, get everything deploy-ready, verify against
   locally-running servers, and list the exact deploy commands as the only remaining manual step.

## Animation & motion system (GSAP)

Install `gsap` and register the plugins you use (`Flip` at minimum). Build a small, reused motion
system rather than one-off animations:

- **`src/lib/motion.ts`**: centralized duration and easing tokens (e.g. `durations.quick/base/slow`,
  named easings) plus a `prefersReducedMotion()` helper. Every animation reads from here so the
  whole app feels coherent. Under reduced motion, animations become instant state changes.
- **A `useGsap`/`useGSAP`-style hook or `gsap.context`** scoped per component so tweens are cleaned
  up on unmount (no leaks, no animating a removed node) — this is the usual React + GSAP footgun.
- **Signature moments to animate** (keep them tasteful and consistent):
  1. Dice roll — tumble/settle with a slight overshoot; stagger the five dice.
  2. Held die — a small lift/glow toggle.
  3. Score commit — the chosen category value pops and the dice hand off toward the scorecard.
  4. Turn change — background color morphs to the active player's color; status text swaps.
  5. Screen transitions — lobby↔game enter/leave.
  6. Winner celebration — a GSAP timeline (banner + confetti burst).
  7. Micro-interactions — button press/hover, toast in/out.

Aim for 60fps (transform/opacity only). If a specific plugin genuinely isn't free, note it and
use a free alternative rather than blocking.

## Done-criteria

- [ ] Two browsers (use Claude Browser / Antigravity browser tools or Puppeteer against
      `npm run dev` + `npm run party:dev`) can: set names, create a 2-player room, join, play a
      complete game to game-over with correct scores, and hit Play Again into a second game.
- [ ] Mid-game page refresh on one client rejoins the same room and continues seamlessly.
- [ ] **Verified in a real browser with screenshots**: capture the lobby, an in-progress turn
      (mid dice-roll), the scorecard, and the game-over/winner state — at both **375px** and
      **desktop** widths — and confirm each looks correct with **no console errors**. These
      screenshots are the acceptance evidence for the visual work.
- [ ] Dice roll, turn-change color morph, score commit, and winner celebration all animate via
      GSAP and read as smooth/intentional (not linear or janky); `prefers-reduced-motion` gives a
      clean instant fallback across every animation.
- [ ] Lighthouse PWA installability passes; a deploy followed by another deploy does not
      leave clients on stale JS (verify SW update behavior).
- [ ] Mobile viewport (375px) walkthrough shows no broken layout on any screen.
- [ ] `AGENTS.md` layout/architecture updated for the new UI + `src/lib/motion.ts`.
- [ ] Lint, typecheck, all tests, CI green. README documents deploy steps.
