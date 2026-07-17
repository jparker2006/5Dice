/**
 * Shared dev-server management for the browser harness scripts. Each script is
 * self-contained: it boots `next dev` + `wrangler dev` (the Cloudflare game
 * servers) if they aren't already running, and stops only the ones it started
 * (so a locally-running dev setup is reused and left alone, while CI gets a
 * fresh pair per script).
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
    log("· booting wrangler dev (game servers)…");
    spawned.push(
      spawn(
        "npx",
        ["wrangler", "dev", "--port", String(PK_PORT), "--log-level", "error"],
        { stdio: "ignore", detached: true },
      ),
    );
  }
  if (!(await portOpen(NEXT_PORT))) {
    log("· booting next dev…");
    spawned.push(spawn("npm", ["run", "dev"], { stdio: "ignore", detached: true }));
  }
  // wrangler dev may download workerd + compile on a cold start.
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    if ((await portOpen(PK_PORT)) && (await portOpen(NEXT_PORT))) {
      // Give a freshly-booted server a beat to finish its first compile.
      await sleep(spawned.length ? 5000 : 0);
      return spawned;
    }
    await sleep(500);
  }
  throw new Error("dev servers did not come up within 150s");
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
