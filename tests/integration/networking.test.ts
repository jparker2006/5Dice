/**
 * End-to-end tests against a real `wrangler dev` server (see global-setup).
 * Real RoomClients play real games; every assertion is against state the
 * server broadcast, never against local bookkeeping.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  SCOREABLE_CATEGORIES,
  calculateScore,
  grandTotal,
  type ScoreableCategory,
} from "@/game-core";
import type { RoomSnapshot } from "@/protocol";
import {
  HOST,
  TestClient,
  makeProfile,
  sleep,
  uniqueRoomId,
} from "./helpers";

const openClients: TestClient[] = [];
function track(c: TestClient): TestClient {
  openClients.push(c);
  return c;
}
afterEach(() => {
  for (const c of openClients.splice(0)) c.close();
});

function currentPlayerId(s: RoomSnapshot): string {
  if (!s.game) throw new Error("no game in snapshot");
  return s.game.players[s.game.currentPlayerIndex]!;
}

function firstOpenCategory(s: RoomSnapshot, playerId: string): ScoreableCategory {
  const card = s.game!.scores[playerId]!;
  const open = SCOREABLE_CATEGORIES.find((c) => card[c] === null);
  if (!open) throw new Error(`no open category for ${playerId}`);
  return open;
}

/**
 * Play one turn: the current player rolls once and scores their first open
 * category. Verifies the committed score matches an independent game-core
 * computation of the dice the server broadcast.
 *
 * Every wait is pinned to "it is still this actor's turn" so a stale snapshot
 * from the previous turn (same rollsLeft value) can never satisfy a predicate.
 */
async function playOneTurn(
  clients: Map<string, TestClient>,
  referenceClient: TestClient,
): Promise<void> {
  const snap = await referenceClient.waitFor(
    (s) => s.game !== null,
    "game visible",
  );
  const pid = currentPlayerId(snap);
  const actor = clients.get(pid)!;

  // Sync the actor to its own turn-start before acting.
  await actor.waitFor(
    (s) =>
      s.game !== null &&
      currentPlayerId(s) === pid &&
      s.game.rollsLeft === 3,
    `${pid} sees own turn start`,
  );

  actor.client.roll();
  const afterRoll = await actor.waitFor(
    (s) =>
      s.game !== null &&
      currentPlayerId(s) === pid &&
      s.game.rollsLeft === 2,
    `${pid} roll applied`,
  );

  const dice = [...afterRoll.game!.dice];
  const category = firstOpenCategory(afterRoll, pid);
  const expected = calculateScore(category, dice);

  actor.client.score(category);
  const afterScore = await referenceClient.waitFor(
    (s) => s.game !== null && s.game.scores[pid]![category] !== null,
    `${pid} scored ${category}`,
  );

  // The server's committed score must match the rules applied to the dice
  // it broadcast. (Yahtzee bonus may ALSO have fired, but the category
  // value itself must be exactly the game-core computation.)
  expect(afterScore.game!.scores[pid]![category]).toBe(expected);
}

/** Drive a game all the way to gameover. */
async function playToCompletion(
  clients: Map<string, TestClient>,
  referenceClient: TestClient,
): Promise<RoomSnapshot> {
  for (let guard = 0; guard < 200; guard++) {
    if (referenceClient.snapshot!.phase === "gameover") {
      return referenceClient.snapshot!;
    }
    await playOneTurn(clients, referenceClient);
  }
  throw new Error("game did not finish within the guard limit");
}

describe("full 3-player game", () => {
  it("plays to completion with enforced turns and identical final state", async () => {
    const roomId = uniqueRoomId("game3");
    const [pa, pb, pc] = [makeProfile("A"), makeProfile("B"), makeProfile("C")];

    const a = track(
      new TestClient(pa, roomId, { roomName: "Test Game", maxPlayers: 3 }),
    );
    await a.waitFor((s) => s.seats.length === 1, "creator seated");
    expect(a.snapshot!.phase).toBe("waiting");

    const b = track(new TestClient(pb, roomId));
    await a.waitFor((s) => s.seats.length === 2, "second player seated");

    const c = track(new TestClient(pc, roomId));

    // Third seat fills the room → the server starts the game on its own.
    const started = await a.waitFor(
      (s) => s.phase === "playing" && s.game !== null,
      "game started",
    );
    expect(started.game!.players).toHaveLength(3);
    expect(new Set(started.game!.players)).toEqual(
      new Set([pa.playerId, pb.playerId, pc.playerId]),
    );

    // Out-of-turn enforcement: a player who is NOT current tries to roll.
    await b.waitFor((s) => s.game !== null, "b sees game");
    await c.waitFor((s) => s.game !== null, "c sees game");
    const clients = new Map<string, TestClient>([
      [pa.playerId, a],
      [pb.playerId, b],
      [pc.playerId, c],
    ]);
    const current = currentPlayerId(started);
    const bystander = [a, b, c].find((t) => t.profile.playerId !== current)!;
    bystander.client.roll();
    const err = await bystander.waitForError();
    expect(err.code).toBe("not-your-turn");
    // ...and the rejected roll changed nothing.
    expect(bystander.snapshot!.game!.rollsLeft).toBe(3);

    const final = await playToCompletion(clients, a);
    expect(final.phase).toBe("gameover");

    // Winner must match an independent recomputation from the scorecards.
    const totals = new Map(
      final.game!.players.map((p) => [
        p,
        grandTotal(final.game!.scores[p]! as Parameters<typeof grandTotal>[0]),
      ]),
    );
    const best = Math.max(...totals.values());
    const expectedWinners = final.game!.players.filter(
      (p) => totals.get(p) === best,
    );
    expect(new Set(final.game!.winners)).toEqual(new Set(expectedWinners));

    // Every client converged on the identical final state.
    await b.waitFor((s) => s.phase === "gameover", "b sees gameover");
    await c.waitFor((s) => s.phase === "gameover", "c sees gameover");
    expect(b.snapshot!.game).toEqual(final.game);
    expect(c.snapshot!.game).toEqual(final.game);

    // Play again resets to a fresh live game for everyone.
    a.client.playAgain();
    const fresh = await c.waitFor(
      (s) => s.phase === "playing" && s.game!.round === 1,
      "play again started",
    );
    expect(fresh.game!.rollsLeft).toBe(3);
    for (const p of fresh.game!.players) {
      expect(Object.values(fresh.game!.scores[p]!).every((v) => v === null)).toBe(
        true,
      );
    }
  });
});

describe("disconnect and rejoin", () => {
  it("re-seats a returning player with full correct state and finishes the game", async () => {
    const roomId = uniqueRoomId("rejoin");
    const [pa, pb] = [makeProfile("A"), makeProfile("B")];

    const a = track(
      new TestClient(pa, roomId, { roomName: "Rejoin Game", maxPlayers: 2 }),
    );
    const b1 = track(new TestClient(pb, roomId));
    await a.waitFor((s) => s.phase === "playing", "game started");
    await b1.waitFor((s) => s.phase === "playing", "b sees game");

    const clients = new Map<string, TestClient>([
      [pa.playerId, a],
      [pb.playerId, b1],
    ]);

    // Play two scored turns so there is real mid-game state to recover.
    await playOneTurn(clients, a);
    await playOneTurn(clients, a);

    // B vanishes mid-game.
    b1.close();
    await a.waitFor(
      (s) => s.seats.some((seat) => seat.playerId === pb.playerId && !seat.connected),
      "A sees B disconnected",
    );
    const stateWhileGone = a.snapshot!.game;

    // B returns with the same playerId (fresh socket, fresh client object).
    const b2 = track(new TestClient(pb, roomId));
    const recovered = await b2.waitFor(
      (s) => s.game !== null,
      "B received state on rejoin",
    );
    expect(recovered.game).toEqual(stateWhileGone);
    await a.waitFor(
      (s) => s.seats.every((seat) => seat.connected),
      "A sees B reconnected",
    );

    // The game is fully playable afterward — run it to the end.
    clients.set(pb.playerId, b2);
    const final = await playToCompletion(clients, a);
    expect(final.phase).toBe("gameover");
    await b2.waitFor((s) => s.phase === "gameover", "b sees gameover");
    expect(b2.snapshot!.game).toEqual(final.game);
  });
});

describe("anti-cheat", () => {
  it("rejects forged dice, oversized rooms, and unauthenticated actions without state change", async () => {
    const roomId = uniqueRoomId("cheat");
    const [pa, pb] = [makeProfile("A"), makeProfile("B")];

    const a = track(
      new TestClient(pa, roomId, { roomName: "Cheat Game", maxPlayers: 2 }),
    );
    const b = track(new TestClient(pb, roomId));
    await a.waitFor((s) => s.phase === "playing", "game started");
    await b.waitFor((s) => s.phase === "playing", "b sees game");

    // A raw socket lets us send messages the typed client can't even express.
    const ws = new WebSocket(`ws://${HOST}/parties/main/${roomId}`);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", () => reject(new Error("ws failed")));
    });
    const rawErrors: string[] = [];
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(String(e.data));
      if (msg.type === "error") rawErrors.push(msg.code);
    });
    const rawSend = (obj: unknown): void => {
      ws.send(JSON.stringify(obj));
    };
    const expectRawError = async (code: string): Promise<void> => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const idx = rawErrors.indexOf(code);
        if (idx !== -1) {
          rawErrors.splice(idx, 1);
          return;
        }
        await sleep(25);
      }
      throw new Error(`expected raw error ${code}, got: ${rawErrors.join(",")}`);
    };

    // 1. Acting without joining → must-join-first.
    rawSend({ type: "action", action: { type: "roll" } });
    await expectRawError("must-join-first");

    // 2. Authenticate as B, then forge a roll carrying chosen dice values.
    //    The strict schema has no such field — rejected as bad-message.
    const before = JSON.stringify(a.snapshot!.game);
    rawSend({
      type: "join",
      protocolVersion: 1,
      profile: pb,
      // also try to smuggle a bigger room config on rejoin — ignored by schema shape
    });
    await sleep(200);
    rawSend({
      type: "action",
      action: { type: "roll", dice: [6, 6, 6, 6, 6] },
    });
    await expectRawError("bad-message");

    // 3. Forge a score for a category with an inflated value field.
    rawSend({
      type: "action",
      action: { type: "score", category: "five-dice", score: 50 },
    });
    await expectRawError("bad-message");

    // 4. Unknown message type.
    rawSend({ type: "grantMeVictory" });
    await expectRawError("bad-message");

    // 5. Malformed JSON.
    ws.send("not json at all {{{");
    await expectRawError("bad-message");

    // None of it moved the game an inch.
    await sleep(300);
    expect(JSON.stringify(a.snapshot!.game)).toBe(before);

    // 6. Out-of-turn score via the real client: typed rejection, no change.
    const current = currentPlayerId(a.snapshot!);
    const cheater = current === pa.playerId ? b : a;
    cheater.client.score("five-dice");
    const err = await cheater.waitForError();
    expect(["not-your-turn", "must-roll-first"]).toContain(err.code);
    expect(JSON.stringify(a.snapshot!.game)).toBe(before);

    // 7. Creating a room with an illegal player count is rejected outright.
    const evilRoom = uniqueRoomId("evil");
    const evil = new WebSocket(`ws://${HOST}/parties/main/${evilRoom}`);
    await new Promise<void>((resolve) =>
      evil.addEventListener("open", () => resolve()),
    );
    const evilErrors: string[] = [];
    evil.addEventListener("message", (e) => {
      const msg = JSON.parse(String(e.data));
      if (msg.type === "error") evilErrors.push(msg.code);
    });
    evil.send(
      JSON.stringify({
        type: "join",
        protocolVersion: 1,
        profile: makeProfile("E"),
        create: { roomName: "Evil", maxPlayers: 99 },
      }),
    );
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && evilErrors.length === 0) await sleep(25);
    expect(evilErrors).toContain("bad-message");

    ws.close();
    evil.close();
  });
});
