# Goal 2 — Server-authoritative networking on PartyKit

## Context

Goal 1 delivered a Next.js scaffold and a pure, tested `src/game-core/` reducer. This goal
replaces the legacy P2P WebRTC mesh + public MQTT signaling with a server-authoritative
design: a PartyKit server holds the one true `GameState` per room, rolls all dice with
server-side RNG, validates every action through the game-core reducer, and broadcasts state.
Clients never mutate game state locally.

Why: the legacy mesh (see `legacy/app.js`) suffered endless desync/reconnect races because
every peer held its own state and reconciled heuristically. With one authoritative actor per
room, reconnect becomes "resubscribe and receive current state."

## Design

- **Two party types** in `party/`:
  - `lobby` (singleton): tracks open rooms (id, name, host name, seats, status), broadcasts
    room list updates, relays lobby chat with recent-message replay for late joiners.
  - `room` (one instance per game): seats players, starts the game when full, owns
    `GameState`, applies actions via `applyAction` from game-core, broadcasts resulting state.
- **Protocol** in `src/protocol/`: zod schemas for every client→server and server→client
  message. Server validates every inbound message; invalid or out-of-turn messages get a
  typed error reply, never a crash. Include a protocol version field.
- **Identity/rejoin**: client keeps a persistent `playerId` (UUID) + display name + color in
  localStorage, sent on connect. If a `playerId` reconnects to a room it belongs to, it is
  re-seated and receives full current state. Room marks players connected/disconnected and
  broadcasts presence so UIs can show "reconnecting…".
- **Dice**: rolled only on the server. `roll` request → server generates values for unheld
  dice → broadcasts. Clients cannot supply dice values.
- **Lifecycle**: rooms expire after all players disconnect for N minutes (use PartyKit
  storage/alarms). Game-over allows "play again" which resets state with a new random first
  player, all server-side.

## Tasks

1. Add PartyKit to the repo (`partykit` dev dependency, `partykit.json`), with `npm run
   party:dev` and instructions for `partykit deploy`.
2. Implement lobby + room parties per the design above, importing game-core (server and
   client share the same reducer types).
3. Implement `src/protocol/` zod schemas + TypeScript types inferred from them.
4. Thin client library `src/lib/gameClient.ts`: connect, join, send actions, subscribe to
   state — no React dependency (Goal 3 wraps it in hooks). Auto-reconnect with backoff.
5. **Multi-client integration test** (Vitest, Node ws clients against `partykit dev` started
   by the test or a script): three simulated clients create a room, join, play a scripted
   full game to completion. Assertions: turn order enforced (out-of-turn actions rejected),
   scores match game-core expectations, all clients receive identical final state.
6. **Disconnect/rejoin test**: mid-game, one client drops its socket, reconnects with the same
   playerId, and receives full correct state; the game completes normally afterward.
7. **Anti-cheat test**: a client sending a crafted message with its own dice values or a
   score for an opponent gets rejected and state is unchanged.

## Done-criteria

- [ ] `npm run party:dev` starts the PartyKit server clean.
- [ ] Integration test: full 3-player scripted game completes; all clients converge on
      identical final state; winner matches game-core calculation.
- [ ] Disconnect/rejoin test passes: dropped client resumes with correct state and the game
      finishes.
- [ ] Anti-cheat test passes: forged dice/score/out-of-turn messages are rejected with typed
      errors and no state change.
- [ ] All inbound server messages are zod-validated (grep: no `JSON.parse` result used
      without schema parse in `party/`).
- [ ] `AGENTS.md` updated for the new server layer: `party:dev`/`test:integration` in the
      Commands table, and the architecture/layout reflecting `party/` and `src/protocol/`.
- [ ] Lint, typecheck, unit tests, and CI still green (add the integration tests to CI).
