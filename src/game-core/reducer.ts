import {
  SCOREABLE_CATEGORIES,
  type ApplyOptions,
  type ApplyResult,
  type GameAction,
  type GameState,
  type PlayerId,
  type ScoreableCategory,
} from "./types";
import { rollDie } from "./rng";
import { calculateScore, emptyScoreCard, grandTotal } from "./scoring";

export const ROLLS_PER_TURN = 3;
export const DICE_COUNT = 5;
export const YAHTZEE_BONUS = 100;

const FRESH_DICE: readonly number[] = [1, 1, 1, 1, 1];
const NO_HOLDS: readonly boolean[] = [false, false, false, false, false];

/**
 * Create the initial state for a game. `players` is the turn order; the first
 * entry acts first. The server is responsible for choosing (and randomizing)
 * that order before calling this.
 */
export function createGame(players: readonly PlayerId[]): GameState {
  const scores: Record<PlayerId, ReturnType<typeof emptyScoreCard>> = {};
  for (const p of players) scores[p] = emptyScoreCard();
  return {
    players: [...players],
    currentPlayerIndex: 0,
    round: 1,
    dice: [...FRESH_DICE],
    held: [...NO_HOLDS],
    rollsLeft: ROLLS_PER_TURN,
    scores,
    phase: "playing",
    winners: [],
  };
}

/** The id of the player whose turn it is. */
export function currentPlayer(state: GameState): PlayerId {
  return state.players[state.currentPlayerIndex]!;
}

/** Whether the current player has rolled at least once this turn. */
export function hasRolled(state: GameState): boolean {
  return state.rollsLeft < ROLLS_PER_TURN;
}

/** True once every player has filled all 13 scoreable categories. */
function isGameOver(scores: GameState["scores"]): boolean {
  return Object.values(scores).every((card) =>
    SCOREABLE_CATEGORIES.every((c) => card[c] !== null),
  );
}

/** Compute the winner(s) — the highest grand total, ties included. */
function computeWinners(
  players: readonly PlayerId[],
  scores: GameState["scores"],
): PlayerId[] {
  let best = -Infinity;
  let winners: PlayerId[] = [];
  for (const p of players) {
    const total = grandTotal(scores[p]!);
    if (total > best) {
      best = total;
      winners = [p];
    } else if (total === best) {
      winners.push(p);
    }
  }
  return winners;
}

/**
 * The one and only way game state changes. Given a state, an action, and the
 * acting player, returns either the next state or a typed error. Never mutates
 * its input and never throws on invalid input — callers get `{ ok: false }`.
 *
 * This is the invariant the whole architecture rests on: the authoritative
 * server routes every client action through here, so no client can produce a
 * state the rules forbid.
 */
export function applyAction(
  state: GameState,
  action: GameAction,
  opts: ApplyOptions,
): ApplyResult {
  if (state.phase === "gameover") return { ok: false, error: "game-over" };
  if (opts.actor !== currentPlayer(state)) {
    return { ok: false, error: "not-your-turn" };
  }

  switch (action.type) {
    case "roll":
      return applyRoll(state, opts);
    case "toggleHold":
      return applyToggleHold(state, action.index);
    case "score":
      return applyScore(state, action.category, opts.actor);
  }
}

function applyRoll(state: GameState, opts: ApplyOptions): ApplyResult {
  if (state.rollsLeft <= 0) return { ok: false, error: "no-rolls-left" };
  const dice = state.dice.map((value, i) =>
    state.held[i] ? value : rollDie(opts.rng),
  );
  return {
    ok: true,
    state: { ...state, dice, rollsLeft: state.rollsLeft - 1 },
  };
}

function applyToggleHold(state: GameState, index: number): ApplyResult {
  if (!hasRolled(state)) return { ok: false, error: "must-roll-first" };
  if (!Number.isInteger(index) || index < 0 || index >= DICE_COUNT) {
    return { ok: false, error: "invalid-die-index" };
  }
  const held = state.held.map((h, i) => (i === index ? !h : h));
  return { ok: true, state: { ...state, held } };
}

function applyScore(
  state: GameState,
  category: ScoreableCategory,
  actor: PlayerId,
): ApplyResult {
  if (!hasRolled(state)) return { ok: false, error: "must-roll-first" };
  if (!SCOREABLE_CATEGORIES.includes(category)) {
    return { ok: false, error: "invalid-category" };
  }
  const card = state.scores[actor]!;
  if (card[category] !== null) {
    return { ok: false, error: "category-already-scored" };
  }

  const value = calculateScore(category, state.dice);
  const nextCard = { ...card, [category]: value };

  // Yahtzee bonus: a fresh five-of-a-kind scored in any category *other than*
  // five-dice earns +100, but only once five-dice itself is locked in at 50.
  const isFiveOfAKind = state.dice.every((d) => d === state.dice[0]);
  if (
    category !== "five-dice" &&
    isFiveOfAKind &&
    card["five-dice"] === 50
  ) {
    nextCard["bonus-5s"] = (card["bonus-5s"] ?? 0) + YAHTZEE_BONUS;
  }

  const scores = { ...state.scores, [actor]: nextCard };

  if (isGameOver(scores)) {
    return {
      ok: true,
      state: {
        ...state,
        scores,
        phase: "gameover",
        winners: computeWinners(state.players, scores),
        dice: [...FRESH_DICE],
        held: [...NO_HOLDS],
        rollsLeft: ROLLS_PER_TURN,
      },
    };
  }

  const nextIndex = (state.currentPlayerIndex + 1) % state.players.length;
  const round = nextIndex === 0 ? state.round + 1 : state.round;
  return {
    ok: true,
    state: {
      ...state,
      scores,
      currentPlayerIndex: nextIndex,
      round,
      dice: [...FRESH_DICE],
      held: [...NO_HOLDS],
      rollsLeft: ROLLS_PER_TURN,
    },
  };
}
