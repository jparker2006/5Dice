/**
 * Boots a real `partykit dev` server once for the whole integration suite.
 * Uses a dedicated port so it never collides with a manually-run dev server.
 */
import { spawn, type ChildProcess } from "node:child_process";

export const PARTYKIT_TEST_PORT = 19990;

let server: ChildProcess | undefined;

async function waitForReady(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // Any HTTP response (even 405) means the server is up.
      await fetch(`http://127.0.0.1:${port}/parties/lobby/main`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(`partykit dev did not become ready on port ${port}`);
}

export async function setup(): Promise<void> {
  server = spawn(
    "npx",
    ["partykit", "dev", "--port", String(PARTYKIT_TEST_PORT)],
    { stdio: "ignore", detached: true },
  );
  await waitForReady(PARTYKIT_TEST_PORT, 30_000);
}

export async function teardown(): Promise<void> {
  if (server?.pid) {
    // Negative pid kills the whole process group (partykit spawns workerd).
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  }
}
