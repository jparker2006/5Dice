"use client";
/**
 * React binding for LobbyClient: live room list + chat.
 */
import { useEffect, useRef, useState } from "react";
import { LobbyClient } from "@/lib/gameClient";
import { GAME_HOST } from "@/lib/config";
import type { ChatMessage, Profile, RoomSummary } from "@/protocol";

export interface LobbyState {
  rooms: RoomSummary[];
  chats: ChatMessage[];
  connected: boolean;
  sendChat: (text: string) => void;
}

export function useLobby(profile: Profile | null): LobbyState {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [chats, setChats] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const clientRef = useRef<LobbyClient | null>(null);

  useEffect(() => {
    if (!profile) return;
    const client = new LobbyClient({ host: GAME_HOST, profile });
    clientRef.current = client;
    const offs = [
      client.on("rooms", setRooms),
      client.on("chats", setChats),
      client.on("chat", (chat) =>
        setChats((prev) => [...prev.slice(-49), chat]),
      ),
      client.on("connection", setConnected),
    ];
    return () => {
      for (const off of offs) off();
      client.close();
      clientRef.current = null;
    };
  }, [profile]);

  return {
    rooms,
    chats,
    connected,
    sendChat: (text: string) => clientRef.current?.sendChat(text),
  };
}
