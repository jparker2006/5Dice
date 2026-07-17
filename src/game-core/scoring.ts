import {
  UPPER_CATEGORIES,
  LOWER_CATEGORIES,
  type Category,
  type ScoreableCategory,
  type ScoreCard,
} from "./types";

/** Upper-section bonus is awarded when the upper total reaches this. */
export const UPPER_BONUS_THRESHOLD = 63;
export const UPPER_BONUS_VALUE = 35;

/** Tally how many of each face (1–6) appear in a set of dice. */
function faceCounts(dice: readonly number[]): Record<number, number> {
  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  // Dice are always 1–6 (guaranteed by the reducer), so every key is present.
  for (const d of dice) counts[d]! += 1;
  return counts;
}

/**
 * Score a set of five dice for a single category. Pure and total — every
 * category returns a number, invalid combinations return 0. This is the
 * behavioral port of the legacy `calculate5DiceScore`; parity is asserted in
 * scoring.test.ts against the original source.
 */
export function calculateScore(
  category: ScoreableCategory,
  dice: readonly number[],
): number {
  const counts = faceCounts(dice);
  const sum = dice.reduce((a, b) => a + b, 0);
  const hasN = (n: number): boolean =>
    Object.values(counts).some((c) => c >= n);

  switch (category) {
    case "ones":
      return counts[1]! * 1;
    case "twos":
      return counts[2]! * 2;
    case "threes":
      return counts[3]! * 3;
    case "fours":
      return counts[4]! * 4;
    case "fives":
      return counts[5]! * 5;
    case "sixes":
      return counts[6]! * 6;
    case "chance":
      return sum;
    case "three-kind":
      return hasN(3) ? sum : 0;
    case "four-kind":
      return hasN(4) ? sum : 0;
    case "full-house": {
      const vals = Object.values(counts);
      return (vals.includes(3) && vals.includes(2)) || hasN(5) ? 25 : 0;
    }
    case "sm-straight":
      if (counts[1] && counts[2] && counts[3] && counts[4]) return 30;
      if (counts[2] && counts[3] && counts[4] && counts[5]) return 30;
      if (counts[3] && counts[4] && counts[5] && counts[6]) return 30;
      return 0;
    case "lg-straight":
      if (counts[1] && counts[2] && counts[3] && counts[4] && counts[5])
        return 40;
      if (counts[2] && counts[3] && counts[4] && counts[5] && counts[6])
        return 40;
      return 0;
    case "five-dice":
      return hasN(5) ? 50 : 0;
  }
}

/** Sum of the upper section (ones–sixes), ignoring open categories. */
export function upperTotal(card: ScoreCard): number {
  return UPPER_CATEGORIES.reduce((sum, c) => sum + (card[c] ?? 0), 0);
}

/** The +35 upper bonus, if earned. */
export function upperBonus(card: ScoreCard): number {
  return upperTotal(card) >= UPPER_BONUS_THRESHOLD ? UPPER_BONUS_VALUE : 0;
}

/** Sum of the lower section, including the Yahtzee "bonus-5s". */
export function lowerTotal(card: ScoreCard): number {
  const lower = LOWER_CATEGORIES.reduce((sum, c) => sum + (card[c] ?? 0), 0);
  return lower + (card["bonus-5s"] ?? 0);
}

/** Final score for a scorecard: upper + upper bonus + lower + bonus-5s. */
export function grandTotal(card: ScoreCard): number {
  return upperTotal(card) + upperBonus(card) + lowerTotal(card);
}

/** A fresh scorecard with every category open. */
export function emptyScoreCard(): ScoreCard {
  const card = {} as ScoreCard;
  const all: Category[] = [...UPPER_CATEGORIES, ...LOWER_CATEGORIES, "bonus-5s"];
  for (const c of all) card[c] = null;
  return card;
}
