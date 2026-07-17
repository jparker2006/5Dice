/**
 * Voice-chat verification with fake media devices.
 *
 *   node scripts/voice-test.mjs   (needs the dev servers running)
 *
 * Proves:
 *   - Two browsers that enable their mics establish a real audio peer
 *     connection (RTCPeerConnection reaches connectionState "connected").
 *   - A 3-player room gives each browser exactly one <audio> element per remote
 *     peer — two each (the legacy single-element bug is gone).
 *   - Mic and speaker toggles flip state.
 *   - A voice failure (getUserMedia throws) fails gracefully and leaves the game
 *     fully playable — voice is isolated from game state.
 *
 * Chromium fakes the mic: --use-fake-ui-for-media-stream auto-grants
 * permission, --use-fake-device-for-media-stream supplies a synthetic track.
 */
import puppeteer from "puppeteer";
import { ensureServers, stopServers } from "./servers.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const log = (m) => console.log(m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class VErr extends Error {}
const fail = (m) => {
  throw new VErr(m);
};

async function launch() {
  return puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--enable-unsafe-swiftshader",
      "--use-gl=angle",
      "--use-angle=swiftshader",
    ],
  });
}

async function joinPlayer(browser, name, breakMic = false) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  if (breakMic) {
    await page.evaluateOnNewDocument(() => {
      // Simulate a device with no working mic (permission denied).
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException("denied", "NotAllowedError"));
    });
  }
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("favicon")) errors.push(m.text());
  });
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await page.waitForSelector("#player-name");
  await page.type("#player-name", name);
  await page.click(".capsule-button.green");
  await page.waitForSelector(".lobby-main");
  return { context, page, errors, name };
}

const peerStates = (page) =>
  page.$$eval("[data-voice-peer]", (els) => els.map((el) => el.dataset.state));

async function waitConnected(page, label) {
  const ok = await page
    .waitForFunction(
      () => {
        const els = [...document.querySelectorAll("[data-voice-peer]")];
        return els.length > 0 && els.some((el) => el.dataset.state === "connected");
      },
      { timeout: 25_000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!ok) fail(`${label} never reached a connected voice peer (states: ${await peerStates(page)})`);
}

async function enterRoom(players, room, max) {
  await players[0].page.goto(`${BASE}/room/${room}?create=1&name=Voice&max=${max}`, {
    waitUntil: "networkidle2",
  });
  await players[0].page.waitForFunction(
    () => document.body.innerText.includes("Waiting for players"),
    { timeout: 30_000 },
  );
  for (let i = 1; i < players.length; i++) {
    await players[i].page.goto(`${BASE}/room/${room}`, { waitUntil: "networkidle2" });
  }
  for (const p of players) {
    await p.page.waitForFunction(
      () => document.querySelector('[data-testid="game-status"]')?.textContent.includes("turn"),
      { timeout: 30_000 },
    );
  }
}

async function checkAudioConnects(browser) {
  const room = `voice-${Math.random().toString(36).slice(2, 7)}`;
  const a = await joinPlayer(browser, "Ava");
  const b = await joinPlayer(browser, "Ben");
  await enterRoom([a, b], room, 2);
  log("✓ 2-player voice room started");

  await a.page.click('[data-testid="btn-mic"]');
  await b.page.click('[data-testid="btn-mic"]');
  await waitConnected(a.page, "Ava");
  await waitConnected(b.page, "Ben");
  log("✓ audio peer connection reached 'connected' on both browsers");

  for (const p of [a, b]) {
    const n = (await peerStates(p.page)).length;
    if (n !== 1) fail(`${p.name} has ${n} audio elements, expected 1`);
  }
  log("✓ one <audio> element per remote peer (2-player)");

  // Mic and speaker toggles flip.
  const micPressed = await a.page.$eval('[data-testid="btn-mic"]', (el) => el.getAttribute("aria-pressed"));
  if (micPressed !== "true") fail("mic should read enabled after turning it on");
  const spkBefore = await a.page.$eval('[data-testid="btn-speaker"]', (el) => el.getAttribute("aria-pressed"));
  await a.page.click('[data-testid="btn-speaker"]');
  const spkAfter = await a.page.$eval('[data-testid="btn-speaker"]', (el) => el.getAttribute("aria-pressed"));
  if (spkBefore === spkAfter) fail("speaker toggle did not change state");
  log("✓ mic and speaker toggles work");

  const errs = [...a.errors, ...b.errors];
  if (errs.length) fail(`console errors: ${errs.join(" | ")}`);
  await a.context.close();
  await b.context.close();
}

async function checkThreePeers(browser) {
  const room = `voice3-${Math.random().toString(36).slice(2, 7)}`;
  const players = [];
  for (const name of ["P1", "P2", "P3"]) players.push(await joinPlayer(browser, name));
  await enterRoom(players, room, 3);
  for (const p of players) await p.page.click('[data-testid="btn-mic"]');
  // Each browser holds exactly two remote audio elements…
  for (const p of players) {
    await p.page.waitForFunction(
      () => document.querySelectorAll("[data-voice-peer]").length === 2,
      { timeout: 20_000 },
    );
  }
  // …and reaches a connection.
  for (const p of players) await waitConnected(p.page, `${p.name}(3p)`);
  log("✓ 3-player room: exactly two audio elements per browser, connections established");
  for (const p of players) await p.context.close();
}

async function checkFailureIsolation(browser) {
  const room = `voicefail-${Math.random().toString(36).slice(2, 7)}`;
  const a = await joinPlayer(browser, "Cora");
  const b = await joinPlayer(browser, "Dex", /* breakMic */ true);
  await enterRoom([a, b], room, 2);

  // Dex's mic is broken: enabling it must fail silently, staying off.
  await b.page.$eval('[data-testid="btn-mic"]', (el) => el.click());
  await sleep(500);
  const pressed = await b.page.$eval('[data-testid="btn-mic"]', (el) => el.getAttribute("aria-pressed"));
  if (pressed === "true") fail("a broken mic must not report as enabled");
  log("✓ broken mic fails gracefully (stays off)");

  // The game is still fully playable for the broken-mic player.
  const roller = (await a.page.$eval('[data-testid="roll-btn"]', (el) => !el.disabled)) ? a : b;
  await roller.page.$eval('[data-testid="roll-btn"]', (el) => el.click());
  await roller.page.waitForFunction(() => document.querySelector(".sc-cat.open-now"), {
    timeout: 15_000,
  });
  await roller.page.$eval(".sc-cat.open-now", (el) => el.click());
  await roller.page.$eval('[data-testid="commit-score"]', (el) => el.click());
  await roller.page.waitForFunction(
    () => !document.querySelector('[data-testid="game-status"]')?.textContent.includes("Your turn"),
    { timeout: 15_000 },
  );
  log("✓ game fully playable despite the voice failure");

  const errs = [...a.errors, ...b.errors];
  if (errs.length) fail(`console errors: ${errs.join(" | ")}`);
  await a.context.close();
  await b.context.close();
}

async function main() {
  log(`\n🎙️  voice test against ${BASE}`);
  const servers = await ensureServers(log);
  const browser = await launch();
  try {
    await checkAudioConnects(browser);
    await checkThreePeers(browser);
    await checkFailureIsolation(browser);
    log("\n✅ VOICE TEST PASSED\n");
  } finally {
    await browser.close();
    stopServers(servers);
  }
}

main().catch((err) => {
  console.error(`\n❌ VOICE TEST FAILED: ${err.message}`);
  if (!(err instanceof VErr)) console.error(err.stack);
  process.exit(1);
});
