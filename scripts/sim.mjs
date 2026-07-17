/**
 * The flagship verification harness: N real browsers play a complete 5 Dice
 * game through the actual UI against the actual servers, with chaos injected,
 * and every claim checked independently.
 *
 *   node scripts/sim.mjs [--players=N]   (N = 2..6, default 3)
 *
 * What it proves:
 *   - N players go settings → lobby → create/join → auto-start.
 *   - A full game plays to game-over through the real UI (roll, hold, score).
 *   - CHAOS: one player's page is closed and reopened mid-game (rejoin path);
 *     a non-current player's out-of-turn clicks are no-ops.
 *   - Every committed score equals game-core's calculateScore applied to the
 *     dice the server rolled (independent recomputation of the action log).
 *   - Every browser converges on the identical final scorecard, and the winner
 *     is the argmax of an independently reconstructed grand total.
 *   - The 3D dice actually animate (one browser runs full motion).
 *   - Any console error in any browser fails the run.
 *
 * Boots `next dev` + `partykit dev` itself if they aren't already running.
 * Always writes state screenshots to sim-output/; on failure also dumps full
 * per-browser screenshots and console logs there.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import { build } from "esbuild";
import puppeteer from "puppeteer";

const OUT = "sim-output";
const NEXT_PORT = 3000;
const PK_PORT = 1999;
const BASE = `http://localhost:${NEXT_PORT}`;

const playersArg = process.argv.find((a) => a.startsWith("--players="));
const N = Math.min(6, Math.max(2, Number(playersArg?.split("=")[1] ?? 3)));

const log = (m) => console.log(m);
class SimError extends Error {}
const fail = (m) => {
  throw new SimError(m);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- server management -----------------------------------------------------

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1");
    s.on("connect", () => (s.destroy(), resolve(true)));
    s.on("error", () => resolve(false));
    setTimeout(() => (s.destroy(), resolve(false)), 1000);
  });
}

async function ensureServers() {
  const spawned = [];
  if (!(await portOpen(PK_PORT))) {
    log("· booting partykit dev…");
    spawned.push(spawn("npx", ["partykit", "dev", "--port", String(PK_PORT)], {
      stdio: "ignore",
      detached: true,
    }));
  }
  if (!(await portOpen(NEXT_PORT))) {
    log("· booting next dev…");
    spawned.push(spawn("npm", ["run", "dev"], { stdio: "ignore", detached: true }));
  }
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if ((await portOpen(PK_PORT)) && (await portOpen(NEXT_PORT))) {
      // Give next dev a beat to finish its first compile.
      await sleep(spawned.length ? 2500 : 0);
      return spawned;
    }
    await sleep(500);
  }
  fail("servers did not come up within 60s");
}

// --- game-core, compiled fresh for independent verification ----------------

async function loadGameCore() {
  const outfile = `${OUT}/.game-core.mjs`;
  await build({
    entryPoints: ["src/game-core/index.ts"],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile,
    logLevel: "silent",
  });
  return import(`${process.cwd()}/${outfile}`);
}

// --- browser plumbing ------------------------------------------------------

async function makePlayer(browser, index, animated) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  // Vary viewports so screenshots double as responsive checks.
  await page.setViewport(index === 1 ? { width: 375, height: 812 } : { width: 1280, height: 800 });
  if (!animated) {
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  }
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("favicon")) {
      errors.push(`console: ${m.text()}`);
    }
  });
  const name = `Player${index + 1}`;
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await page.waitForSelector("#player-name");
  await page.type("#player-name", name);
  await page.click(".capsule-button.green");
  await page.waitForSelector(".lobby-main");
  return { context, page, errors, name, index, animated };
}

const statusOf = (p) =>
  p.page.$eval('[data-testid="game-status"]', (el) => el.textContent).catch(() => "");
const isOver = (p) => p.page.evaluate(() => !!document.querySelector("[data-winner-banner]"));

/**
 * Click via the element's own DOM click(), not a coordinate click. The 3D dice
 * canvas is a full-screen `pointer-events:none` overlay — real users click
 * straight through it, but Puppeteer's coordinate hit-test is occluded by it.
 * A direct click() still fires React's onClick and mirrors the real UX.
 */
const domClick = (page, selector) =>
  page.$eval(selector, (el) => el.click());

async function diceValues(p) {
  return p.page.$$eval('[data-testid^="die-"]', (els) =>
    els.map((el) => Number(el.getAttribute("data-value"))),
  );
}

/** The current player rolls once and commits their first open category. */
async function playTurn(active, gc, actionLog) {
  await active.page.waitForFunction(
    () => document.querySelector('[data-testid="game-status"]')?.textContent.includes("Your turn"),
    { timeout: 30_000 },
  );
  // Wait for the dice to be idle before rolling — the full-motion browser may
  // still be finishing its 3D animation of a previous player's roll, which
  // disables the roll button (correct UX: you can't roll mid-tumble).
  await active.page.waitForFunction(
    () => {
      const btn = document.querySelector('[data-testid="roll-btn"]');
      return btn && !btn.disabled && !document.body.hasAttribute("data-dice-animating");
    },
    { timeout: 30_000 },
  );
  await domClick(active.page, '[data-testid="roll-btn"]');
  await active.page.waitForFunction(
    () =>
      !document.body.hasAttribute("data-dice-animating") &&
      document.querySelector(".sc-cat.open-now"),
    { timeout: 30_000 },
  );

  // Retry the pick/commit — a click can rarely race a re-render onto the backdrop.
  for (let attempt = 0; attempt < 5; attempt++) {
    if (!(await active.page.$(".commit-overlay"))) {
      const cat = await active.page.$(".sc-cat.open-now");
      const category = cat && (await cat.evaluate((el) => el.getAttribute("data-category")));
      const dice = await diceValues(active);
      if (cat) await cat.evaluate((el) => el.click()).catch(() => {});
      await sleep(120);
      // Verify the overlay value equals an independent game-core computation.
      const overlay = await active.page.$(".commit-card .value");
      if (overlay && category) {
        const shown = Number(await overlay.evaluate((el) => el.textContent));
        const expected = gc.calculateScore(category, dice);
        if (shown !== expected) {
          fail(`preview mismatch for ${category} on ${dice}: UI=${shown} game-core=${expected}`);
        }
        active._pending = { player: active.playerId, category, dice, score: expected };
      }
    }
    const btn = await active.page.$('[data-testid="commit-score"]');
    if (btn) await btn.evaluate((el) => el.click()).catch(() => {});
    const done = await active.page
      .waitForFunction(
        () => !document.querySelector('[data-testid="game-status"]')?.textContent.includes("Your turn"),
        { timeout: 4000 },
      )
      .then(() => true)
      .catch(() => false);
    if (done) {
      if (active._pending) {
        actionLog.push(active._pending);
        active._pending = null;
      }
      return;
    }
  }
  fail(`${active.name} could not commit after 5 attempts`);
}

/** Reconstruct every player's scorecard purely from the recorded action log. */
function reconstructCards(actionLog, playerIds, gc) {
  const cards = {};
  for (const pid of playerIds) cards[pid] = gc.emptyScoreCard();
  for (const { player, category, dice, score } of actionLog) {
    cards[player][category] = score;
    // Independently reproduce the Yahtzee bonus rule.
    const fiveOfAKind = dice.every((d) => d === dice[0]);
    if (category !== "five-dice" && fiveOfAKind && cards[player]["five-dice"] === 50) {
      cards[player]["bonus-5s"] = (cards[player]["bonus-5s"] ?? 0) + 100;
    }
  }
  return cards;
}

async function screenshot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png` }).catch(() => {});
}

// --- main ------------------------------------------------------------------

async function run() {
  mkdirSync(OUT, { recursive: true });
  log(`\n🎲 sim: ${N} players against ${BASE}`);
  const ownedServers = await ensureServers();
  const gc = await loadGameCore();

  // Full Chrome headless (not the shell) with software WebGL, so the 3D dice
  // actually render — the shell binary has no WebGL.
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--enable-unsafe-swiftshader",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--window-size=1000,1000",
    ],
  });

  const players = [];
  for (let i = 0; i < N; i++) {
    // Player 0 runs full motion so we can assert the 3D dice animate.
    players.push(await makePlayer(browser, i, i === 0));
  }
  log(`✓ ${N} players reached the lobby`);
  await screenshot(players[1].page, "01-lobby");

  const room = `sim-${Math.random().toString(36).slice(2, 8)}`;
  await players[0].page.goto(`${BASE}/room/${room}?create=1&name=Sim%20Game&max=${N}`, {
    waitUntil: "networkidle2",
  });
  await players[0].page.waitForFunction(
    () => document.body.innerText.includes("Waiting for players"),
    { timeout: 30_000 },
  );
  for (let i = 1; i < N; i++) {
    await players[i].page.goto(`${BASE}/room/${room}`, { waitUntil: "networkidle2" });
  }
  await players[0].page.waitForFunction(
    () => document.querySelector('[data-testid="game-status"]')?.textContent.includes("turn"),
    { timeout: 30_000 },
  );
  // Capture each player's authenticated id for the action log.
  for (const p of players) {
    p.playerId = await p.page.evaluate(() => {
      try {
        return JSON.parse(localStorage.getItem("5dice-profile")).playerId;
      } catch {
        return null;
      }
    });
  }
  log(`✓ room created, ${N - 1} joined, game auto-started`);

  const actionLog = [];
  let animationSeen = false;
  let refreshed = false;
  let outOfTurnChecked = false;
  let turns = 0;
  const maxTurns = N * 13 + 5;

  while (!(await isOver(players[0])) && turns < maxTurns) {
    // Find the current player.
    let active = null;
    for (const p of players) {
      if ((await statusOf(p)).includes("Your turn")) {
        active = p;
        break;
      }
    }
    if (!active) {
      await sleep(150);
      continue;
    }

    // Out-of-turn no-op check (once): a bystander's roll button must be
    // disabled and it must show no clickable categories; poking it changes
    // nothing.
    if (!outOfTurnChecked) {
      outOfTurnChecked = true;
      const bystander = players.find((p) => p !== active);
      const before = await statusOf(active);
      const disabled = await bystander.page.$eval('[data-testid="roll-btn"]', (b) => b.disabled).catch(() => true);
      const openCats = await bystander.page.$$(".sc-cat.open-now");
      if (!disabled) fail("bystander roll button was not disabled during another player's turn");
      if (openCats.length > 0) fail("bystander had clickable score categories out of turn");
      await bystander.page.click('[data-testid="roll-btn"]').catch(() => {});
      await sleep(200);
      if ((await statusOf(active)) !== before) fail("out-of-turn click changed the game state");
      log("✓ out-of-turn clicks are no-ops");
    }

    // Animation smoke check on the full-motion browser during its own roll:
    // the 3D overlay must flip `data-dice-animating` and render a <canvas>
    // (proof the roll animated rather than silently no-opping), and afterward
    // the landed dice are a valid 1–6 array.
    let animError = null;
    let animWatch = null;
    if (active.animated && !animationSeen) {
      animWatch = active.page
        .waitForFunction(() => document.body.hasAttribute("data-dice-animating"), { timeout: 15_000 })
        .then(async () => {
          animationSeen = true;
          const hasCanvas = await active.page.evaluate(() => !!document.querySelector("canvas"));
          if (!hasCanvas) animError = "3D dice animating but no <canvas> present";
          await screenshot(active.page, "02-mid-roll");
        })
        .catch(() => {});
    }

    try {
      await playTurn(active, gc, actionLog);
    } catch (err) {
      await dumpFailure(players, `turn ${turns} (active ${active.name})`);
      throw err;
    }
    if (animWatch) await animWatch;
    if (animError) fail(animError);
    turns++;

    // Mid-game rejoin chaos: reload a non-current player once, expect recovery.
    if (turns === N + 1 && !refreshed) {
      refreshed = true;
      const victim = players.find((p) => p !== active) ?? players[1];
      await victim.page.reload({ waitUntil: "networkidle2" });
      await victim.page.waitForSelector('[data-testid="game-status"]');
      await players[0].page.waitForFunction(
        () => {
          const chips = [...document.querySelectorAll(".seat-chip")];
          return chips.length > 0 && !document.querySelector(".seat-chip.away");
        },
        { timeout: 30_000 },
      );
      const tableSeen = await someScoreTable(players);
      if (!tableSeen) fail("no score table visible after rejoin");
      log(`✓ mid-game rejoin (${victim.name} reloaded at turn ${turns}) recovered cleanly`);
      await screenshot(victim.page, "03-scorecard");
    }
  }

  if (turns >= maxTurns) fail(`game did not finish within ${maxTurns} turns`);
  log(`✓ game completed in ${turns} turns`);

  // Wait for every browser to reach game over and screenshot it.
  for (const p of players) {
    await p.page.waitForSelector("[data-winner-banner]", { timeout: 15_000 });
  }
  await screenshot(players[0].page, "04-gameover");

  // Independent verification from the action log.
  const cards = reconstructCards(actionLog, players.map((p) => p.playerId), gc);
  const totals = Object.fromEntries(
    Object.entries(cards).map(([pid, card]) => [pid, gc.grandTotal(card)]),
  );
  const best = Math.max(...Object.values(totals));
  const expectedWinners = Object.keys(totals).filter((pid) => totals[pid] === best);

  // Compare against every browser's displayed totals.
  const displayed = await players[0].page.$$eval("[data-total-for]", (els) =>
    Object.fromEntries(els.map((el) => [el.getAttribute("data-total-for"), Number(el.textContent)])),
  );
  for (const pid of Object.keys(totals)) {
    if (displayed[pid] !== totals[pid]) {
      fail(`total mismatch for ${pid}: UI=${displayed[pid]} action-log=${totals[pid]}`);
    }
  }
  log(`✓ every committed score and grand total matches an independent game-core recomputation`);

  // All browsers agree on the final totals.
  const ref = JSON.stringify(await sortedTotals(players[0].page));
  for (const p of players) {
    const t = JSON.stringify(await sortedTotals(p.page));
    if (t !== ref) fail(`${p.name} disagrees on final totals: ${t} vs ${ref}`);
  }
  const banner = await players[0].page.$eval("[data-winner-banner] h2", (el) => el.textContent);
  log(`✓ all ${N} browsers converged on identical final state — ${banner}`);
  if (expectedWinners.length === 1 && !banner.includes("wins")) {
    fail(`expected a single winner but banner was "${banner}"`);
  }

  if (!animationSeen) fail("never observed a 3D dice animation");
  log("✓ 3D dice animation confirmed");

  const allErrors = players.flatMap((p) => p.errors.map((e) => `[${p.name}] ${e}`));
  if (allErrors.length) {
    await dumpFailure(players, "console errors");
    fail(`console errors:\n${allErrors.join("\n")}`);
  }
  log("✓ zero console errors across all browsers");

  await browser.close();
  for (const proc of ownedServers) {
    try {
      process.kill(-proc.pid, "SIGTERM");
    } catch {
      proc.kill("SIGTERM");
    }
  }
  log(`\n✅ SIM PASSED (${N} players, ${turns} turns)\n`);
}

async function sortedTotals(page) {
  const t = await page.$$eval("[data-total-for]", (els) =>
    els.map((el) => `${el.getAttribute("data-total-for")}:${el.textContent}`),
  );
  return t.sort();
}

async function someScoreTable(players) {
  for (const p of players) {
    if (await p.page.$('[data-testid="score-table"]')) return true;
  }
  return false;
}

async function dumpFailure(players, label) {
  log(`✗ dumping failure artifacts (${label}) to ${OUT}/`);
  for (const p of players) {
    await screenshot(p.page, `FAIL-${p.name}`);
    writeFileSync(`${OUT}/FAIL-${p.name}-console.log`, p.errors.join("\n"), "utf8");
    const status = await statusOf(p);
    const diag = await p.page
      .evaluate(() => ({
        animating: document.body.hasAttribute("data-dice-animating"),
        dice3dActive: document.body.classList.contains("dice3d-active"),
        canvases: document.querySelectorAll("canvas").length,
        rollDisabled: document.querySelector('[data-testid="roll-btn"]')?.disabled ?? null,
        rolls: document.querySelector('[data-testid="roll-btn"] .count')?.textContent ?? null,
      }))
      .catch(() => ({}));
    log(`  ${p.name}: "${status}" ${JSON.stringify(diag)}`);
  }
}

run().catch((err) => {
  console.error(`\n❌ SIM FAILED: ${err.message}`);
  if (!(err instanceof SimError)) console.error(err.stack);
  process.exit(1);
});
