# 5 Dice — Design System

The design source of truth. Every screen and component follows this. Established in Goal 5
(design-consultation + a 3-variant shotgun; the winning direction is the "felt game table").

## The memorable thing

**It should feel like gathering around a real game-night table — warm felt, ivory dice, and
gold — but alive and modern.** Every decision serves that: not a flat utility app, a *place*.

## Aesthetic: elevated felt table

A premium digital board game. A deep, warm, atmospheric table with real depth (vignette + felt
grain), a green-felt dice tray the ivory 3D dice rest in, and celebratory gold accents. The
ambient background tints toward the **current player's color** through this felt lens — player
identity survives the redesign as light on the table, not a flat flood of hex.

Reference mockups: `~/.gstack/projects/jparker2006-5Dice/designs/game-explore/` (variant A is
the north star; C contributed the green tray + per-player scorecard color coding). We interpret
them in performant hand-rolled CSS — no photographic textures, no avatar photos, no whisky-glass
props. Players are **color identities**, not faces.

## Type

Self-hosted via `next/font/google` (no runtime external requests — the PWA stays offline-capable).

- **Display — Fraunces** (`--font-display`): the gold "5 Dice" wordmark, screen titles, winner
  banner. Warm, characterful high-contrast serif with optical sizing. Weights 600–900, slightly
  tight tracking on the wordmark.
- **UI/body — Figtree** (`--font-ui`): everything else — scorecard, buttons, chips, status.
  Clean, friendly, modern; has tabular figures (`font-variant-numeric: tabular-nums`) which the
  scorecard relies on. Weights 400/500/600/700/800.

Never use Inter/Roboto/Arial/system as the brand face.

## Color

Dark-first, warm. Tokens live in `globals.css` `:root`.

| Token | Value | Role |
| --- | --- | --- |
| `--table-deep` | `#0c1310` | deepest background (vignette edge) |
| `--table` | `#13201a` | base table green-black |
| `--felt` | `#1b4634` → `#14352718` gradient | dice-tray felt interior |
| `--wood` | `#3a2a1c` / `#5b4025` | tray + panel rim (wood/leather feel) |
| `--panel` | `rgba(247,240,225,0.055)` | scorecard / card surface (warm translucent) |
| `--panel-strong` | `rgba(247,240,225,0.1)` | raised surface / open scorecard cell |
| `--line` | `rgba(232,178,74,0.18)` | hairline dividers (faint gold) |
| `--cream` | `#f5eddc` | primary text + dice ivory |
| `--cream-dim` | `rgba(245,237,220,0.62)` | secondary text |
| `--gold` | `#e8b24a` | accents, highlights, active state, numbers |
| `--gold-bright` | `#f6cf72` | wordmark high-light, hover |
| `--roll-a` / `--roll-b` | `#e0574e` / `#b12f27` | roll-button coin (radial) |
| `--green` | `#4ba36b` | connected/positive |
| `--red` | `#d9584f` | errors/full |

**Player accent colors** (identity — keep legible on felt, WCAG AA for text): the existing dark
jewel-tone set, lightly refined. Each player's color rings their chip, tints their scorecard
column header, and tints the ambient atmosphere on their turn.

## Atmosphere & materials

- **Table background**: `radial-gradient(120% 90% at 50% 22%, color-mix(current player color 26%, --table), --table-deep)` + a tiling SVG grain overlay at low opacity for felt tactility + a soft inner vignette. GSAP morphs the color-mix on turn change (`--turn-color` CSS var driven by GSAP).
- **Dice tray**: rounded rect with a `--wood` rim (gradient + inset shadow), green `--felt`
  interior, soft inner shadow so the dice sit *in* it. The 3D dice overlay renders on top.
- **Panels/cards**: `--panel` fill, 1px `--line` top highlight, soft drop shadow, `18px` radius —
  felt-covered trays, not flat divs.
- **Gold**: reserved for meaning — the wordmark, the current player, open-category previews,
  committed numbers, the grand total, wins. Don't gold everything.

## Motion (extends `src/lib/motion.ts`)

Weighty, tactile, with a soft overshoot — dice have mass. Keep tokens centralized; add
`durations.beat` (~0.6s) for set-pieces. Honor `prefers-reduced-motion` (instant, calm).

**Set-pieces** (Goal 5 adds these):
1. **Turn handoff** — background color morph + a "your turn" status beat (scale/settle) + tray glow pulse.
2. **Score commit** — the chosen value pops in gold and the row fills; dice hand off toward the card.
3. **Screen transitions** — welcome→lobby→game enter/leave (fade + rise + settle).
4. **Winner reveal** — GSAP timeline: banner bounces in, scorecard sorts to a podium order, gold confetti burst.
5. **Micro** — roll-coin press (squash + spin), held-die lift/glow, chip/room-card entrance stagger, toast in/out.

## Components at a glance

- **Roll coin**: circular, red radial with a gold ring + inset highlight; big `--font-display`
  rolls-left count. Disabled = desaturated.
- **Player chip**: pill, accent-color ring; current player gets a gold ring + 👑; "reconnecting…"
  dims + amber dot.
- **Scorecard**: felt panel; upper categories show a dice-pip glyph; open-on-your-turn cells are
  dashed-gold with a gold preview number; scored cells show the value in gold tabular figures;
  the multi-player table tints each column header to that player's color and golds the leader.
- **Dice (3D materials)**: ivory `#f4ede0` face, warm `#ddccae` bevel border, espresso `#241c14`
  pips; **held = warm gold glow/tint** (not blue).

## Rules

1. Coherence over individual cleverness. Reuse tokens; a few well-tuned motions beat many one-offs.
2. Gold means something — never decorative-everywhere.
3. Player color = identity; it must stay legible (AA) and present on every screen.
4. `prefers-reduced-motion` always yields a calm, instant, fully-playable experience.
5. No AI slop: no purple gradients, no neon, no centered-everything, no decorative blobs.
