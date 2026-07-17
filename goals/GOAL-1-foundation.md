# Goal 1 — Foundation: Next.js scaffold, pure game core, agent harness basics

## Context

This repo (fork of JefParker/5Dice) is a vanilla-JS P2P multiplayer Yahtzee PWA. We are
rebuilding it as a Next.js + TypeScript app with server-authoritative networking (PartyKit,
added in Goal 2). This goal lays the foundation: project scaffold, extracted-and-tested game
rules, and the tooling that gives coding agents a fast feedback loop.

The legacy game rules live in `five-dice.js` (`calculate5DiceScore`, `check5DiceGameOver`,
turn-order logic in `sync5DiceState`) and are nearly pure already. They are the reference
implementation — behavior parity matters, including quirks:

- Categories: ones–sixes, chance, three-kind, four-kind, full-house (25), sm-straight (30),
  lg-straight (40), five-dice (50), bonus-5s (Yahtzee bonus: +100 per extra five-of-a-kind,
  only if five-dice was already scored 50).
- Upper bonus: +35 if upper total ≥ 63. Full house also scores 25 for five-of-a-kind.
- 13 turns; 3 rolls per turn; held dice persist between rolls within a turn.

## Tasks

1. Move all current files (`app.js`, `five-dice.js`, `dice3d.js`, `index.html`, `styles.css`,
   `sw.js`, `manifest.json`, `images/`, simulate/test scripts) into `legacy/`. Keep them
   working as reference; do not modify them.
2. Scaffold Next.js (App Router, TypeScript, strict mode) at the repo root. Placeholder home
   page is fine. Use npm.
3. Create `src/game-core/` — pure TypeScript, zero DOM/network imports:
   - Types: `Category`, `PlayerId`, `GameState` (dice, held, rollsLeft, turnsLeft per player,
     scores, turn order, phase), `GameAction` (roll, toggleHold, scoreCategory, etc.).
   - `calculateScore(category, dice)` ported from legacy with identical outputs.
   - A reducer `applyAction(state, action, rng)` enforcing all rules: only current player may
     act, must roll before scoring, can't rescore a category, Yahtzee bonus, turn advance,
     game-over detection, winner calculation (ties included). RNG injected for testability.
4. Tests (Vitest): exhaustive unit tests for `calculateScore` (every category, edge cases:
   five-of-a-kind full house, straights with duplicates, zero scores), reducer tests for turn
   flow, illegal-action rejection, Yahtzee bonus, game-over/winner/tie. Property test: a full
   simulated random game always terminates with a valid scorecard.
5. Tooling: ESLint + `tsc --noEmit` typecheck script, `npm test`, and GitHub Actions CI
   running lint + typecheck + tests on push/PR.
6. Write `AGENTS.md` at repo root (symlink `CLAUDE.md` → `AGENTS.md`) covering: what the app is, architecture (Next.js client /
   PartyKit authoritative server / game-core shared rules), the invariant that only the server
   mutates game state via the game-core reducer, commands (dev, test, lint, typecheck, sim),
   and pointer to `legacy/` as the behavioral reference.
7. Update `README.md`: what the project is, credit to the original by JefParker, dev setup.

## Done-criteria

- [ ] `npm run dev` serves the Next.js placeholder without errors.
- [ ] `npm test` passes; `calculateScore` has 100% branch coverage; reducer covers every action type.
- [ ] Scoring parity: a test file of fixed dice/category vectors produces identical results to
      legacy `calculate5DiceScore` (verify by running the legacy function in the test).
- [ ] `npm run lint` and `npm run typecheck` pass clean.
- [ ] CI workflow is green on GitHub for the pushed branch.
- [ ] AGENTS.md exists (with CLAUDE.md symlinked to it) and accurately describes commands (verify each command it lists actually runs).
