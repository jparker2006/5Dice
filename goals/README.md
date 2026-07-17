# 5Dice Rebuild — Goals

Four sequential goals take this repo from a vanilla-JS P2P prototype to a Next.js app with
server-authoritative networking on PartyKit, plus a first-class agentic-coding harness.

Run them in order. Each goal's brief contains full context and explicit done-criteria, so a
fresh session can execute it without any other context. Launch each one with:

```
/goal read goals/GOAL-1-foundation.md and execute it, looping until the done-criteria are green.
/goal read goals/GOAL-2-networking.md and execute it, looping until the done-criteria are green.
/goal read goals/GOAL-3-ui-port.md and execute it, looping until the done-criteria are green.
/goal read goals/GOAL-4-harness-and-voice.md and execute it, looping until the done-criteria are green.
```

## Checklist

- [ ] **Goal 1 — Foundation**: Next.js + TS scaffold, pure `game-core` with unit tests, AGENTS.md, lint, CI
- [ ] **Goal 2 — Networking**: PartyKit room server, zod protocol, server-side RNG, reconnect/rejoin, multi-client test
- [ ] **Goal 3 — UI port**: Lobby/game/scorecard in React, 3D dice, PWA, deployed to Vercel + PartyKit
- [ ] **Goal 4 — Harness + voice**: Puppeteer multi-browser sim, voice chat over new signaling, HARNESS.md

## Standing decisions (do not relitigate)

- **Backend**: PartyKit (one party instance per game room, authoritative state, WebSockets).
- **Frontend**: Next.js App Router + TypeScript, deployed on Vercel.
- **Scope**: 5 Dice only — tic-tac-toe is NOT ported. Voice chat, PWA install, and 3D dice ARE ported.
- **Fork strategy**: diverge freely; no requirement to stay mergeable with upstream JefParker/5Dice.
- **Trust model**: the server rolls all dice and validates every action. Clients are renderers.
- **Legacy code** moves to `legacy/` untouched — it is the reference implementation for game rules
  and the source for the 3D dice port. Never delete it during these goals.
