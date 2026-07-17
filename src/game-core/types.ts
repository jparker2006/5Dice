/**
 * Pure type definitions for the 5 Dice game engine.
 *
 * This module has zero runtime dependencies and never touches the DOM, the
 * network, or global state. It is the single source of truth for game rules,
 * shared verbatim between the client and the authoritative server.
 */

/** The six upper-section categories (ones through sixes). */
export const UPPER_CATEGORIES = [
  "ones",
  "twos",
  "threes",
  "fours",
  "fives",
  "sixes",
] as const;

/** The seven lower-section categories a player actively chooses to score. */
export const LOWER_CATEGORIES = [
  "chance",
  "three-kind",
  "four-kind",
  "full-house",
  "sm-straight",
  "lg-straight",
  "five-dice",
] as const;

/**
 * The 13 categories a player fills over a game. Filling all 13 for every
 * player ends the game.
 */
export const SCOREABLE_CATEGORIES = [
  ...UPPER_CATEGORIES,
  ...LOWER_CATEGORIES,
] as const;

/**
 * "bonus-5s" is the Yahtzee-style bonus: it is never chosen directly, only
 * awarded automatically (+100) when a player rolls a fifth-of-a-kind after
 * already scoring "five-dice" as 50.
 */
export const ALL_CATEGORIES = [...SCOREABLE_CATEGORIES, "bonus-5s"] as const;

export type UpperCategory = (typeof UPPER_CATEGORIES)[number];
export type LowerCategory = (typeof LOWER_CATEGORIES)[number];
export type ScoreableCategory = (typeof SCOREABLE_CATEGORIES)[number];
export type Category = (typeof ALL_CATEGORIES)[number];

export type PlayerId = string;

/** A single die face value, 1–6. */
export type DieValue = 1 | 2 | 3 | 4 | 5 | 6;

/** A per-player scorecard. `null` means the category is still open. */
export type ScoreCard = Record<Category, number | null>;

export type GamePhase = "playing" | "gameover";

/**
 * The complete, serializable state of one game. The authoritative server owns
 * exactly one of these per room; clients receive copies and render them.
 */
export interface GameState {
  /** Seating order. `players[0]` acts first; turn order follows the array. */
  readonly players: readonly PlayerId[];
  /** Index into `players` whose turn it currently is. */
  readonly currentPlayerIndex: number;
  /** 1-based round number; increments when the turn wraps back to players[0]. */
  readonly round: number;
  /** The five current die faces. */
  readonly dice: readonly number[];
  /** Which dice are held (kept) for the next roll. */
  readonly held: readonly boolean[];
  /** Rolls remaining this turn, 0–3. A turn starts at 3. */
  readonly rollsLeft: number;
  /** Every player's scorecard, keyed by player id. */
  readonly scores: Readonly<Record<PlayerId, ScoreCard>>;
  readonly phase: GamePhase;
  /** Populated only when `phase === "gameover"`; may hold multiple on a tie. */
  readonly winners: readonly PlayerId[];
}

export type GameAction =
  | { type: "roll" }
  | { type: "toggleHold"; index: number }
  | { type: "score"; category: ScoreableCategory };

export type GameError =
  | "not-your-turn"
  | "game-over"
  | "no-rolls-left"
  | "must-roll-first"
  | "invalid-die-index"
  | "invalid-category"
  | "category-already-scored";

export interface ApplyOptions {
  /** The player attempting the action (server maps connection → id). */
  readonly actor: PlayerId;
  /** Injected randomness so rolls are deterministic under test. */
  readonly rng: Rng;
}

export type ApplyResult =
  | { ok: true; state: GameState }
  | { ok: false; error: GameError };

/** A random source returning a float in [0, 1), matching `Math.random`. */
export type Rng = () => number;
