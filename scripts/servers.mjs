/**
 * Shared dev-server management for the browser harness scripts. Each script is
 * self-contained: it boots `next dev` + `partykit dev` if they aren't already
 * running, and stops only the ones it started (so a locally-running dev setup
 * is reused and left alone, while CI gets a fresh pair per script).
 */
import { spawn } from "node:child_process";
import net from "node:net";

const NEXT_PORT = 3000;
const PK_PORT = 1999;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1");
    s.on("connect", () => (s.destroy(), resolve(true)));
    s.on("error", () => resolve(false));
    setTimeout(() => (s.destroy(), resolve(false)), 1000);
  });
}

/** Ensure both servers are up; returns the processes this call spawned. */
export async function ensureServers(log = () => {}) {
  const spawned = [];
  if (!(await portOpen(PK_PORT))) {
    log("· booting partykit dev…");
    spawned.push(
      spawn("npx", ["partykit", "dev", "--port", String(PK_PORT)], {
        stdio: "ignore",
        detached: true,
      }),
    );
  }
  if (!(await portOpen(NEXT_PORT))) {
    log("· booting next dev…");
    spawned.push(spawn("npm", ["run", "dev"], { stdio: "ignore", detached: true }));
  }
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if ((await portOpen(PK_PORT)) && (await portOpen(NEXT_PORT))) {
      // Give a freshly-booted next dev a beat to finish its first compile.
      await sleep(spawned.length ? 3500 : 0);
      return spawned;
    }
    await sleep(500);
  }
  throw new Error("dev servers did not come up within 90s");
}

/** Stop the processes ensureServers spawned (whole process group). */
export function stopServers(spawned) {
  for (const proc of spawned ?? []) {
    try {
      process.kill(-proc.pid, "SIGTERM");
    } catch {
      try {
        proc.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    }
  }
}
