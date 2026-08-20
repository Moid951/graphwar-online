import { chromium } from "playwright";

const base = "http://127.0.0.1:8080";
const results = [];
let step = 0;

function ok(label, cond) {
  step++;
  if (cond) {
    results.push(`PASS ${step}: ${label}`);
  } else {
    results.push(`FAIL ${step}: ${label}`);
    process.exitCode = 1;
  }
}

const browser = await chromium.launch();
const page = await browser.newPage();

const errors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("pageerror", (err) => errors.push(String(err)));
await page.addInitScript(() => {
  window.__raf = 0;
  const tick = () => {
    window.__raf++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__wslog = [];
  const Orig = window.WebSocket;
  const Wrap = function (url, protocols) {
    const ws = protocols ? new Orig(url, protocols) : new Orig(url);
    ws.addEventListener("message", (ev) => {
      window.__wslog.push("R:" + String(ev.data));
    });
    const origSend = ws.send.bind(ws);
    ws.send = (data) => {
      window.__wslog.push("S:" + String(data));
      origSend(data);
    };
    return ws;
  };
  Wrap.OPEN = Orig.OPEN;
  Wrap.CONNECTING = Orig.CONNECTING;
  Wrap.CLOSING = Orig.CLOSING;
  Wrap.CLOSED = Orig.CLOSED;
  window.WebSocket = Wrap;
});

async function ensureTwoTeams(page, name) {
  const teams = await page.evaluate(
    () =>
      [...document.querySelectorAll("#preGamePlayers .row")].map((r) =>
        r.querySelector(".badge.team")?.textContent
      )
  );
  const distinct = new Set(teams);
  if (distinct.size > 1) return;
  await page.evaluate((nm) => {
    const row = [...document.querySelectorAll("#preGamePlayers .row")].find((r) => r.textContent.includes(nm));
    const sw = row && row.querySelector('[id^="switchBtn-"]');
    if (sw) sw.click();
  }, name);
  await page.waitForTimeout(400);
}

try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForSelector("#screen0.active", { timeout: 8000 });
  ok("menu screen active on load", true);

  await page.fill("#menuNameField", "Tester");
  await page.click("#playBtn");
  await page.waitForSelector("#screen2.active", { timeout: 8000 });
  ok("lobby screen active after Play", true);

  await page.waitForFunction(
    () => document.querySelectorAll("#globalRooms .row").length >= 3,
    { timeout: 8000 }
  );
  const roomCount = await page.$$eval("#globalRooms .row", (els) => els.length);
  ok("global rooms list shows public rooms", roomCount >= 3);

  const roomsText = await page.textContent("#globalRooms");
  ok("room rows show status column", roomsText.includes("Public"));

  await page.click("#createRoomBtn");
  await page.fill("#globalCreateName", "Browser Room");
  await page.click("#globalCreateGoBtn");
  await page.waitForSelector("#screen1.active", { timeout: 8000 });
  ok("pre-game screen active after room create", true);

  await page.waitForFunction(
    () => document.querySelectorAll("#preGamePlayers .row").length >= 1,
    { timeout: 8000 }
  );
  const playerText = await page.textContent("#preGamePlayers");
  ok("creator auto-added as a player", playerText.includes("Tester"));
  ok("creator row shows You badge", playerText.includes("You"));
  ok("creator row shows Host badge", playerText.includes("Host"));

  await page.click("#addPlayerBtn");
  await page.click("#addPlayerComputerBtn");
  await page.waitForSelector("#modalInput", { timeout: 8000 });
  await page.fill("#modalInput", "Hal");
  await page.click("#modalOkBtn");
  await page.waitForFunction(
    () => document.querySelectorAll("#preGamePlayers .row").length >= 2,
    { timeout: 8000 }
  );

  await ensureTwoTeams(page, "Hal");

  const actionLabel = await page.textContent("#actionBtn");
  ok("leader action button says Start Game", actionLabel === "Start Game");

  const actionEnabled = await page.evaluate(() => !document.querySelector("#actionBtn").disabled);
  ok("Start Game enabled when all players ready", actionEnabled);

  await page.click("#actionBtn");
  await page.waitForSelector("#screen3.active", { timeout: 15000 });
  ok("game screen active after start", true);

  let timerOk = false;
  try {
    await page.waitForFunction(
      () => {
        const t = document.querySelector("#timer");
        return t && t.textContent.length > 0;
      },
      { timeout: 6000 }
    );
    timerOk = true;
  } catch {
    /* fall through */
  }
  if (!timerOk) {
    const st = await page.evaluate(() => ({
      wslog: (window.__wslog ?? []).slice(-15),
    }));
    console.log(`FLAKE timer empty`, JSON.stringify(st));
  }
  ok("timer renders on game screen", timerOk);

  await page.fill("#funcField", "sin(x)");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  const funcVal = await page.inputValue("#funcField");
  ok("function preview echoed into field", funcVal.includes("sin"));

  const shot = await page.screenshot({ path: "test/game-screen.png" });
  ok("game screenshot captured", shot.length > 0);

  await page.click("#quitBtn");
  await page.waitForSelector("#confirmOkBtn", { timeout: 5000 });
  await page.click("#confirmOkBtn");
  await page.waitForSelector("#screen2.active", { timeout: 8000 });
  ok("returned to lobby after quit", true);
} catch (e) {
  ok(`exception: ${e.message.split("\n")[0]}`, false);
}

if (errors.length > 0) {
  results.push(`CONSOLE ERRORS (${errors.length}): ${errors.slice(0, 5).join(" | ")}`);
}

console.log(results.join("\n"));
await browser.close();
process.exit(process.exitCode ?? 0);