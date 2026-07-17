/**
 * Two-browser end-to-end test: two isolated Puppeteer contexts play a COMPLETE
 * game through the real UI against the real servers, including:
 *   - settings → lobby → create room → join by URL
 *   - every turn: roll (3D animation on A, reduced-motion on B), pick a
 *     category, commit
 *   - a mid-game page refresh on B (rejoin path)
 *   - observer dice animation on A while B rolls
 *   - game over: identical totals on both screens, winner shown, Play Again
 *     resets to a fresh game
 * Any console error on either page fails the run.
 *
 * Usage: node scripts/e2e-game.mjs   (needs `npm run dev` + `npm run party:dev`)
 */
import puppeteer from "puppeteer";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ROOM = `e2e-${Math.random().toString(36).slice(2, 8)}`;

const fail = (msg) => {
  console.error(`\n❌ E2E FAILED: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(page, predicate, label, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await page.evaluate(predicate);
    if (result) return result;
    await sleep(100);
  }
  fail(`timeout waiting for: ${label}`);
}

async function clickTestId(page, id) {
  await page.waitForSelector(`[data-testid="${id}"]:not([disabled])`, { timeout: 30_000 });
  await page.click(`[data-testid="${id}"]`);
}

async function setupPlayer(context, name, reducedMotion) {
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  if (reducedMotion) {
    await page.emulateMediaFeatures([
      { name: "prefers-reduced-motion", value: "reduce" },
    ]);
  }
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await page.waitForSelector("#player-name");
  await page.type("#player-name", name);
  await page.click(".capsule-button.green");
  await page.waitForSelector(".lobby-main");
  return { page, errors, name };
}

async function statusOf(page) {
  return page.$eval('[data-testid="game-status"]', (el) => el.textContent);
}

/** The current player's page plays one turn: roll once, commit first open category. */
async function playTurn(active) {
  await active.page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="game-status"]');
      return el && el.textContent.includes("Your turn");
    },
    { timeout: 30_000 },
  );
  await clickTestId(active.page, "roll-btn");
  // Wait out any 3D animation, then for clickable categories.
  await active.page.waitForFunction(
    () =>
      !document.body.hasAttribute("data-dice-animating") &&
      document.querySelector(".sc-cat.open-now"),
    { timeout: 30_000 },
  );
  // Pick a category and commit. A click can occasionally race a re-render and
  // land on the overlay backdrop (dismissing it) — a human would just re-tap,
  // so the script does too.
  for (let attempt = 0; attempt < 5; attempt++) {
    if (!(await active.page.$(".commit-overlay"))) {
      const cat = await active.page.$(".sc-cat.open-now");
      if (cat) await cat.click().catch(() => {});
      await sleep(150);
    }
    const btn = await active.page.$('[data-testid="commit-score"]');
    if (btn) await btn.click().catch(() => {});
    // Success = the turn passed to the other player or the game ended.
    const done = await active.page
      .waitForFunction(
        () => {
          const s = document.querySelector('[data-testid="game-status"]');
          return s && !s.textContent.includes("Your turn");
        },
        { timeout: 4000 },
      )
      .then(() => true)
      .catch(() => false);
    if (done) return;
  }
  fail(`${active.name} could not commit a score after 5 attempts`);
}

const isOver = (page) =>
  page.evaluate(() => !!document.querySelector("[data-winner-banner]"));

async function main() {
  console.log(`E2E: room ${ROOM} against ${BASE}`);
  const browser = await puppeteer.launch({
    headless: "shell",
    args: ["--no-sandbox", "--window-size=900,900"],
  });

  const ctxA = await browser.createBrowserContext();
  const ctxB = await browser.createBrowserContext();
  const A = await setupPlayer(ctxA, "Alice", false);
  const B = await setupPlayer(ctxB, "Bob", true);
  // A = desktop, B = phone: every saved screenshot doubles as a viewport check.
  await A.page.setViewport({ width: 1280, height: 800 });
  await B.page.setViewport({ width: 375, height: 812 });
  console.log("✓ both players through settings to the lobby");

  const { mkdirSync } = await import("node:fs");
  mkdirSync("sim-output", { recursive: true });
  const shot = (page, name) =>
    page.screenshot({ path: `sim-output/${name}.png` }).catch(() => {});
  await shot(B.page, "lobby-mobile");

  // A creates the room via URL (create params), B joins by URL.
  await A.page.goto(`${BASE}/room/${ROOM}?create=1&name=E2E%20Game&max=2`, {
    waitUntil: "networkidle2",
  });
  await waitFor(
    A.page,
    () => document.body.innerText.includes("Waiting for players"),
    "A seated in waiting room",
  );
  await B.page.goto(`${BASE}/room/${ROOM}`, { waitUntil: "networkidle2" });
  await waitFor(
    A.page,
    () => {
      const s = document.querySelector('[data-testid="game-status"]');
      return s && s.textContent.includes("turn");
    },
    "game auto-started",
  );
  console.log("✓ room created, joined, game auto-started");

  let observerAnimationSeen = false;
  let turns = 0;
  let refreshed = false;

  while (!(await isOver(A.page)) && turns < 40) {
    const aStatus = await statusOf(A.page);
    const active = aStatus.includes("Your turn") ? A : B;

    // While B (reduced-motion) rolls, A should run the 3D animation.
    let animWatcher = null;
    if (active === B && !observerAnimationSeen) {
      animWatcher = A.page
        .waitForFunction(() => document.body.hasAttribute("data-dice-animating"), {
          timeout: 15_000,
        })
        .then(() => {
          observerAnimationSeen = true;
        })
        .catch(() => {});
    }

    try {
      await playTurn(active);
    } catch (err) {
      const sa = await statusOf(A.page).catch(() => "?");
      const sb = await statusOf(B.page).catch(() => "?");
      await A.page.screenshot({ path: "/tmp/e2e-A.png" }).catch(() => {});
      await B.page.screenshot({ path: "/tmp/e2e-B.png" }).catch(() => {});
      console.error(
        `turn ${turns}: active=${active.name} | A status="${sa}" | B status="${sb}" | screenshots in /tmp/e2e-{A,B}.png`,
      );
      throw err;
    }
    if (animWatcher) await animWatcher;
    turns++;

    // Mid-game refresh: after a few turns, reload B and expect full recovery.
    if (turns === 5 && !refreshed) {
      refreshed = true;
      // Whichever page is NOT current shows the comparison table — sample it
      // as proof there was real mid-game state before the reload.
      const aStatusNow = await statusOf(A.page);
      const observerPage = aStatusNow.includes("Your turn") ? B.page : A.page;
      const before = await observerPage.evaluate(() => {
        return document.querySelector('[data-testid="score-table"]')?.innerText ?? "";
      });
      await B.page.reload({ waitUntil: "networkidle2" });
      await B.page.waitForSelector('[data-testid="game-status"]');
      await waitFor(
        A.page,
        () => {
          const seats = [...document.querySelectorAll(".seat-chip")];
          return seats.length > 0 && !document.querySelector(".seat-chip.away");
        },
        "A sees B reconnected after refresh",
      );
      console.log(`✓ mid-game refresh on B at turn ${turns}: rejoined cleanly`);
      if (before.length === 0) fail("observer had no score table before refresh");
    }
  }

  if (turns >= 40) fail("game did not finish within 40 turns");
  console.log(`✓ game completed in ${turns} turns`);

  // Both pages agree on the final state.
  await B.page.waitForSelector("[data-winner-banner]", { timeout: 15_000 });
  const totals = async (page) =>
    page.$$eval("[data-total-for]", (els) =>
      els.map((el) => `${el.getAttribute("data-total-for")}:${el.textContent}`).sort(),
    );
  const [ta, tb] = [await totals(A.page), await totals(B.page)];
  if (JSON.stringify(ta) !== JSON.stringify(tb)) {
    fail(`final totals differ: A=${ta} B=${tb}`);
  }
  const bannerA = await A.page.$eval("[data-winner-banner] h2", (el) => el.textContent);
  const bannerB = await B.page.$eval("[data-winner-banner] h2", (el) => el.textContent);
  if (bannerA !== bannerB) fail(`winner banners differ: "${bannerA}" vs "${bannerB}"`);
  await shot(A.page, "gameover-desktop");
  await shot(B.page, "gameover-mobile");
  console.log(`✓ identical final state on both screens — ${bannerA} (totals ${ta.join(", ")})`);

  if (!observerAnimationSeen) {
    fail("observer never saw a dice animation while the other player rolled");
  }
  console.log("✓ observer-side 3D dice animation confirmed");

  // Play again → fresh game for both.
  await clickTestId(A.page, "play-again");
  await waitFor(
    B.page,
    () => document.body.innerText.includes("Round 1 of 13"),
    "B sees fresh game after Play Again",
  );
  console.log("✓ play again resets to a fresh game on both screens");

  // Console errors?
  const allErrors = [...A.errors, ...B.errors].filter(
    (e) => !e.includes("favicon"),
  );
  if (allErrors.length > 0) {
    fail(`console errors detected:\n${allErrors.join("\n")}`);
  }
  console.log("✓ zero console errors across both browsers");

  await browser.close();
  console.log("\n✅ E2E PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
