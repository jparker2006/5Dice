# Goal 3 — Full UI port: lobby, game, scorecard, 3D dice, PWA, deploy

## Context

Goals 1–2 delivered the Next.js scaffold, tested game-core, and a PartyKit backend with a
typed client library (`src/lib/gameClient.ts`). This goal ports the entire player-facing UI
to React and ships it. The legacy UI in `legacy/index.html`, `legacy/styles.css`,
`legacy/five-dice.js`, and `legacy/dice3d.js` is the visual/behavioral reference — keep its
personality (player colors as backgrounds, the playful dice-heavy styling) while cleaning up
the rough edges.

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
     status line "Your turn!" / "<name>'s turn".
   - Presence: "reconnecting…" badge for disconnected players; toast on join/leave/host events.
   - Game over: winner banner, confetti for the winner (port legacy behavior), tie handling,
     Play Again button.
4. **3D dice**: port `legacy/dice3d.js` as a client-only component/module. It animates rolls
   and snaps dice to the 2D dice positions when idle. If the port fights the React lifecycle,
   wrap it imperatively (ref + mount/unmount) rather than rewriting the math. A reduced-motion
   / low-power fallback to static dice faces is acceptable and should be automatic on
   `prefers-reduced-motion`.
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

## Done-criteria

- [ ] Two browsers (use the browser tools or Puppeteer against `npm run dev` +
      `npm run party:dev`) can: set names, create a 2-player room, join, play a complete game
      to game-over with correct scores, and hit Play Again into a second game.
- [ ] Mid-game page refresh on one client rejoins the same room and continues seamlessly.
- [ ] 3D dice animate on roll for both the roller and the observer; reduced-motion fallback works.
- [ ] Lighthouse PWA installability passes; a deploy followed by another deploy does not
      leave clients on stale JS (verify SW update behavior).
- [ ] Mobile viewport (375px) walkthrough shows no broken layout on any screen.
- [ ] Lint, typecheck, all tests, CI green. README documents deploy steps.
