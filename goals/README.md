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

- [x] **Goal 1 — Foundation**: Next.js + TS scaffold, pure `game-core` with unit tests, AGENTS.md, lint, CI
- [x] **Goal 2 — Networking**: PartyKit room server, zod protocol, server-side RNG, reconnect/rejoin, multi-client test
- [x] **Goal 3 — UI port**: Lobby/game/scorecard in React, GSAP motion system, 3D dice, PWA, deploy-ready (deploy commands documented; needs PartyKit/Vercel logins)
- [x] **Goal 4 — Harness + voice**: N-player Puppeteer sim (`npm run sim`), WebRTC voice chat, HARNESS.md

## The overarching priority: a great agentic-coding harness

The single most important outcome of this project is that the repo becomes an **excellent place
to vibecode with an AI agent** — because the person maintaining it (Jake's dad) works primarily
through [Antigravity](https://antigravity.google) and coding agents. Every goal must leave the
harness better: fast feedback loops, browser-based visual verification, a rich `AGENTS.md`, and
guardrails that make agent output look and behave well on the first try. When a goal decision
trades off against harness quality, favor the harness.

## Standing decisions (do not relitigate)

- **Backend**: PartyKit (one party instance per game room, authoritative state, WebSockets).
- **Frontend**: Next.js App Router + TypeScript, deployed on Vercel.
- **Animation**: **GSAP** ([gsap.com](https://gsap.com), free) is the animation library — the
  game should feel tactile and polished (tumbling dice, popping scores, morphing turn colors).
  Centralize motion tokens; always honor `prefers-reduced-motion`. See `AGENTS.md`.
- **Scope**: 5 Dice only — tic-tac-toe is NOT ported. Voice chat, PWA install, and 3D dice ARE ported.
- **Fork strategy**: diverge freely; no requirement to stay mergeable with upstream JefParker/5Dice.
- **Trust model**: the server rolls all dice and validates every action. Clients are renderers.
- **Agent tooling**: the target agent is **Antigravity**, so `AGENTS.md` is the canonical agent
  guide (`CLAUDE.md` symlinks to it). Keep it current as the architecture evolves.
- **Verification**: any UI/animation work must be verified in a **real browser** (Antigravity's
  browser tools, or Claude Browser) — screenshot it, exercise the flow, check the console, check
  mobile + desktop — not just via unit tests.
- **Legacy code** moves to `legacy/` untouched — it is the reference implementation for game rules
  and the source for the 3D dice port. Never delete it during these goals.
