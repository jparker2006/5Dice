/**
 * The lobby: a singleton party (room id "main") that tracks the directory of
 * open game rooms and hosts the global chat. Room parties push their status
 * here over party-to-party HTTP; browsers hold a WebSocket for live updates.
 */
import type * as Party from "partykit/server";
import {
  PROTOCOL_VERSION,
  lobbyClientMessageSchema,
  lobbyNotifySchema,
  parseMessage,
  type ChatMessage,
  type LobbyServerMessage,
  type Profile,
  type RoomSummary,
} from "@/protocol";

type ConnState = { profile: Profile } | null;

const MAX_CHATS = 50;
/** Rooms that haven't been heard from in this long are considered dead. */
const ROOM_STALE_MS = 30 * 60 * 1000;

export default class LobbyServer implements Party.Server {
  private rooms = new Map<string, RoomSummary>();
  private chats: ChatMessage[] = [];
  private loaded = false;

  constructor(readonly room: Party.Room) {}

  private async load(): Promise<void> {
    if (this.loaded) return;
    const rooms = await this.room.storage.get<[string, RoomSummary][]>("rooms");
    this.rooms = new Map(rooms ?? []);
    this.chats = (await this.room.storage.get<ChatMessage[]>("chats")) ?? [];
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await this.room.storage.put("rooms", [...this.rooms.entries()]);
    await this.room.storage.put("chats", this.chats);
  }

  private liveRooms(): RoomSummary[] {
    const cutoff = Date.now() - ROOM_STALE_MS;
    for (const [id, r] of this.rooms) {
      if (r.updatedAt < cutoff) this.rooms.delete(id);
    }
    return [...this.rooms.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async onConnect(conn: Party.Connection<ConnState>): Promise<void> {
    await this.load();
    conn.setState(null);
    const msg: LobbyServerMessage = {
      type: "lobby",
      rooms: this.liveRooms(),
      chats: this.chats,
    };
    conn.send(JSON.stringify(msg));
  }

  async onMessage(
    raw: string,
    sender: Party.Connection<ConnState>,
  ): Promise<void> {
    await this.load();
    const msg = parseMessage(raw, lobbyClientMessageSchema);
    if (!msg) return this.sendError(sender, "bad-message");

    if (msg.type === "hello") {
      if (msg.protocolVersion !== PROTOCOL_VERSION) {
        return this.sendError(sender, "version-mismatch");
      }
      sender.setState({ profile: msg.profile });
      return;
    }

    // Everything below requires an identified sender.
    const profile = sender.state?.profile;
    if (!profile) return this.sendError(sender, "must-join-first");

    if (msg.type === "chat") {
      const chat: ChatMessage = {
        id: crypto.randomUUID(),
        author: profile.name,
        color: profile.color,
        text: msg.text,
        timestamp: Date.now(),
      };
      this.chats.push(chat);
      if (this.chats.length > MAX_CHATS) {
        this.chats = this.chats.slice(-MAX_CHATS);
      }
      await this.persist();
      const out: LobbyServerMessage = { type: "chat", chat };
      this.room.broadcast(JSON.stringify(out));
    }
  }

  /** Party-to-party endpoint: room servers push their summaries here. */
  async onRequest(req: Party.Request): Promise<Response> {
    await this.load();
    if (req.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }
    const notify = parseMessage(await req.text(), lobbyNotifySchema);
    if (!notify) return new Response("bad request", { status: 400 });

    if (notify.kind === "upsert") {
      this.rooms.set(notify.room.roomId, notify.room);
    } else {
      this.rooms.delete(notify.roomId);
    }
    await this.persist();

    const out: LobbyServerMessage = { type: "rooms", rooms: this.liveRooms() };
    this.room.broadcast(JSON.stringify(out));
    return new Response("ok");
  }

  private sendError(
    conn: Party.Connection<ConnState>,
    code: "bad-message" | "must-join-first" | "version-mismatch",
  ): void {
    const msg: LobbyServerMessage = { type: "error", code };
    conn.send(JSON.stringify(msg));
  }
}
