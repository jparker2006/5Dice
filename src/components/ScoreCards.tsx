"use client";
/**
 * Scorecards: the interactive personal card shown on your turn, and the
 * multi-player comparison table shown between turns / at game over.
 */
import {
  LOWER_CATEGORIES,
  UPPER_CATEGORIES,
  calculateScore,
  grandTotal,
  lowerTotal,
  upperBonus,
  upperTotal,
  type GameState,
  type ScoreCard,
  type ScoreableCategory,
} from "@/game-core";
import type { Seat } from "@/protocol";

export const CATEGORY_LABELS: Record<string, string> = {
  ones: "1's",
  twos: "2's",
  threes: "3's",
  fours: "4's",
  fives: "5's",
  sixes: "6's",
  chance: "Chance",
  "three-kind": "3 of a kind",
  "four-kind": "4 of a kind",
  "full-house": "Full House",
  "sm-straight": "Sm Straight",
  "lg-straight": "Lg Straight",
  "five-dice": "5 Dice",
  "bonus-5s": "Bonus 5's",
};

/** Your own card — open categories are clickable once you've rolled. */
export function OwnScoreCard({
  card,
  dice,
  canScore,
  onPick,
}: {
  card: ScoreCard;
  dice: readonly number[];
  canScore: boolean;
  onPick: (category: ScoreableCategory) => void;
}) {
  const upper = upperTotal(card);
  const bonus = upperBonus(card);
  const lower = lowerTotal(card);

  const renderCat = (cat: ScoreableCategory, dieFace?: number) => {
    const scored = card[cat] !== null;
    const clickable = canScore && !scored;
    const preview = clickable ? calculateScore(cat, dice) : null;
    return (
      <div
        key={cat}
        className={`sc-cat ${clickable ? "open-now" : ""}`}
        data-category={cat}
        role={clickable ? "button" : undefined}
        onClick={clickable ? () => onPick(cat) : undefined}
      >
        {dieFace ? (
          <span className={`cat-die die-${dieFace}`} aria-label={CATEGORY_LABELS[cat]} />
        ) : (
          <span>{CATEGORY_LABELS[cat]}</span>
        )}
        {scored ? (
          <span className="cat-score" data-score-value>
            {card[cat]}
          </span>
        ) : (
          <span className="cat-preview">{preview !== null ? preview : "–"}</span>
        )}
      </div>
    );
  };

  return (
    <div className="scorecard" data-testid="own-scorecard">
      <div className="sc-section">
        {UPPER_CATEGORIES.map((cat, i) => renderCat(cat, i + 1))}
      </div>
      <div className="sc-totals">
        <span>
          Upper: <strong>{upper}</strong> · Bonus (63+): <strong>{bonus}</strong>
        </span>
      </div>
      <div className="sc-section">
        {LOWER_CATEGORIES.map((cat) => renderCat(cat))}
        <div className="sc-cat">
          <span>{CATEGORY_LABELS["bonus-5s"]}</span>
          <span className="cat-score">{card["bonus-5s"] ?? "–"}</span>
        </div>
      </div>
      <div className="sc-totals">
        <span>Lower: <strong>{lower}</strong></span>
        <span className="sc-grand">Total: {grandTotal(card)}</span>
      </div>
    </div>
  );
}

/** Everyone side by side; sorted by total once the game is over. */
export function ScoreTable({
  game,
  seats,
  highlightWinners,
}: {
  game: GameState;
  seats: Seat[];
  highlightWinners: boolean;
}) {
  const seatFor = (pid: string): Seat | undefined =>
    seats.find((s) => s.playerId === pid);
  const players = [...game.players];
  if (highlightWinners) {
    players.sort(
      (a, b) => grandTotal(game.scores[b]!) - grandTotal(game.scores[a]!),
    );
  }

  const allCats: { id: string; label: string }[] = [
    ...UPPER_CATEGORIES.map((c) => ({ id: c, label: CATEGORY_LABELS[c]! })),
    { id: "bonus", label: "Bonus (63+)" },
    ...LOWER_CATEGORIES.map((c) => ({ id: c, label: CATEGORY_LABELS[c]! })),
    { id: "bonus-5s", label: CATEGORY_LABELS["bonus-5s"]! },
  ];

  return (
    <div className="scorecard" data-testid="score-table">
      <table className="sc-table">
        <thead>
          <tr>
            <th>Category</th>
            {players.map((pid) => (
              <th
                key={pid}
                style={{ backgroundColor: seatFor(pid)?.color ?? "#333" }}
              >
                {seatFor(pid)?.name ?? "?"}
                {highlightWinners && game.winners.includes(pid) ? " 👑" : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {allCats.map((cat) => (
            <tr key={cat.id}>
              <td>{cat.label}</td>
              {players.map((pid) => {
                const card = game.scores[pid]!;
                const value =
                  cat.id === "bonus"
                    ? upperBonus(card)
                    : (card[cat.id as keyof ScoreCard] ?? "–");
                return <td key={pid}>{value === null ? "–" : value}</td>;
              })}
            </tr>
          ))}
          <tr className="totals-row">
            <td>Total</td>
            {players.map((pid) => (
              <td key={pid} data-total-for={pid}>
                {grandTotal(game.scores[pid]!)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
