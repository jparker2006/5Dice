"use client";
/**
 * The game screen. Renders the authoritative snapshot from useGameRoom and
 * choreographs the GSAP moments: background morph on turn change, 3D dice
 * tumble (with 2D values deferred until the dice land — no spoilers), held-die
 * lift, score pops, and the winner celebration.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  calculateScore,
  currentPlayer,
  type ScoreableCategory,
} from "@/game-core";
import { useGameRoom } from "@/hooks/useGameRoom";
import { useVoice } from "@/hooks/useVoice";
import { useWakeLock } from "@/hooks/useWakeLock";
import { Dice3D } from "@/lib/dice3d";
import {
  durations,
  easings,
  gsap,
  prefersReducedMotion,
  timeline,
  tween,
} from "@/lib/motion";
import type { ErrorCode, Profile, RoomSnapshot } from "@/protocol";
import { CATEGORY_LABELS, OwnScoreCard, ScoreTable } from "./ScoreCards";
import { Toasts, toast } from "./Toasts";

const ERROR_TEXT: Partial<Record<ErrorCode, string>> = {
  "not-your-turn": "Not your turn!",
  "no-rolls-left": "No rolls left — pick a category",
  "must-roll-first": "Roll the dice first",
  "category-already-scored": "Already scored that one",
  "room-full": "That room is full",
  "room-not-found": "Room not found",
  "version-mismatch": "App out of date — refresh the page",
};

export function GameRoom({
  roomId,
  profile,
  create,
}: {
  roomId: string;
  profile: Profile;
  create?: { roomName: string; maxPlayers: number };
}) {
  const router = useRouter();
  const room = useGameRoom(roomId, profile, create);
  const { snapshot } = room;
  const game = snapshot?.game ?? null;

  // Voice chat: seated peers other than me (stable-sorted for the mesh).
  const voicePeers = useMemo(
    () =>
      (snapshot?.seats ?? [])
        .map((s) => s.playerId)
        .filter((id) => id !== profile.playerId),
    [snapshot?.seats, profile.playerId],
  );
  const voice = useVoice(room.client, profile.playerId, voicePeers);

  const screenRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const dieRefs = useRef<(HTMLDivElement | null)[]>([null, null, null, null, null]);
  const dice3dRef = useRef<Dice3D | null>(null);
  const prevSnapRef = useRef<RoomSnapshot | null>(null);
  // Roll-animation flag: state for render (disables buttons), ref for effect
  // logic (the snapshot effect must read the live value without re-running).
  const [animating, setAnimating] = useState(false);
  const animatingRef = useRef(false);
  const setAnimatingBoth = useCallback((v: boolean): void => {
    animatingRef.current = v;
    setAnimating(v);
  }, []);

  // What the 2D dice display — deferred during the 3D tumble (no spoilers).
  const [displayDice, setDisplayDice] = useState<readonly number[]>([1, 1, 1, 1, 1]);
  const [commitCat, setCommitCat] = useState<ScoreableCategory | null>(null);
  // Errors render directly from room.lastError; this records which one has
  // timed out so the flash auto-hides without sync setState in an effect.
  const [errorDismissedAt, setErrorDismissedAt] = useState(0);

  useWakeLock(true);

  const myTurn = game !== null && game.phase === "playing" && currentPlayer(game) === profile.playerId;
  const currentPid = game && game.phase === "playing" ? currentPlayer(game) : null;
  const seatFor = useCallback(
    (pid: string | null) => snapshot?.seats.find((s) => s.playerId === pid),
    [snapshot],
  );

  // Expose animation state for tests/sims (and curious humans).
  useEffect(() => {
    document.body.toggleAttribute("data-dice-animating", animating);
  }, [animating]);

  // ---- 3D dice lifecycle -------------------------------------------------
  useEffect(() => {
    if (prefersReducedMotion()) return;
    let dice: Dice3D;
    try {
      dice = new Dice3D(document.body);
    } catch {
      // No WebGL on this device — fall back to the 2D dice, game unaffected.
      return;
    }
    dice3dRef.current = dice;
    return () => {
      dice.destroy();
      dice3dRef.current = null;
    };
  }, []);

  // ---- react to snapshot changes ----------------------------------------
  useEffect(() => {
    if (!snapshot) return;
    const prev = prevSnapRef.current;
    prevSnapRef.current = snapshot;
    const g = snapshot.game;

    // Seat presence toasts.
    if (prev && snapshot.seats.length > prev.seats.length) {
      const joined = snapshot.seats.filter(
        (s) => !prev.seats.some((p) => p.playerId === s.playerId),
      );
      for (const s of joined) {
        if (s.playerId !== profile.playerId) toast(`${s.name} joined`, s.color);
      }
    }
    if (prev) {
      for (const s of snapshot.seats) {
        const was = prev.seats.find((p) => p.playerId === s.playerId);
        if (was && was.connected && !s.connected && s.playerId !== profile.playerId) {
          toast(`${s.name} disconnected…`, "#555");
        }
        if (was && !was.connected && s.connected && s.playerId !== profile.playerId) {
          toast(`${s.name} is back!`, s.color);
        }
      }
    }

    if (!g) return;

    // Game over: cancel any in-flight tumble so dice never fly over the
    // winner screen, and hide the 3D overlay (its targets are unmounting).
    if (g.phase === "gameover") {
      // Event-driven mirror of a server push (not a render cascade) — the
      // rule can't distinguish subscription callbacks from derived state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAnimatingBoth(false);
      setDisplayDice(g.dice);
      dice3dRef.current?.snapToState(
        [...g.dice],
        [...g.held],
        [null, null, null, null, null],
      );
      return;
    }

    // Roll detection: rollsLeft dropped for the same player mid-turn.
    const wasRoll =
      prev?.game &&
      g.phase === "playing" &&
      prev.game.phase === "playing" &&
      g.rollsLeft < prev.game.rollsLeft &&
      g.currentPlayerIndex === prev.game.currentPlayerIndex;

    const targets = dieRefs.current;
    if (wasRoll && dice3dRef.current && !prefersReducedMotion()) {
      setAnimatingBoth(true);
      const unheld = g.held.flatMap((h, i) => (h ? [] : [i]));
      dice3dRef.current.roll([...g.dice], unheld, targets, () => {
        setAnimatingBoth(false);
        setDisplayDice(g.dice);
      });
    } else if (!animatingRef.current) {
      setDisplayDice(g.dice);
      dice3dRef.current?.snapToState(
        [...g.dice],
        [...g.held],
        g.phase === "playing" ? targets : [null, null, null, null, null],
      );
    }
  }, [snapshot, profile.playerId, setAnimatingBoth]);

  // ---- background morph to the current player's color --------------------
  useEffect(() => {
    if (!screenRef.current) return;
    let color = "#1a2a40";
    if (game?.phase === "playing") {
      color = seatFor(currentPid)?.color ?? "#1a2a40";
    } else if (game?.phase === "gameover") {
      const winnerSeat = seatFor(game.winners[0] ?? null);
      color = game.winners.length > 1 ? "#2a2a3e" : (winnerSeat?.color ?? "#1a2a40");
    }
    tween([screenRef.current, document.body], {
      backgroundColor: color,
      duration: durations.slow,
      ease: easings.glide,
    });
  }, [game?.phase, currentPid, game?.winners, seatFor, game]);

  // ---- status text swap ---------------------------------------------------
  const statusText = !snapshot
    ? "Connecting…"
    : snapshot.phase === "waiting"
      ? `Waiting for players… ${snapshot.seats.length}/${snapshot.maxPlayers}`
      : game?.phase === "gameover"
        ? game.winners.includes(profile.playerId)
          ? game.winners.length > 1
            ? "It's a tie!"
            : "You win! 🎉"
          : `${seatFor(game.winners[0] ?? null)?.name ?? "Someone"} wins!`
        : myTurn
          ? "Your turn!"
          : `${seatFor(currentPid)?.name ?? "…"}'s turn`;

  useEffect(() => {
    if (!statusRef.current) return;
    tween(statusRef.current, {
      keyframes: [
        { y: -8, opacity: 0, duration: 0 },
        { y: 0, opacity: 1, duration: durations.base, ease: easings.pop },
      ],
    });
  }, [statusText]);

  // ---- score pop when any score lands ------------------------------------
  useEffect(() => {
    if (!game || prefersReducedMotion()) return;
    const els = document.querySelectorAll("[data-score-value]");
    const latest = els[els.length - 1];
    if (latest) {
      gsap.fromTo(
        latest,
        { scale: 1.7, color: "#ffd34d" },
        { scale: 1, color: "#f5f7fa", duration: durations.base, ease: easings.pop },
      );
    }
  }, [game]);

  // ---- winner celebration -------------------------------------------------
  const celebrated = useRef(false);
  useEffect(() => {
    if (game?.phase !== "gameover") {
      celebrated.current = false;
      return;
    }
    if (celebrated.current) return;
    celebrated.current = true;

    const banner = document.querySelector("[data-winner-banner]");
    if (banner) {
      timeline()
        .fromTo(
          banner,
          { scale: 0.7, opacity: 0, y: 24 },
          { scale: 1, opacity: 1, y: 0, duration: durations.slow, ease: easings.bounce },
        );
    }
    if (game.winners.includes(profile.playerId) && !prefersReducedMotion()) {
      void import("canvas-confetti").then(({ default: confetti }) => {
        void confetti({ particleCount: 160, spread: 75, origin: { y: 0.6 } });
        setTimeout(
          () => void confetti({ particleCount: 80, spread: 100, origin: { y: 0.4 } }),
          400,
        );
      });
    }
  }, [game?.phase, game?.winners, profile.playerId, game]);

  // ---- server error flash (auto-hide after 2.2s) --------------------------
  useEffect(() => {
    if (!room.lastError) return;
    const at = room.lastError.at;
    const t = setTimeout(() => setErrorDismissedAt(at), 2200);
    return () => clearTimeout(t);
  }, [room.lastError]);
  const errorFlash =
    room.lastError && room.lastError.at !== errorDismissedAt
      ? (ERROR_TEXT[room.lastError.code] ?? room.lastError.code)
      : null;

  // ---- interactions -------------------------------------------------------
  const rollBtnRef = useRef<HTMLButtonElement>(null);
  const canRoll = myTurn && game !== null && game.rollsLeft > 0 && !animating;

  const onRoll = (): void => {
    if (!canRoll) return;
    if (rollBtnRef.current && !prefersReducedMotion()) {
      gsap.fromTo(
        rollBtnRef.current,
        { scale: 0.85, rotate: -8 },
        { scale: 1, rotate: 0, duration: durations.base, ease: easings.bounce },
      );
    }
    room.roll();
  };

  const onToggleHold = (index: number): void => {
    if (!myTurn || !game || game.rollsLeft === 3 || animatingRef.current) return;
    const el = dieRefs.current[index];
    if (el && !prefersReducedMotion()) {
      gsap.fromTo(
        el,
        { y: 0 },
        { y: game.held[index] ? 0 : -8, yoyo: true, repeat: 1, duration: durations.quick, ease: easings.out },
      );
    }
    room.toggleHold(index);
  };

  const hasRolledThisTurn = game !== null && game.rollsLeft < 3;
  const canPickCategory = myTurn && hasRolledThisTurn && !animating;

  const commitPreview = useMemo(() => {
    if (commitCat === null || !game) return null;
    return calculateScore(commitCat, displayDice);
  }, [commitCat, game, displayDice]);

  const myCard = game?.scores[profile.playerId] ?? null;

  const inviteUrl = typeof window !== "undefined"
    ? `${window.location.origin}/room/${roomId}`
    : "";

  const leaveToLobby = (): void => {
    if (snapshot?.phase === "waiting") room.leave();
    router.push(`/${guestQuery()}`);
  };

  return (
    <div ref={screenRef} className="game-screen">
      <header className="top-header">
        <button className="header-btn left" aria-label="Back to lobby" onClick={leaveToLobby}>
          ⬅️
        </button>
        <h1>🎲 {snapshot?.name || "5 Dice"} 🎲</h1>
        {voice.supported && (
          <div className="audio-controls">
            <button
              className={`audio-btn ${voice.speakerOn ? "" : "off"} ${voice.remoteAudio ? "live" : ""}`}
              aria-label={voice.speakerOn ? "Mute speaker" : "Unmute speaker"}
              aria-pressed={voice.speakerOn}
              data-testid="btn-speaker"
              onClick={voice.toggleSpeaker}
              title={voice.remoteAudio ? "Someone is talking" : "Speaker"}
            >
              {voice.speakerOn ? "🔊" : "🔇"}
            </button>
            <button
              className={`audio-btn ${voice.micOn ? "on" : "off"}`}
              aria-label={voice.micOn ? "Turn off microphone" : "Turn on microphone"}
              aria-pressed={voice.micOn}
              data-testid="btn-mic"
              onClick={voice.toggleMic}
              title="Microphone"
            >
              {voice.micOn ? "🎙️" : "🎤"}
            </button>
          </div>
        )}
      </header>

      <main className="game-main">
        <p ref={statusRef} className="game-status" data-testid="game-status">
          {statusText}
        </p>

        {snapshot && (
          <div className="seats-strip">
            {snapshot.seats.map((seat) => (
              <div
                key={seat.playerId}
                className={`seat-chip ${seat.playerId === currentPid ? "current" : ""} ${seat.connected ? "" : "away"}`}
                style={{ backgroundColor: seat.color }}
              >
                <span className="seat-dot" />
                {seat.name}
                {seat.playerId === profile.playerId ? " (you)" : ""}
                {!seat.connected && <span className="seat-away-label">reconnecting…</span>}
              </div>
            ))}
          </div>
        )}

        {snapshot?.phase === "waiting" && (
          <div className="waiting-panel">
            <p>Share this room with the family to fill the remaining seats:</p>
            <button
              className="capsule-button subtle"
              onClick={() => {
                void navigator.clipboard
                  .writeText(inviteUrl)
                  .then(() => toast("Invite link copied!"))
                  .catch(() => toast("Couldn't copy — share the URL manually", "#a33"));
              }}
            >
              📋 Copy invite link
            </button>
          </div>
        )}

        {game && game.phase === "playing" && (
          <div className="dice-tray">
            <div className="dice-row">
              {displayDice.map((value, i) => (
                <div
                  key={i}
                  ref={(el) => {
                    dieRefs.current[i] = el;
                  }}
                  className={`die die-${value} ${game.held[i] ? "held" : ""} ${myTurn && hasRolledThisTurn ? "clickable" : ""}`}
                  data-testid={`die-${i}`}
                  data-value={value}
                  role="button"
                  aria-label={`Die ${i + 1}: ${value}${game.held[i] ? " (held)" : ""}`}
                  onClick={() => onToggleHold(i)}
                />
              ))}
              <button
                ref={rollBtnRef}
                className="roll-btn"
                data-testid="roll-btn"
                disabled={!canRoll}
                onClick={onRoll}
                aria-label={`Roll dice, ${game.rollsLeft} rolls left`}
              >
                <span className="count">{game.rollsLeft}</span>
                <span className="label">{game.rollsLeft === 1 ? "roll" : "rolls"}</span>
              </button>
            </div>
            <span className="turns-left">
              Round {game.round} of 13{myTurn && !hasRolledThisTurn ? " — roll to start your turn!" : ""}
            </span>
          </div>
        )}

        {game && myTurn && myCard && (
          <OwnScoreCard
            card={myCard}
            dice={displayDice}
            canScore={canPickCategory}
            onPick={(cat) => setCommitCat(cat)}
          />
        )}

        {game && !myTurn && snapshot && (
          <ScoreTable
            game={game}
            seats={snapshot.seats}
            highlightWinners={game.phase === "gameover"}
          />
        )}

        {game?.phase === "gameover" && (
          <>
            <div className="winner-banner" data-winner-banner style={{ opacity: 0 }}>
              <h2>
                {game.winners.length > 1
                  ? "🤝 It's a tie!"
                  : `🏆 ${seatFor(game.winners[0] ?? null)?.name ?? "?"} wins!`}
              </h2>
              <p>Final scores are on the table below.</p>
            </div>
            <button className="capsule-button green" data-testid="play-again" onClick={room.playAgain}>
              Play again?
            </button>
          </>
        )}
      </main>

      {commitCat !== null && commitPreview !== null && (
        <div className="commit-overlay" onClick={() => setCommitCat(null)}>
          <div className="commit-card" onClick={(e) => e.stopPropagation()}>
            <p>
              Score <strong>{CATEGORY_LABELS[commitCat]}</strong> for
            </p>
            <div className="value">{commitPreview}</div>
            <div className="commit-buttons">
              <button
                className="capsule-button green"
                data-testid="commit-score"
                onClick={() => {
                  room.score(commitCat);
                  setCommitCat(null);
                }}
              >
                Commit
              </button>
              <button className="capsule-button subtle" onClick={() => setCommitCat(null)}>
                Undo
              </button>
            </div>
          </div>
        </div>
      )}

      {errorFlash && <div className="error-flash">{errorFlash}</div>}

      <footer className="app-footer">
        <span>
          Players: {snapshot?.seats.filter((s) => s.connected).length ?? 0}/
          {snapshot?.seats.length ?? 0}
        </span>
        <div className="status-indicator">
          <span className={`status-dot ${room.connected ? "connected" : ""}`} />
          <span>{room.connected ? "Connected" : "Reconnecting…"}</span>
        </div>
      </footer>

      <Toasts />
    </div>
  );
}

function guestQuery(): string {
  if (typeof window === "undefined") return "";
  const guest = new URLSearchParams(window.location.search).get("guest");
  return guest ? `?guest=${encodeURIComponent(guest)}` : "";
}
