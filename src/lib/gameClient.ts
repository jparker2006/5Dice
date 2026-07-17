/**
 * Thin, framework-free client for the game servers (Cloudflare / partyserver). No React in here —
 * Goal 3 wraps this in hooks. Works in browsers and in Node (tests/sim).
 *
 * Reconnection is handled by PartySocket (exponential backoff built in); on
 * every (re)open we re-send the join/hello handshake so the server re-seats us
 * and replies with the current authoritative state.
 */
import PartySocket from "partysocket";
import {
  PROTOCOL_VERSION,
  lobbyServerMessageSchema,
  roomServerMessageSchema,
  type ChatMessage,
  type ErrorCode,
  type PlayerId,
  type Profile,
  type RoomServerMessage,
  type RoomSnapshot,
  type RoomSummary,
  type VoiceSignal,
  type WireGameAction,
} from "@/protocol";

export interface RoomClientEvents {
  snapshot: (snapshot: RoomSnapshot) => void;
  error: (code: ErrorCode, detail?: string) => void;
  connection: (open: boolean) => void;
  voiceSignal: (from: PlayerId, signal: VoiceSignal) => void;
}

export interface RoomClientOptions {
  host: string;
  roomId: string;
  profile: Profile;
  /** Present only when creating a brand-new room. */
  create?: { roomName: string; maxPlayers: number };
}

export class RoomClient {
  private socket: PartySocket;
  private listeners: { [K in keyof RoomClientEvents]: RoomClientEvents[K][] } =
    { snapshot: [], error: [], connection: [], voiceSignal: [] };
  /** The latest authoritative snapshot, for synchronous reads. */
  snapshot: RoomSnapshot | null = null;

  constructor(private opts: RoomClientOptions) {
    this.socket = new PartySocket({
      host: opts.host,
      room: opts.roomId,
      id: `${opts.profile.playerId}-${Math.random().toString(36).slice(2, 8)}`,
    });

    this.socket.addEventListener("open", () => {
      // (Re)joining is idempotent server-side; `create` only matters once.
      this.send({
        type: "join",
        protocolVersion: PROTOCOL_VERSION,
        profile: this.opts.profile,
        create: this.opts.create,
      });
      this.emit("connection", true);
    });

    this.socket.addEventListener("close", () => this.emit("connection", false));

    this.socket.addEventListener("message", (e) => {
      const parsed = roomServerMessageSchema.safeParse(
        safeJson(e.data as string),
      );
      if (!parsed.success) return;
      // Safe: the schema just validated the wire shape of RoomServerMessage.
      const msg = parsed.data as RoomServerMessage;
      if (msg.type === "room") {
        this.snapshot = msg.snapshot;
        this.emit("snapshot", msg.snapshot);
      } else if (msg.type === "voice-signal") {
        this.emit("voiceSignal", msg.from, msg.signal);
      } else {
        this.emit("error", msg.code, msg.detail);
      }
    });
  }

  on<K extends keyof RoomClientEvents>(
    event: K,
    fn: RoomClientEvents[K],
  ): () => void {
    const arr = this.listeners[event];
    arr.push(fn);
    return () => {
      const i = arr.indexOf(fn);
      if (i !== -1) arr.splice(i, 1);
    };
  }

  private emit<K extends keyof RoomClientEvents>(
    event: K,
    ...args: Parameters<RoomClientEvents[K]>
  ): void {
    for (const fn of this.listeners[event]) {
      (fn as (...a: Parameters<RoomClientEvents[K]>) => void)(...args);
    }
  }

  sendAction(action: WireGameAction): void {
    this.send({ type: "action", action });
  }

  roll(): void {
    this.sendAction({ type: "roll" });
  }

  toggleHold(index: number): void {
    this.sendAction({ type: "toggleHold", index });
  }

  score(category: Extract<WireGameAction, { type: "score" }>["category"]): void {
    this.sendAction({ type: "score", category });
  }

  playAgain(): void {
    this.send({ type: "playAgain" });
  }

  leave(): void {
    this.send({ type: "leave" });
  }

  sendVoiceSignal(to: PlayerId, signal: VoiceSignal): void {
    this.send({ type: "voice-signal", to, signal });
  }

  close(): void {
    this.socket.close();
  }

  private send(msg: unknown): void {
    this.socket.send(JSON.stringify(msg));
  }
}

export interface LobbyClientEvents {
  rooms: (rooms: RoomSummary[]) => void;
  chat: (chat: ChatMessage) => void;
  chats: (chats: ChatMessage[]) => void;
  connection: (open: boolean) => void;
}

export class LobbyClient {
  private socket: PartySocket;
  private listeners: {
    [K in keyof LobbyClientEvents]: LobbyClientEvents[K][];
  } = { rooms: [], chat: [], chats: [], connection: [] };
  rooms: RoomSummary[] = [];

  constructor(opts: { host: string; profile: Profile }) {
    this.socket = new PartySocket({
      host: opts.host,
      party: "lobby",
      room: "main",
      id: `${opts.profile.playerId}-${Math.random().toString(36).slice(2, 8)}`,
    });

    this.socket.addEventListener("open", () => {
      this.socket.send(
        JSON.stringify({
          type: "hello",
          protocolVersion: PROTOCOL_VERSION,
          profile: opts.profile,
        }),
      );
      this.emit("connection", true);
    });
    this.socket.addEventListener("close", () => this.emit("connection", false));

    this.socket.addEventListener("message", (e) => {
      const parsed = lobbyServerMessageSchema.safeParse(
        safeJson(e.data as string),
      );
      if (!parsed.success) return;
      const msg = parsed.data;
      if (msg.type === "lobby") {
        this.rooms = msg.rooms;
        this.emit("rooms", msg.rooms);
        this.emit("chats", msg.chats);
      } else if (msg.type === "rooms") {
        this.rooms = msg.rooms;
        this.emit("rooms", msg.rooms);
      } else if (msg.type === "chat") {
        this.emit("chat", msg.chat);
      }
    });
  }

  on<K extends keyof LobbyClientEvents>(
    event: K,
    fn: LobbyClientEvents[K],
  ): () => void {
    const arr = this.listeners[event];
    arr.push(fn);
    return () => {
      const i = arr.indexOf(fn);
      if (i !== -1) arr.splice(i, 1);
    };
  }

  private emit<K extends keyof LobbyClientEvents>(
    event: K,
    ...args: Parameters<LobbyClientEvents[K]>
  ): void {
    for (const fn of this.listeners[event]) {
      (fn as (...a: Parameters<LobbyClientEvents[K]>) => void)(...args);
    }
  }

  sendChat(text: string): void {
    this.socket.send(JSON.stringify({ type: "chat", text }));
  }

  close(): void {
    this.socket.close();
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
