"use client";
/**
 * The lobby: live room grid, create-room panel, and global chat (sidebar on
 * desktop, slide-in sheet on mobile).
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLobby } from "@/hooks/useLobby";
import { durations, easings, gsap, prefersReducedMotion } from "@/lib/motion";
import type { Profile, RoomSummary } from "@/protocol";

function newRoomId(): string {
  return `r-${Math.random().toString(36).slice(2, 10)}`;
}

function RoomCard({
  room,
  onJoin,
}: {
  room: RoomSummary;
  onJoin: (r: RoomSummary) => void;
}) {
  const seatsLeft = room.maxPlayers - room.seatsFilled;
  const joinable = room.phase === "waiting" && seatsLeft > 0;
  return (
    <div className="room-card" data-room-card>
      <h3>🎲 {room.name}</h3>
      <span className={`seats ${joinable ? "open" : "full"}`}>
        {room.phase === "waiting"
          ? seatsLeft > 0
            ? `${seatsLeft} seat${seatsLeft === 1 ? "" : "s"} open`
            : "Game full"
          : room.phase === "playing"
            ? "In progress"
            : "Finished"}
        {" · "}
        {room.seatsFilled}/{room.maxPlayers} players
      </span>
      <button
        className="capsule-button green"
        disabled={!joinable}
        onClick={() => onJoin(room)}
      >
        Join Game
      </button>
    </div>
  );
}

export function Lobby({
  profile,
  onOpenSettings,
}: {
  profile: Profile;
  onOpenSettings: () => void;
}) {
  const router = useRouter();
  const { rooms, chats, connected, sendChat } = useLobby(profile);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState("");
  const [creating, setCreating] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(2);
  const gridRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Stagger-pop room cards as the list changes.
  useEffect(() => {
    if (!gridRef.current || prefersReducedMotion()) return;
    const cards = gridRef.current.querySelectorAll("[data-room-card]");
    if (cards.length === 0) return;
    gsap.fromTo(
      cards,
      { opacity: 0, y: 14, scale: 0.96 },
      {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: durations.base,
        ease: easings.pop,
        stagger: 0.05,
      },
    );
  }, [rooms.length]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "end" });
  }, [chats.length]);

  const submitChat = (): void => {
    const text = chatText.trim();
    if (!text) return;
    sendChat(text);
    setChatText("");
  };

  const createRoom = (): void => {
    const id = newRoomId();
    const name = roomName.trim() || `${profile.name}'s game`;
    router.push(
      `/room/${id}?create=1&name=${encodeURIComponent(name)}&max=${maxPlayers}${guestSuffix()}`,
    );
  };

  const joinRoom = (room: RoomSummary): void => {
    router.push(`/room/${room.roomId}${guestSuffix() ? `?${guestSuffix().slice(1)}` : ""}`);
  };

  return (
    <div className="screen">
      <header className="top-header">
        <button
          className="header-btn left chat-toggle"
          aria-label="Open chat"
          onClick={() => setChatOpen(true)}
        >
          💬
        </button>
        <h1>🎲 Lobby 🎲</h1>
        <button
          className="header-btn right"
          aria-label="Settings"
          onClick={onOpenSettings}
        >
          ⚙️
        </button>
      </header>

      <div className="lobby-layout">
        <aside className={`chat-sidebar ${chatOpen ? "open" : ""}`}>
          <button className="chat-close" onClick={() => setChatOpen(false)}>
            Lobby →
          </button>
          <div className="chat-history">
            {chats.map((c) => (
              <div
                key={c.id}
                className="chat-msg"
                style={{ backgroundColor: c.color }}
              >
                <strong>{c.author}:</strong> {c.text}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <form
            className="chat-input-row"
            onSubmit={(e) => {
              e.preventDefault();
              submitChat();
            }}
          >
            <input
              placeholder="Type message…"
              value={chatText}
              maxLength={280}
              onChange={(e) => setChatText(e.target.value)}
            />
            <button className="chat-send" type="submit" aria-label="Send">
              ➤
            </button>
          </form>
        </aside>

        <main className="lobby-main">
          {creating ? (
            <div className="create-panel">
              <label htmlFor="room-name">Room name</label>
              <input
                id="room-name"
                className="capsule-input"
                placeholder={`${profile.name}'s game`}
                maxLength={32}
                value={roomName}
                autoFocus
                onChange={(e) => setRoomName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") createRoom();
                }}
              />
              <div className="row">
                <select
                  className="player-count-select"
                  aria-label="Number of players"
                  value={maxPlayers}
                  onChange={(e) => setMaxPlayers(parseInt(e.target.value))}
                >
                  {[2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n} players
                    </option>
                  ))}
                </select>
                <button className="capsule-button green" onClick={createRoom}>
                  Create
                </button>
                <button
                  className="capsule-button subtle"
                  onClick={() => setCreating(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              className="capsule-button green"
              onClick={() => setCreating(true)}
            >
              Create a New Game Room
            </button>
          )}

          <div className="room-grid" ref={gridRef}>
            {rooms.map((r) => (
              <RoomCard key={r.roomId} room={r} onJoin={joinRoom} />
            ))}
          </div>
          {rooms.length === 0 && (
            <p className="lobby-empty">
              No open games right now — create one and invite the family! 🎲
            </p>
          )}
        </main>
      </div>

      <footer className="app-footer">
        <span>Games found: {rooms.length}</span>
        <div className="status-indicator">
          <span
            className={`status-dot ${connected ? "connected" : ""}`}
            data-testid="lobby-connection"
          />
          <span>{connected ? "Lobby connected" : "Connecting…"}</span>
        </div>
      </footer>
    </div>
  );
}

/** Propagate guest mode (see identity.ts) across navigation for testing. */
function guestSuffix(): string {
  if (typeof window === "undefined") return "";
  const guest = new URLSearchParams(window.location.search).get("guest");
  return guest ? `&guest=${encodeURIComponent(guest)}` : "";
}
