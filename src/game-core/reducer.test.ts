import { describe, expect, it } from "vitest";
import {
  applyAction,
  createGame,
  currentPlayer,
  hasRolled,
  ROLLS_PER_TURN,
} from "./reducer";
import { makeSeededRng } from "./rng";
import { grandTotal } from "./scoring";
import {
  SCOREABLE_CATEGORIES,
  type GameState,
  type Rng,
  type ScoreableCategory,
} from "./types";

/** An RNG that yields exactly the given die faces (cycling if exhausted). */
function riggedRng(faces: number[]): Rng {
  let i = 0;
  return () => {
    const v = faces[i % faces.length]!;
    i++;
    return (v - 0.5) / 6; // lands mid-bucket → rollDie returns v
  };
}

/** Apply an action for the current player, asserting it succeeds. */
function ok(
  state: GameState,
  action: Parameters<typeof applyAction>[1],
  rng: Rng = riggedRng([1, 2, 3, 4, 5]),
): GameState {
  const res = applyAction(state, action, { actor: currentPlayer(state), rng });
  if (!res.ok) throw new Error(`expected ok, got error: ${res.error}`);
  return res.state;
}

/** Roll once then score a category for the current player. */
function playTurn(
  state: GameState,
  category: ScoreableCategory,
  faces: number[] = [1, 2, 3, 4, 5],
): GameState {
  const rolled = ok(state, { type: "roll" }, riggedRng(faces));
  return ok(rolled, { type: "score", category });
}

describe("createGame", () => {
  it("initializes a clean playing state", () => {
    const s = createGame(["A", "B"]);
    expect(s.players).toEqual(["A", "B"]);
    expect(s.currentPlayerIndex).toBe(0);
    expect(s.round).toBe(1);
    expect(s.rollsLeft).toBe(ROLLS_PER_TURN);
    expect(s.dice).toEqual([1, 1, 1, 1, 1]);
    expect(s.held).toEqual([false, false, false, false, false]);
    expect(s.phase).toBe("playing");
    expect(s.winners).toEqual([]);
    for (const p of s.players) {
      expect(SCOREABLE_CATEGORIES.every((c) => s.scores[p]![c] === null)).toBe(
        true,
      );
    }
  });
});

describe("rolling", () => {
  it("rolls unheld dice and decrements rollsLeft", () => {
    const s = createGame(["A"]);
    const rolled = ok(s, { type: "roll" }, riggedRng([6, 5, 4, 3, 2]));
    expect(rolled.dice).toEqual([6, 5, 4, 3, 2]);
    expect(rolled.rollsLeft).toBe(2);
    expect(hasRolled(rolled)).toBe(true);
  });

  it("keeps held dice across a reroll", () => {
    const s = createGame(["A"]);
    let st = ok(s, { type: "roll" }, riggedRng([6, 6, 1, 1, 1]));
    st = ok(st, { type: "toggleHold", index: 0 });
    st = ok(st, { type: "toggleHold", index: 1 });
    // Rerolling yields 3s for the three unheld dice; held 6s remain.
    st = ok(st, { type: "roll" }, riggedRng([3, 3, 3]));
    expect(st.dice).toEqual([6, 6, 3, 3, 3]);
    expect(st.rollsLeft).toBe(1);
  });

  it("rejects a fourth roll", () => {
    let st = createGame(["A"]);
    st = ok(st, { type: "roll" });
    st = ok(st, { type: "roll" });
    st = ok(st, { type: "roll" });
    const res = applyAction(
      st,
      { type: "roll" },
      { actor: "A", rng: riggedRng([1]) },
    );
    expect(res).toEqual({ ok: false, error: "no-rolls-left" });
  });
});

describe("holding", () => {
  it("cannot hold before rolling", () => {
    const s = createGame(["A"]);
    const res = applyAction(
      s,
      { type: "toggleHold", index: 0 },
      { actor: "A", rng: riggedRng([1]) },
    );
    expect(res).toEqual({ ok: false, error: "must-roll-first" });
  });

  it("rejects an out-of-range die index", () => {
    const rolled = ok(createGame(["A"]), { type: "roll" });
    for (const index of [-1, 5, 1.5]) {
      const res = applyAction(
        rolled,
        { type: "toggleHold", index },
        { actor: "A", rng: riggedRng([1]) },
      );
      expect(res).toEqual({ ok: false, error: "invalid-die-index" });
    }
  });
});

describe("scoring & turn flow", () => {
  it("must roll before scoring", () => {
    const s = createGame(["A", "B"]);
    const res = applyAction(
      s,
      { type: "score", category: "chance" },
      { actor: "A", rng: riggedRng([1]) },
    );
    expect(res).toEqual({ ok: false, error: "must-roll-first" });
  });

  it("records the score and advances to the next player", () => {
    const s = createGame(["A", "B"]);
    const after = playTurn(s, "lg-straight", [1, 2, 3, 4, 5]);
    expect(after.scores.A!["lg-straight"]).toBe(40);
    expect(currentPlayer(after)).toBe("B");
    expect(after.rollsLeft).toBe(ROLLS_PER_TURN);
    expect(after.dice).toEqual([1, 1, 1, 1, 1]);
    expect(after.round).toBe(1);
  });

  it("increments the round when the turn wraps to the first player", () => {
    let st = createGame(["A", "B"]);
    st = playTurn(st, "ones"); // A
    st = playTurn(st, "ones"); // B → wraps back to A
    expect(currentPlayer(st)).toBe("A");
    expect(st.round).toBe(2);
  });

  it("rejects acting out of turn", () => {
    const rolled = ok(createGame(["A", "B"]), { type: "roll" });
    const res = applyAction(
      rolled,
      { type: "score", category: "chance" },
      { actor: "B", rng: riggedRng([1]) },
    );
    expect(res).toEqual({ ok: false, error: "not-your-turn" });
  });

  it("rejects an unknown category from an untyped (server) caller", () => {
    const rolled = ok(createGame(["A"]), { type: "roll" });
    const res = applyAction(
      rolled,
      { type: "score", category: "bogus" as ScoreableCategory },
      { actor: "A", rng: riggedRng([1]) },
    );
    expect(res).toEqual({ ok: false, error: "invalid-category" });
  });

  it("rejects rescoring a filled category", () => {
    let st = createGame(["A"]);
    st = playTurn(st, "chance", [1, 1, 1, 1, 1]); // back to A (solo game)
    const rolled = ok(st, { type: "roll" }, riggedRng([2, 2, 2, 2, 2]));
    const res = applyAction(
      rolled,
      { type: "score", category: "chance" },
      { actor: "A", rng: riggedRng([1]) },
    );
    expect(res).toEqual({ ok: false, error: "category-already-scored" });
  });
});

describe("Yahtzee bonus (bonus-5s)", () => {
  it("awards +100 for a five-of-a-kind once five-dice is locked at 50", () => {
    let st = createGame(["A", "B"]);
    st = playTurn(st, "five-dice", [5, 5, 5, 5, 5]); // A scores 50
    expect(st.scores.A!["five-dice"]).toBe(50);
    st = playTurn(st, "ones"); // B fills a turn
    // A rolls another five-of-a-kind and banks it in sixes → bonus fires.
    st = playTurn(st, "sixes", [6, 6, 6, 6, 6]);
    expect(st.scores.A!["sixes"]).toBe(30);
    expect(st.scores.A!["bonus-5s"]).toBe(100);
  });

  it("does not award a bonus before five-dice is scored", () => {
    let st = createGame(["A"]);
    st = playTurn(st, "sixes", [6, 6, 6, 6, 6]); // five-of-a-kind, but no five-dice yet
    expect(st.scores.A!["bonus-5s"]).toBeNull();
  });

  it("does not award a bonus for scoring the five-of-a-kind into five-dice itself", () => {
    let st = createGame(["A"]);
    st = playTurn(st, "five-dice", [3, 3, 3, 3, 3]);
    expect(st.scores.A!["five-dice"]).toBe(50);
    expect(st.scores.A!["bonus-5s"]).toBeNull();
  });
});

describe("game over", () => {
  it("ends when all players have filled every category and picks the winner", () => {
    let st = createGame(["A", "B"]);
    // A always rolls a large straight (40s); B always rolls ones (low).
    for (const category of SCOREABLE_CATEGORIES) {
      st = playTurn(st, category, [1, 2, 3, 4, 5]); // A: high-value rolls
      st = playTurn(st, category, [1, 1, 1, 1, 1]); // B: low-value rolls
    }
    expect(st.phase).toBe("gameover");
    expect(st.winners).toEqual(["A"]);
    expect(grandTotal(st.scores.A!)).toBeGreaterThan(grandTotal(st.scores.B!));
    // No further actions are accepted.
    const res = applyAction(
      st,
      { type: "roll" },
      { actor: currentPlayer(st), rng: riggedRng([1]) },
    );
    expect(res).toEqual({ ok: false, error: "game-over" });
  });

  it("reports a tie when totals are equal", () => {
    let st = createGame(["A", "B"]);
    // Both players face identical dice and categories → identical scorecards.
    for (const category of SCOREABLE_CATEGORIES) {
      st = playTurn(st, category, [2, 3, 4, 5, 6]);
      st = playTurn(st, category, [2, 3, 4, 5, 6]);
    }
    expect(st.phase).toBe("gameover");
    expect(st.winners.length).toBe(2);
    expect(new Set(st.winners)).toEqual(new Set(["A", "B"]));
  });
});

describe("property: random games always terminate validly", () => {
  it("reaches a valid game-over from many random playthroughs", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rng = makeSeededRng(seed * 7919);
      let st = createGame(["A", "B", "C"]);
      let guard = 0;
      while (st.phase === "playing") {
        if (guard++ > 5000) throw new Error(`game ${seed} failed to terminate`);
        const actor = currentPlayer(st);
        let action: Parameters<typeof applyAction>[1];
        if (!hasRolled(st)) {
          action = { type: "roll" };
        } else if (st.rollsLeft > 0 && rng() < 0.5) {
          action = { type: "roll" };
        } else {
          const open = SCOREABLE_CATEGORIES.filter(
            (c) => st.scores[actor]![c] === null,
          );
          action = { type: "score", category: open[0]! };
        }
        const res = applyAction(st, action, { actor, rng });
        expect(res.ok).toBe(true);
        if (res.ok) st = res.state;
      }
      // Every category filled for every player, and a winner exists.
      for (const p of st.players) {
        expect(SCOREABLE_CATEGORIES.every((c) => st.scores[p]![c] !== null)).toBe(
          true,
        );
      }
      expect(st.winners.length).toBeGreaterThanOrEqual(1);
      expect(Number.isFinite(grandTotal(st.scores[st.winners[0]!]!))).toBe(true);
    }
  });
});
