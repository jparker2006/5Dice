/**
 * Test-side plumbing for driving real clients against the dev server.
 * Uses the production RoomClient — the same code the UI will use — so these
 * tests exercise the actual client/server pair, not a test double.
 */
import { RoomClient } from "@/lib/gameClient";
import type { ErrorCode, Profile, RoomSnapshot } from "@/protocol";

export const HOST = "127.0.0.1:19990";

export function makeProfile(tag: string): Profile {
  return {
    playerId: `player-${tag}-${Math.random().toString(36).slice(2, 10)}`,
    name: `Player ${tag}`,
    color: "#235880",
  };
}

export function uniqueRoomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/** A RoomClient plus captured history, for assertions. */
export class TestClient {
  client: RoomClient;
  errors: { code: ErrorCode; detail?: string }[] = [];

  constructor(
    readonly profile: Profile,
    roomId: string,
    create?: { roomName: string; maxPlayers: number },
  ) {
    this.client = new RoomClient({ host: HOST, roomId, profile, create });
    this.client.on("error", (code, detail) =>
      this.errors.push({ code, detail }),
    );
  }

  get snapshot(): RoomSnapshot | null {
    return this.client.snapshot;
  }

  /** Resolve once the latest snapshot satisfies the predicate. */
  waitFor(
    predicate: (s: RoomSnapshot) => boolean,
    label: string,
    timeoutMs = 15_000,
  ): Promise<RoomSnapshot> {
    return new Promise((resolve, reject) => {
      if (this.client.snapshot && predicate(this.client.snapshot)) {
        return resolve(this.client.snapshot);
      }
      const timer = setTimeout(() => {
        off();
        reject(
          new Error(
            `timed out waiting for: ${label}\nlast snapshot: ${JSON.stringify(this.client.snapshot)}`,
          ),
        );
      }, timeoutMs);
      const off = this.client.on("snapshot", (s) => {
        if (predicate(s)) {
          clearTimeout(timer);
          off();
          resolve(s);
        }
      });
    });
  }

  /** Resolve on the next error message from the server. */
  waitForError(timeoutMs = 10_000): Promise<{ code: ErrorCode }> {
    return new Promise((resolve, reject) => {
      if (this.errors.length > 0) return resolve(this.errors[this.errors.length - 1]!);
      const timer = setTimeout(
        () => reject(new Error("timed out waiting for error")),
        timeoutMs,
      );
      const off = this.client.on("error", (code) => {
        clearTimeout(timer);
        off();
        resolve({ code });
      });
    });
  }

  close(): void {
    this.client.close();
  }
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));
