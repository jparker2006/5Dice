import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  calculateScore,
  emptyScoreCard,
  grandTotal,
  lowerTotal,
  upperBonus,
  upperTotal,
} from "./scoring";
import { SCOREABLE_CATEGORIES, type ScoreCard } from "./types";

describe("calculateScore — upper section", () => {
  it("counts matching faces times their value", () => {
    expect(calculateScore("ones", [1, 1, 1, 2, 3])).toBe(3);
    expect(calculateScore("twos", [2, 2, 5, 6, 1])).toBe(4);
    expect(calculateScore("threes", [3, 3, 3, 3, 3])).toBe(15);
    expect(calculateScore("fours", [1, 2, 3, 5, 6])).toBe(0);
    expect(calculateScore("fives", [5, 5, 1, 1, 1])).toBe(10);
    expect(calculateScore("sixes", [6, 6, 6, 6, 1])).toBe(24);
  });
});

describe("calculateScore — lower section", () => {
  it("chance sums all dice", () => {
    expect(calculateScore("chance", [1, 2, 3, 4, 5])).toBe(15);
    expect(calculateScore("chance", [6, 6, 6, 6, 6])).toBe(30);
  });

  it("three-kind and four-kind sum all dice only when the count is met", () => {
    expect(calculateScore("three-kind", [3, 3, 3, 1, 2])).toBe(12);
    expect(calculateScore("three-kind", [3, 3, 1, 4, 2])).toBe(0);
    expect(calculateScore("four-kind", [5, 5, 5, 5, 2])).toBe(22);
    expect(calculateScore("four-kind", [5, 5, 5, 1, 2])).toBe(0);
    // Five-of-a-kind satisfies both three- and four-kind.
    expect(calculateScore("three-kind", [4, 4, 4, 4, 4])).toBe(20);
    expect(calculateScore("four-kind", [4, 4, 4, 4, 4])).toBe(20);
  });

  it("full-house scores 25 for a 3+2, and for five-of-a-kind", () => {
    expect(calculateScore("full-house", [2, 2, 2, 5, 5])).toBe(25);
    expect(calculateScore("full-house", [2, 2, 2, 2, 5])).toBe(0);
    expect(calculateScore("full-house", [3, 3, 3, 3, 3])).toBe(25);
    expect(calculateScore("full-house", [1, 2, 3, 4, 5])).toBe(0);
  });

  it("small straight scores 30 for any four-in-a-row", () => {
    expect(calculateScore("sm-straight", [1, 2, 3, 4, 6])).toBe(30);
    expect(calculateScore("sm-straight", [2, 3, 4, 5, 5])).toBe(30);
    expect(calculateScore("sm-straight", [3, 4, 5, 6, 1])).toBe(30);
    expect(calculateScore("sm-straight", [1, 2, 3, 5, 6])).toBe(0);
    // Duplicates within a run still count.
    expect(calculateScore("sm-straight", [1, 2, 2, 3, 4])).toBe(30);
  });

  it("large straight scores 40 for a full five-in-a-row", () => {
    expect(calculateScore("lg-straight", [1, 2, 3, 4, 5])).toBe(40);
    expect(calculateScore("lg-straight", [2, 3, 4, 5, 6])).toBe(40);
    expect(calculateScore("lg-straight", [1, 2, 3, 4, 6])).toBe(0);
  });

  it("five-dice scores 50 for five-of-a-kind", () => {
    expect(calculateScore("five-dice", [6, 6, 6, 6, 6])).toBe(50);
    expect(calculateScore("five-dice", [6, 6, 6, 6, 1])).toBe(0);
  });
});

/**
 * Parity: run the ORIGINAL `calculate5DiceScore` extracted from
 * legacy/five-dice.js and confirm our TypeScript port produces identical
 * results for every possible roll. This is the guarantee that the rewrite
 * didn't quietly change any scoring behavior.
 */
describe("calculateScore — parity with legacy source", () => {
  const legacyScore = loadLegacyScorer();

  it("matches legacy for all 7776 dice combinations across every category", () => {
    let compared = 0;
    for (const dice of allDiceCombos()) {
      for (const category of SCOREABLE_CATEGORIES) {
        expect(calculateScore(category, dice)).toBe(legacyScore(category, dice));
        compared++;
      }
    }
    expect(compared).toBe(6 ** 5 * SCOREABLE_CATEGORIES.length);
  });
});

describe("scorecard totals", () => {
  it("emptyScoreCard starts every category open", () => {
    const card = emptyScoreCard();
    expect(Object.values(card).every((v) => v === null)).toBe(true);
  });

  it("totals an all-open card as zero", () => {
    const card = emptyScoreCard();
    expect(upperTotal(card)).toBe(0);
    expect(upperBonus(card)).toBe(0);
    expect(lowerTotal(card)).toBe(0);
    expect(grandTotal(card)).toBe(0);
  });

  it("awards the +35 upper bonus at exactly 63", () => {
    const card = emptyScoreCard();
    card.ones = 3;
    card.twos = 6;
    card.threes = 9;
    card.fours = 12;
    card.fives = 15;
    card.sixes = 17; // upper total 62 → no bonus
    expect(upperTotal(card)).toBe(62);
    expect(upperBonus(card)).toBe(0);
    card.sixes = 18; // upper total 63 → bonus
    expect(upperTotal(card)).toBe(63);
    expect(upperBonus(card)).toBe(35);
  });

  it("grandTotal sums upper, upper bonus, lower, and bonus-5s", () => {
    const card: ScoreCard = emptyScoreCard();
    card.ones = 3;
    card.twos = 6;
    card.threes = 9;
    card.fours = 12;
    card.fives = 15;
    card.sixes = 18; // upper 63 (+35 bonus)
    card.chance = 20;
    card["five-dice"] = 50;
    card["bonus-5s"] = 100;
    expect(upperTotal(card)).toBe(63);
    expect(upperBonus(card)).toBe(35);
    expect(lowerTotal(card)).toBe(170);
    expect(grandTotal(card)).toBe(63 + 35 + 170);
  });
});

/** Every ordered five-dice combination (6^5 = 7776). */
function* allDiceCombos(): Generator<number[]> {
  for (let a = 1; a <= 6; a++)
    for (let b = 1; b <= 6; b++)
      for (let c = 1; c <= 6; c++)
        for (let d = 1; d <= 6; d++)
          for (let e = 1; e <= 6; e++) yield [a, b, c, d, e];
}

/** Extract and evaluate the legacy scorer straight from its source file. */
function loadLegacyScorer(): (category: string, dice: number[]) => number {
  const src = readFileSync(
    new URL("../../legacy/five-dice.js", import.meta.url),
    "utf8",
  );
  const body = extractFunction(src, "calculate5DiceScore");
  return new Function(`${body}; return calculate5DiceScore;`)() as (
    category: string,
    dice: number[],
  ) => number;
}

/** Slice a named `function name(...) { ... }` declaration out of source text. */
function extractFunction(src: string, name: string): string {
  const start = src.indexOf(`function ${name}`);
  if (start === -1) throw new Error(`function ${name} not found in legacy source`);
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}
