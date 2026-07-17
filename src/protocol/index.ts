/**
 * The wire protocol between clients and the game servers (Cloudflare / partyserver).
 *
 * Every message that crosses the network is defined here as a zod schema, and
 * BOTH sides use it: the server parses every inbound client message (never
 * trusting raw JSON), and the client parses every server broadcast. Types are
 * inferred from the schemas so they cannot drift.
 *
 * Security note: client→server schemas are `strict` — unknown fields are
 * rejected. A client has no field through which to supply dice values or act
 * as another player; the server derives the actor from the authenticated
 * connection, not from message content.
 */
import { z } from "zod";
import { SCOREABLE_CATEGORIES, type GameState, type PlayerId } from "@/game-core";

export type { PlayerId };

export const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

export const playerIdSchema = z
  .string()
  .min(8)
  .max(64)
  .regex(/^[a-zA-Z0-9-]+$/, "playerId must be url-safe");

/** Hex color only — this value ends up in inline styles, so keep it inert. */
export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const profileSchema = z.strictObject({
  playerId: playerIdSchema,
  name: z.string().trim().min(1).max(24),
  color: colorSchema,
});
export type Profile = z.infer<typeof profileSchema>;

export const categorySchema = z.enum(SCOREABLE_CATEGORIES);

/** Game actions as sent by clients. Note: `roll` carries NO dice values. */
export const gameActionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("roll") }),
  z.strictObject({ type: z.literal("toggleHold"), index: z.number().int().min(0).max(4) }),
  z.strictObject({ type: z.literal("score"), category: categorySchema }),
]);
export type WireGameAction = z.infer<typeof gameActionSchema>;

/**
 * WebRTC voice signaling, relayed peer-to-peer by the room server. The server
 * only forwards these between two authenticated players in the room — it never
 * interprets them, so the bodies are validated loosely (bounded in size to
 * prevent abuse). Voice never touches game state.
 */
export const voiceSignalSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("description"),
    sdpType: z.enum(["offer", "answer", "pranswer", "rollback"]),
    sdp: z.string().max(20000),
  }),
  z.strictObject({
    kind: z.literal("candidate"),
    candidate: z.string().max(1200),
    sdpMid: z.string().max(100).nullable().optional(),
    sdpMLineIndex: z.number().int().nullable().optional(),
    usernameFragment: z.string().max(256).nullable().optional(),
  }),
]);
export type VoiceSignal = z.infer<typeof voiceSignalSchema>;

// ---------------------------------------------------------------------------
// Room party: client → server
// ---------------------------------------------------------------------------

export const roomClientMessageSchema = z.discriminatedUnion("type", [
  /** First message on every connection. `create` only when opening a new room. */
  z.strictObject({
    type: z.literal("join"),
    protocolVersion: z.literal(PROTOCOL_VERSION),
    profile: profileSchema,
    create: z
      .strictObject({
        roomName: z.string().trim().min(1).max(32),
        maxPlayers: z.number().int().min(2).max(6),
      })
      .optional(),
  }),
  z.strictObject({ type: z.literal("action"), action: gameActionSchema }),
  z.strictObject({ type: z.literal("playAgain") }),
  z.strictObject({ type: z.literal("leave") }),
  z.strictObject({
    type: z.literal("voice-signal"),
    to: playerIdSchema,
    signal: voiceSignalSchema,
  }),
]);
export type RoomClientMessage = z.infer<typeof roomClientMessageSchema>;

// ---------------------------------------------------------------------------
// Room party: server → client
// ---------------------------------------------------------------------------

export const seatSchema = z.object({
  playerId: playerIdSchema,
  name: z.string(),
  color: z.string(),
  connected: z.boolean(),
});
export type Seat = z.infer<typeof seatSchema>;

const scoreCardSchema = z.record(z.string(), z.number().nullable());

/** Mirrors game-core's GameState; validated on the client for safety. */
export const gameStateSchema = z.object({
  players: z.array(playerIdSchema),
  currentPlayerIndex: z.number().int().min(0),
  round: z.number().int().min(1),
  dice: z.array(z.number().int().min(1).max(6)).length(5),
  held: z.array(z.boolean()).length(5),
  rollsLeft: z.number().int().min(0).max(3),
  scores: z.record(z.string(), scoreCardSchema),
  phase: z.enum(["playing", "gameover"]),
  winners: z.array(playerIdSchema),
});

export const roomPhaseSchema = z.enum(["waiting", "playing", "gameover"]);
export type RoomPhase = z.infer<typeof roomPhaseSchema>;

export const roomSnapshotSchema = z.object({
  roomId: z.string(),
  name: z.string(),
  maxPlayers: z.number().int().min(2).max(6),
  phase: roomPhaseSchema,
  seats: z.array(seatSchema),
  game: gameStateSchema.nullable(),
});
/**
 * The zod schema validates the wire shape; the TypeScript type uses game-core's
 * readonly `GameState` so snapshot consumers get the real (immutable) type.
 */
export type RoomSnapshot = Omit<z.infer<typeof roomSnapshotSchema>, "game"> & {
  game: GameState | null;
};

export const errorCodeSchema = z.enum([
  // reducer errors, forwarded verbatim from game-core
  "not-your-turn",
  "game-over",
  "no-rolls-left",
  "must-roll-first",
  "invalid-die-index",
  "invalid-category",
  "category-already-scored",
  // room/protocol errors
  "bad-message",
  "must-join-first",
  "room-not-found",
  "room-full",
  "not-seated",
  "game-not-started",
  "game-not-over",
  "version-mismatch",
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const roomServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("room"), snapshot: roomSnapshotSchema }),
  z.object({
    type: z.literal("error"),
    code: errorCodeSchema,
    detail: z.string().optional(),
  }),
  z.object({
    type: z.literal("voice-signal"),
    from: playerIdSchema,
    signal: voiceSignalSchema,
  }),
]);
/** Declared manually (not inferred) so `snapshot` carries the RoomSnapshot
 * override above; the schema still validates the identical wire shape. */
export type RoomServerMessage =
  | { type: "room"; snapshot: RoomSnapshot }
  | { type: "error"; code: ErrorCode; detail?: string }
  | { type: "voice-signal"; from: PlayerId; signal: VoiceSignal };

// ---------------------------------------------------------------------------
// Lobby party
// ---------------------------------------------------------------------------

export const roomSummarySchema = z.object({
  roomId: z.string().min(1).max(64),
  name: z.string(),
  maxPlayers: z.number().int().min(2).max(6),
  seatsFilled: z.number().int().min(0).max(6),
  phase: roomPhaseSchema,
  updatedAt: z.number(),
});
export type RoomSummary = z.infer<typeof roomSummarySchema>;

export const chatMessageSchema = z.object({
  id: z.string(),
  author: z.string(),
  color: z.string(),
  text: z.string(),
  timestamp: z.number(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const lobbyClientMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("hello"),
    protocolVersion: z.literal(PROTOCOL_VERSION),
    profile: profileSchema,
  }),
  z.strictObject({ type: z.literal("chat"), text: z.string().trim().min(1).max(280) }),
]);
export type LobbyClientMessage = z.infer<typeof lobbyClientMessageSchema>;

export const lobbyServerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("lobby"),
    rooms: z.array(roomSummarySchema),
    chats: z.array(chatMessageSchema),
  }),
  z.object({ type: z.literal("rooms"), rooms: z.array(roomSummarySchema) }),
  z.object({ type: z.literal("chat"), chat: chatMessageSchema }),
  z.object({
    type: z.literal("error"),
    code: errorCodeSchema,
    detail: z.string().optional(),
  }),
]);
export type LobbyServerMessage = z.infer<typeof lobbyServerMessageSchema>;

/** Room → lobby internal HTTP notification (server-to-server only). */
export const lobbyNotifySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("upsert"), room: roomSummarySchema }),
  z.object({ kind: z.literal("remove"), roomId: z.string() }),
]);
export type LobbyNotify = z.infer<typeof lobbyNotifySchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse an inbound JSON string against a schema; null means "reject it". */
export function parseMessage<T>(raw: unknown, schema: z.ZodType<T>): T | null {
  if (typeof raw !== "string") return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = schema.safeParse(json);
  return result.success ? result.data : null;
}
