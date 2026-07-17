"use client";
/**
 * React binding for RoomClient. Server state is the single source of truth —
 * this hook only mirrors the latest snapshot into React state and exposes
 * action senders. The one optimistic touch is hold-toggling (evaluated
 * server-side anyway; the next snapshot corrects any drift).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { RoomClient } from "@/lib/gameClient";
import { PARTYKIT_HOST } from "@/lib/config";
import type { ScoreableCategory } from "@/game-core";
import type { ErrorCode, Profile, RoomSnapshot } from "@/protocol";

export interface GameRoomState {
  snapshot: RoomSnapshot | null;
  connected: boolean;
  /** Most recent server rejection (auto-clears on the next snapshot). */
  lastError: { code: ErrorCode; at: number } | null;
  /** The underlying client, exposed so voice chat can share its socket. */
  client: RoomClient | null;
  roll: () => void;
  toggleHold: (index: number) => void;
  score: (category: ScoreableCategory) => void;
  playAgain: () => void;
  leave: () => void;
}

export function useGameRoom(
  roomId: string,
  profile: Profile | null,
  create?: { roomName: string; maxPlayers: number },
): GameRoomState {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastError, setLastError] = useState<GameRoomState["lastError"]>(null);
  const [client, setClient] = useState<RoomClient | null>(null);
  const clientRef = useRef<RoomClient | null>(null);
  // `create` is only meaningful on the first mount; don't reconnect over it.
  const createRef = useRef(create);

  useEffect(() => {
    if (!profile) return;
    const c = new RoomClient({
      host: PARTYKIT_HOST,
      roomId,
      profile,
      create: createRef.current,
    });
    clientRef.current = c;
    setClient(c);
    const offs = [
      c.on("snapshot", (s) => {
        setSnapshot(s);
        setLastError(null);
      }),
      c.on("connection", setConnected),
      c.on("error", (code) => setLastError({ code, at: Date.now() })),
    ];
    return () => {
      for (const off of offs) off();
      c.close();
      clientRef.current = null;
      setClient(null);
    };
  }, [roomId, profile]);

  return useMemo(
    () => ({
      snapshot,
      connected,
      lastError,
      client,
      roll: () => clientRef.current?.roll(),
      toggleHold: (i: number) => clientRef.current?.toggleHold(i),
      score: (c: ScoreableCategory) => clientRef.current?.score(c),
      playAgain: () => clientRef.current?.playAgain(),
      leave: () => clientRef.current?.leave(),
    }),
    [snapshot, connected, lastError, client],
  );
}
