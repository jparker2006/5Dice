# Goal 5 — Visual overhaul: make it gorgeous (and make the dice tell the truth)

## Context

Goals 1–4 shipped a fully working, tested, harnessed rebuild. This goal makes it *beautiful*.
The legacy look is explicitly **no longer a constraint** — do not feel bound to the flat dark-navy
utility styling, the emoji-in-header titles, or any other visual choice inherited from the
original. Keep the game's *spirit* (playful, tactile, family-friendly, player colors as identity)
and design something modern and genuinely gorgeous around it. GSAP stays the animation engine
and should get real set-pieces here.

Two parts: **(A)** a correctness fix in the 3D dice that must land first, because every visual
judgment depends on trusting the dice; **(B)** the design overhaul itself.

## Part A — Dice truthfulness (fix first)

**The bug:** in `src/lib/dice3d.ts`, the roll animation runs real physics, the dice visibly land,
and then the settle phase slerps each die from its physics orientation to a single canonical
quaternion per value (`getTargetRotation`). The correction can be a near-180° flip, so the dice
visibly re-rotate *after landing* — the faces shown by the tumble differ from the final values.
The roll animation must show exactly what the server rolled, with no perceptible post-landing flip.

**The fix:**

1. Precompute the **24 orientation quaternions** of a cube grouped by which face is up.
2. At settle start, for each unheld die, pick from the target value's group the quaternion
   **closest to the die's current physics orientation** (max |dot product|, accounting for the
   q/−q double cover) as the slerp target. The settle then reads as "the die comes to rest,"
   not "the die changes its mind."
3. Keep the position lerp as is; consider shortening the settle (~300ms) now that the rotation
   correction is small.
4. **Prove it:** after settle, compute each die's actual top face from its final quaternion
   (largest world-Y component among the six face normals) and expose it on the die's target
   element (e.g. `data-face-up`) or a `dice3d`-owned attribute. Add a sim assertion: after every
   watched roll on the full-motion browser, `data-face-up` per die equals the server's dice.
   This is a new rung of truth the harness can hold forever.

## Part B — The design overhaul

### Process (use the design skills)

Run this goal in a session where the gstack design skills are available and use them — this is
also a chance to exercise the harness the way Jake's dad would:

1. **`/design-consultation`** first: let it research the landscape (modern game UIs, tabletop
   apps, casual multiplayer games) and propose a complete design system — aesthetic direction,
   typography (load real fonts via `next/font`), color system (dark-first; player colors must
   stay legible as identity), surface/depth language, spacing, and motion personality.
   **`/design-shotgun`** is the alternative if multiple candidate directions deserve a visual
   bake-off — generate variants, compare, pick. Use judgment on which fits the session; either
   must end with a written design system the implementation follows.
2. Implement (see scope below).
3. **`/design-review`** (or `/qa` + screenshots if unavailable) at the end: a designer's-eye pass
   over every screen at 375px and desktop, fixing visual inconsistencies, spacing issues, and any
   AI-slop patterns it finds.

If the gstack skills are unavailable in the session, don't block: do the research-and-system step
manually with the same rigor (write the system down in `DESIGN.md` before implementing).

### Scope — every screen, no survivors

- **Settings/welcome**: first impression — make it feel like the cover of a great board game,
  not a form. Name + color selection can be delightful (e.g. dice motif, color swatches that
  feel like game pieces).
- **Lobby**: room cards with real visual hierarchy, an inviting empty state, chat that feels
  like a family table, status indicators that read at a glance.
- **Game screen**: this is the star. The table (background) should feel like a *place* — depth,
  texture or gradient atmosphere, not a flat fill. Player-color identity must survive the
  redesign (background still morphs to the current player's color, but through the new system's
  lens — e.g. tinting the atmosphere rather than flooding a flat hex). Dice tray, roll button,
  seat chips, and scorecard all redesigned coherently. The scorecard is data-dense — give it
  real typographic structure (tabular numerals, weight hierarchy, clear open-vs-scored states).
- **3D dice materials**: restyle the dice faces/materials to match the new aesthetic (the canvas
  textures in `dice3d.ts` are trivially restylable — ivory/pearl, rounded pips, subtle bevel
  feel; held tint that matches the new palette rather than bootstrap blue).
- **Game over**: a real celebration set-piece — winner reveal choreographed with a GSAP timeline
  (podium/table sort animation, confetti tuned to the palette, staggered score reveal).
- **GSAP set-pieces** (beyond restyling): screen-to-screen transitions, scorecard commit
  choreography (value flies/pops into the row), turn-handoff moment (a beat that says "your
  turn!" — e.g. status + tray pulse), lobby card entrance stagger. All through `motion.ts`
  tokens; extend the token set if the new system needs more nuance (it may — e.g. `durations.beat`
  for set-pieces). `prefers-reduced-motion` still yields a calm, instant experience.
- **App chrome**: favicon + PWA icons regenerated to match the new identity (replace the legacy
  PNGs in `public/images/`), manifest theme colors updated, `<title>`/description polish.

### Constraints

- Pure restyle + choreography: **no game-logic, protocol, or server changes** (Part A is the only
  behavioral change). The sim must keep passing untouched except for the new dice-truth assertion
  and any selector updates the redesign forces (keep `data-testid`s stable so it needs none).
- Keep bundle discipline: fonts via `next/font` (self-hosted, no external requests at runtime —
  the PWA must stay offline-capable), no new heavyweight UI libraries. CSS stays hand-rolled.
- Accessibility: contrast ≥ WCAG AA for text on every surface (including on player colors),
  visible focus states, touch targets ≥ 44px on mobile.

## Done-criteria

- [ ] **Dice truth**: the sim asserts settled 3D faces == server dice on every watched roll,
      and passes 3× consecutively; manually verified once in a real browser (roll, screenshot,
      compare against the scorecard preview numbers).
- [ ] A written design system exists (from `/design-consultation` / `/design-shotgun`, or
      `DESIGN.md`) and the implementation demonstrably follows it.
- [ ] Every screen (welcome, lobby, waiting, in-game turn, commit overlay, game over) captured
      at 375px and desktop in the new design, with **no console errors** — and each passes a
      designer's-eye review (`/design-review` if available) with findings fixed.
- [ ] The GSAP set-pieces (screen transitions, commit choreography, turn handoff, winner reveal)
      exist, run at 60fps-feel, use motion tokens, and collapse cleanly under reduced motion.
- [ ] Player-color identity is preserved and legible throughout; contrast spot-checks pass.
- [ ] New app icons/favicon/manifest colors shipped; PWA still installable with no stale-JS.
- [ ] `npm run sim` (3 players) and `npm run voice` green; lint, typecheck, all tests, CI green.
- [ ] `AGENTS.md` "Visual style & animation" updated to describe the new design system (name the
      fonts, palette roles, and set-pieces) so future agent sessions extend it instead of
      reinventing it.
