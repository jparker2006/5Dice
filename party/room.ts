/**
 * The authoritative game room — a Cloudflare Durable Object (partyserver).
 * One instance per game; it owns the single true GameState, rolls all dice
 * server-side, and routes every player action through game-core's applyAction.
 * Clients only ever receive snapshots — they cannot mutate state.
 */
import { Server, getServerByName, type Connection, type WSMessage } from "partyserver";
import type { LobbyServer } from "./lobby";
import {
  applyAction,
  createGame,
  type GameState,
  type PlayerId,
} from "../src/game-core";
import {
  PROTOCOL_VERSION,
  parseMessage,
  roomClientMessageSchema,
  type ErrorCode,
  type RoomServerMessage,
  type RoomSnapshot,
  type RoomSummary,
} from "../src/protocol";
import type { Env } from "./types";

interface RoomConfig {
  name: string;
  maxPlayers: number;
}

interface StoredSeat {
  playerId: PlayerId;
  name: string;
  color: string;
}

/** Per-connection state: which player this socket authenticated as. */
type ConnState = { playerId: PlayerId } | null;

/** How long an abandoned room lingers before it self-destructs. */
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;

export class RoomServer extends Server<Env> {
  private config: RoomConfig | null = null;
  private seats: StoredSeat[] = [];
  private game: GameState | null = null;
  private loaded = false;

  /** Lazily hydrate from storage so rooms survive DO eviction/restarts. */
  private async load(): Promise<void> {
    if (this.loaded) return;
    this.config = (await this.ctx.storage.get<RoomConfig>("config")) ?? null;
    this.seats = (await this.ctx.storage.get<StoredSeat[]>("seats")) ?? [];
    this.game = (await this.ctx.storage.get<GameState>("game")) ?? null;
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await this.ctx.storage.put("config", this.config);
    await this.ctx.storage.put("seats", this.seats);
    await this.ctx.storage.put("game", this.game);
  }

  async onConnect(conn: Connection<ConnState>): Promise<void> {
    await this.load();
    conn.setState(null);
    // A live connection cancels any pending self-destruct.
    await this.ctx.storage.deleteAlarm();
  }

  async onMessage(sender: Connection<ConnState>, message: WSMessage): Promise<void> {
    await this.load();
    const msg = parseMessage(message, roomClientMessageSchema);
    if (!msg) return this.sendError(sender, "bad-message");

    if (msg.type === "join") {
      if (msg.protocolVersion !== PROTOCOL_VERSION) {
        return this.sendError(sender, "version-mismatch");
      }
      return this.handleJoin(msg.profile, msg.create, sender);
    }

    const playerId = sender.state?.playerId;
    if (!playerId) return this.sendError(sender, "must-join-first");

    switch (msg.type) {
      case "action": {
        if (!this.game) return this.sendError(sender, "game-not-started");
        // The actor is the connection's authenticated player — never message
        // content — and the dice come from the server's own RNG.
        const result = applyAction(this.game, msg.action, {
          actor: playerId,
          rng: Math.random,
        });
        if (!result.ok) return this.sendError(sender, result.error);
        this.game = result.state;
        await this.persist();
        await this.broadcastSnapshot();
        if (this.game.phase === "gameover") await this.notifyLobby();
        return;
      }
      case "playAgain": {
        if (!this.game) return this.sendError(sender, "game-not-started");
        if (this.game.phase !== "gameover") {
          return this.sendError(sender, "game-not-over");
        }
        this.startGame();
        await this.persist();
        await this.broadcastSnapshot();
        await this.notifyLobby();
        return;
      }
      case "leave": {
        // Leaving only makes sense before the game locks the seats.
        if (this.game) return;
        this.seats = this.seats.filter((s) => s.playerId !== playerId);
        sender.setState(null);
        await this.persist();
        await this.broadcastSnapshot();
        await this.notifyLobby();
        return;
      }
      case "voice-signal": {
        // Pure relay between two seated players — the server never interprets
        // the WebRTC payload, and voice is fully isolated from game state.
        if (msg.to === playerId) return;
        const out = JSON.stringify({
          type: "voice-signal",
          from: playerId,
          signal: msg.signal,
        });
        for (const conn of this.getConnections<ConnState>()) {
          if (conn.state?.playerId === msg.to) conn.send(out);
        }
        return;
      }
    }
  }

  private async handleJoin(
    profile: { playerId: PlayerId; name: string; color: string },
    create: { roomName: string; maxPlayers: number } | undefined,
    sender: Connection<ConnState>,
  ): Promise<void> {
    if (!this.config) {
      if (!create) return this.sendError(sender, "room-not-found");
      this.config = { name: create.roomName, maxPlayers: create.maxPlayers };
    }

    const existing = this.seats.find((s) => s.playerId === profile.playerId);
    if (existing) {
      // Rejoin/reconnect: refresh the profile and re-authenticate the socket.
      existing.name = profile.name;
      existing.color = profile.color;
    } else {
      if (this.game) return this.sendError(sender, "room-full");
      if (this.seats.length >= this.config.maxPlayers) {
        return this.sendError(sender, "room-full");
      }
      this.seats.push({ ...profile });
    }
    sender.setState({ playerId: profile.playerId });

    // Seats full for the first time → the game begins.
    if (!this.game && this.seats.length === this.config.maxPlayers) {
      this.startGame();
    }

    await this.persist();
    await this.broadcastSnapshot();
    await this.notifyLobby();
  }

  /** Start (or restart) a game with a server-shuffled turn order. */
  private startGame(): void {
    const order = this.seats.map((s) => s.playerId);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    this.game = createGame(order);
  }

  async onClose(): Promise<void> {
    await this.load();
    await this.broadcastSnapshot();
    if (this.connectedPlayerIds().size === 0) {
      // Everyone left — schedule cleanup instead of dying immediately so a
      // reconnecting player finds their game intact.
      await this.ctx.storage.setAlarm(Date.now() + EMPTY_ROOM_TTL_MS);
    }
  }

  async onAlarm(): Promise<void> {
    await this.notifyLobbyRemove();
    await this.ctx.storage.deleteAll();
    this.config = null;
    this.seats = [];
    this.game = null;
  }

  // -------------------------------------------------------------------------
  // Snapshots & messaging
  // -------------------------------------------------------------------------

  private connectedPlayerIds(): Set<PlayerId> {
    const ids = new Set<PlayerId>();
    for (const conn of this.getConnections<ConnState>()) {
      if (conn.state?.playerId) ids.add(conn.state.playerId);
    }
    return ids;
  }

  private snapshot(): RoomSnapshot {
    const connected = this.connectedPlayerIds();
    return {
      roomId: this.name,
      name: this.config?.name ?? "",
      maxPlayers: this.config?.maxPlayers ?? 2,
      phase: this.game ? this.game.phase : "waiting",
      seats: this.seats.map((s) => ({
        ...s,
        connected: connected.has(s.playerId),
      })),
      game: this.game,
    };
  }

  private async broadcastSnapshot(): Promise<void> {
    const msg: RoomServerMessage = { type: "room", snapshot: this.snapshot() };
    this.broadcast(JSON.stringify(msg));
  }

  private sendError(
    conn: Connection<ConnState>,
    code: ErrorCode,
    detail?: string,
  ): void {
    const msg: RoomServerMessage = { type: "error", code, detail };
    conn.send(JSON.stringify(msg));
  }

  // -------------------------------------------------------------------------
  // Lobby notifications (DO → DO)
  // -------------------------------------------------------------------------

  private summary(): RoomSummary {
    return {
      roomId: this.name,
      name: this.config?.name ?? "",
      maxPlayers: this.config?.maxPlayers ?? 2,
      seatsFilled: this.seats.length,
      phase: this.game ? this.game.phase : "waiting",
      updatedAt: Date.now(),
    };
  }

  private async notifyLobby(): Promise<void> {
    if (!this.config) return;
    await this.lobbyFetch({ kind: "upsert", room: this.summary() });
  }

  private async notifyLobbyRemove(): Promise<void> {
    await this.lobbyFetch({ kind: "remove", roomId: this.name });
  }

  private async lobbyFetch(body: unknown): Promise<void> {
    try {
      const ns = this.env.Lobby as DurableObjectNamespace<LobbyServer>;
      const lobby = await getServerByName(ns, "main");
      await lobby.fetch("https://do/notify", {
        method: "POST",
        body: JSON.stringify(body),
      });
    } catch (err) {
      // The lobby being briefly unreachable must never break a game.
      console.error("lobby notify failed:", err);
    }
  }
}
