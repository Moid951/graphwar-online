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

const wsProbe = () => {
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
};

const browser = await chromium.launch();
async function newPage() {
  const page = await browser.newPage();
  await page.addInitScript(wsProbe);
  return page;
}
async function joinLobby(page, name) {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForSelector("#screen0.active", { timeout: 8000 });
  await page.fill("#menuNameField", name);
  await page.click("#playBtn");
  await page.waitForSelector("#screen2.active", { timeout: 8000 });
}
async function modalFill(page, value) {
  await page.waitForSelector("#modalInput", { timeout: 8000 });
  await page.fill("#modalInput", value);
  await page.click("#modalOkBtn");
  await page.waitForTimeout(200);
}
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

const pageA = await newPage();
const pageB = await newPage();

try {
  await joinLobby(pageA, "Alice");
  ok("A: lobby active after Play", true);
  await joinLobby(pageB, "Bob");
  ok("B: lobby active after Play", true);

  await pageA.click("#createRoomBtn");
  await pageA.fill("#globalCreateName", "Duo Room");
  const privChk = pageA.locator("#globalCreatePrivate");
  await privChk.check();
  await pageA.fill("#globalCreateKey", "secret");
  await pageA.click("#globalCreateGoBtn");
  await pageA.waitForSelector("#screen1.active", { timeout: 8000 });
  ok("A: private room created, pre-game screen active", true);

  await pageA.waitForFunction(
    () => document.querySelectorAll("#preGamePlayers .row").length >= 1,
    { timeout: 8000 }
  );
  const aText = await pageA.textContent("#preGamePlayers");
  ok("A: creator auto-added with name", aText.includes("Alice"));

  await pageB.waitForFunction(
    () =>
      [...document.querySelectorAll("#globalRooms .row")].some((r) => r.textContent.includes("Duo Room")) &&
      [...document.querySelectorAll("#globalRooms .row")].some((r) => r.textContent.includes("Private")),
    { timeout: 8000 }
  );
  ok("B: sees private Duo Room in list", true);

  async function clickRoom(page, name) {
    await page.evaluate((nm) => {
      const row = [...document.querySelectorAll("#globalRooms .row")].find((r) => r.textContent.includes(nm));
      if (row) row.click();
    }, name);
  }

  await clickRoom(pageB, "Duo Room");
  await pageB.waitForSelector("#modalInput", { timeout: 8000 });
  await pageB.fill("#modalInput", "nope");
  await pageB.click("#modalOkBtn");
  await pageB.waitForSelector("#globalMsgPanel", { state: "visible", timeout: 8000 });
  const deniedMsg = await pageB.textContent("#globalMsgText");
  ok("B: wrong key rejected", deniedMsg.includes("Wrong room key"));
  await pageB.click("#globalMsgOkBtn");
  await pageB.waitForSelector("#globalMsgPanel", { state: "hidden", timeout: 8000 });
  ok("B: back in lobby after rejection", true);

  await clickRoom(pageB, "Duo Room");
  await pageB.waitForSelector("#modalInput", { timeout: 8000 });
  await pageB.fill("#modalInput", "secret");
  await pageB.click("#modalOkBtn");
  await pageB.waitForSelector("#screen1.active", { timeout: 8000 });
  ok("B: joined private room with correct key", true);

  await pageB.waitForFunction(
    () => document.querySelectorAll("#preGamePlayers .row").length >= 1,
    { timeout: 8000 }
  );
  const bText = await pageB.textContent("#preGamePlayers");
  ok("B: joiner auto-added with name", bText.includes("Bob"));

  await pageA.waitForFunction(
    () => document.querySelectorAll("#preGamePlayers .row").length >= 2,
    { timeout: 8000 }
  );
  const aBoth = await pageA.textContent("#preGamePlayers");
  ok("A: pre-game shows both players", aBoth.includes("Alice") && aBoth.includes("Bob"));
  ok("A: Bob row shows WAITING badge", aBoth.includes("WAITING"));

  await ensureTwoTeams(pageA, "Bob");

  const bActionLabel = await pageB.textContent("#actionBtn");
  ok("B: player action button says Ready", bActionLabel === "Ready");

  const startDisabledBefore = await pageA.evaluate(() => document.querySelector("#actionBtn").disabled);
  ok("A: Start Game disabled before Bob ready", startDisabledBefore === true);

  await pageB.click("#actionBtn");
  await pageB.waitForFunction(
    () => document.querySelector("#actionBtn")?.textContent === "✓ Ready",
    { timeout: 5000 }
  );
  ok("B: Ready toggled to ✓ Ready", true);

  await pageA.waitForFunction(
    () => {
      const btn = document.querySelector("#actionBtn");
      return btn && btn.textContent === "Start Game" && !btn.disabled;
    },
    { timeout: 8000 }
  );
  ok("A: Start Game enabled when all ready", true);

  await pageA.click("#actionBtn");
  await pageA.waitForFunction(
    () => document.querySelector("#actionBtn")?.textContent === "Cancel",
    { timeout: 5000 }
  );
  ok("A: countdown shows Cancel", true);

  await pageA.click("#actionBtn");
  await pageA.waitForFunction(
    () => document.querySelector("#actionBtn")?.textContent === "Start Game",
    { timeout: 5000 }
  );
  ok("A: leader cancel returns to Start Game", true);

  await pageA.waitForFunction(
    () => {
      const btn = document.querySelector("#actionBtn");
      return btn && btn.textContent === "Start Game" && !btn.disabled;
    },
    { timeout: 8000 }
  );
  await pageA.click("#actionBtn");
  await pageA.waitForSelector("#screen3.active", { timeout: 20000 });
  await pageB.waitForSelector("#screen3.active", { timeout: 20000 });
  ok("A+B: game screen active on both after start", true);

  const logA = await pageA.evaluate(() => window.__wslog.join("\n"));
  const logB = await pageB.evaluate(() => window.__wslog.join("\n"));
  ok("A: received START_GAME", logA.includes("R:22&"));
  ok("B: received START_GAME", logB.includes("R:22&"));

  let angleSeen = false;
  let gameOver = false;
  for (let i = 0; i < 50 && !angleSeen && !gameOver; i++) {
    const onGame = await pageA.evaluate(
      () => document.querySelector("#screen3")?.classList.contains("active") === true
    );
    if (!onGame) break;
    const canUse = await pageA.evaluate(() => {
      const el = document.querySelector("#funcField");
      return el !== null && el.disabled === false;
    });
    if (!canUse) {
      const canB = await pageB.evaluate(() => {
        const el = document.querySelector("#funcField");
        return el !== null && el.disabled === false;
      });
      if (canB) {
        try {
          await pageB.fill("#funcField", "100*x", { timeout: 1000 });
          await pageB.click("#fireBtn", { timeout: 1000 });
        } catch {
          /* continue */
        }
      }
      await pageA.waitForTimeout(500);
      continue;
    }
    try {
      const field = pageA.locator("#funcField");
      await field.focus();
      await pageA.keyboard.down("ArrowUp");
      await pageA.waitForTimeout(300);
      await pageA.keyboard.up("ArrowUp");
      await pageA.waitForTimeout(150);
    } catch {
      /* continue */
    }
    const st = await pageA.evaluate(() => {
      const log = window.__wslog ?? [];
      return {
        angle: log.some((l) => l.startsWith("S:28")),
        over: log.some((l) => l.startsWith("R:40")),
      };
    });
    angleSeen = st.angle;
    gameOver = st.over;
  }
  if (!angleSeen) {
    const diag = await pageA.evaluate(() => ({
      tail: (window.__wslog ?? []).slice(-20),
      timer: document.querySelector("#timer")?.textContent,
      screen: [...document.querySelectorAll(".screen")].find((s) => s.classList.contains("active"))?.id,
      funcDisabled: document.querySelector("#funcField")?.disabled,
    }));
    console.log("ANGLE DIAG", JSON.stringify(diag, null, 2));
  }
  ok("A: angle control sends SET_ANGLE on keyup", angleSeen);

  let bSawAngle = false;
  try {
    await pageB.waitForFunction(
      () => (window.__wslog ?? []).join("\n").includes("R:28&"),
      { timeout: 5000 }
    );
    bSawAngle = true;
  } catch {
    const diag = await pageB.evaluate(() => ({
      tail: (window.__wslog ?? []).slice(-12),
      screen: [...document.querySelectorAll(".screen")].find((s) => s.classList.contains("active"))?.id,
    }));
    console.log("ANGLE B DIAG", JSON.stringify(diag));
  }
  ok("B: received SET_ANGLE broadcast", bSawAngle);

  let liveState = await pageA.evaluate(() => {
    const log = window.__wslog ?? [];
    return {
      fire: log.some((l) => l.startsWith("R:24")),
      nextTurn: log.some((l) => l.startsWith("R:25")),
      over: log.some((l) => l.startsWith("R:40")),
    };
  });
  for (let i = 0; i < 40 && !(liveState.fire || liveState.nextTurn || liveState.over); i++) {
    const canA = await pageA.evaluate(() => {
      const el = document.querySelector("#funcField");
      return el !== null && el.disabled === false;
    });
    if (canA) {
      try {
        await pageA.fill("#funcField", "100*x", { timeout: 1000 });
        await pageA.click("#fireBtn", { timeout: 1000 });
      } catch {
        /* fall through */
      }
    }
    const canB = await pageB.evaluate(() => {
      const el = document.querySelector("#funcField");
      return el !== null && el.disabled === false;
    });
    if (canB) {
      try {
        await pageB.fill("#funcField", "100*x", { timeout: 1000 });
        await pageB.click("#fireBtn", { timeout: 1000 });
      } catch {
        /* fall through */
      }
    }
    await pageA.waitForTimeout(700);
    liveState = await pageA.evaluate(() => {
      const log = window.__wslog ?? [];
      return {
        fire: log.some((l) => l.startsWith("R:24")),
        nextTurn: log.some((l) => l.startsWith("R:25")),
        over: log.some((l) => l.startsWith("R:40")),
      };
    });
  }
  ok("game ran live (fire / NEXT_TURN / GAME_FINISHED)", liveState.fire || liveState.nextTurn || liveState.over);

  let progressed = false;
  try {
    await pageA.waitForFunction(
      () => (window.__wslog ?? []).some((l) => l.startsWith("R:25") || l.startsWith("R:40")),
      { timeout: 12000 }
    );
    progressed = true;
  } catch {
    /* fall through */
  }
  ok("game turns advanced or completed", progressed);

  let timerOk = false;
  try {
    await pageB.waitForFunction(
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
  ok("B: timer renders on game screen", timerOk);

  async function exitToLobby(page) {
    for (let i = 0; i < 6; i++) {
      const screen = await page.evaluate(
        () => [...document.querySelectorAll(".screen")].find((s) => s.classList.contains("active"))?.id
      );
      if (screen === "screen2") return;
      try {
        if (screen === "screen3") {
          await page.click("#quitBtn", { timeout: 3000 });
          await page.waitForSelector("#confirmOkBtn", { timeout: 3000 });
          await page.click("#confirmOkBtn");
        } else if (screen === "screen1") {
          await page.click("#preGameBackBtn", { timeout: 3000 });
        }
      } catch {
        await page.waitForTimeout(500);
      }
    }
  }
  await exitToLobby(pageA);
  await exitToLobby(pageB);
  await pageA.waitForSelector("#screen2.active", { timeout: 8000 });
  await pageB.waitForSelector("#screen2.active", { timeout: 8000 });
  ok("A+B: both returned to lobby after quit", true);
} catch (e) {
  ok(`exception: ${e.message.split("\n")[0]}`, false);
}

console.log(results.join("\n"));
await browser.close();
process.exit(process.exitCode ?? 0);