// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Constants, NetworkProtocol } from "@graphwar/math";
import { GraphUI } from "../src/ui/screens.js";
import { GraphPlane } from "../src/ui/plane.js";
import { GameData } from "../src/gameData.js";
import { GlobalClient } from "../src/network.js";
import type { SocketFactory, SocketEvents, SocketLike } from "../src/network.js";
import { javaUrlEncode } from "@graphwar/math";

function fakeCtx(): CanvasRenderingContext2D {
  const noop = (): void => {};
  const props: Record<string, unknown> = {
    measureText: () => ({ width: 10 }),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: noop,
    drawImage: noop,
    clearRect: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    closePath: noop,
    stroke: noop,
    arc: noop,
    fill: noop,
    fillText: noop,
    strokeText: noop,
    setTransform: noop,
    save: noop,
    restore: noop,
    translate: noop,
    scale: noop,
    rotate: noop,
  };
  return new Proxy(props as unknown as CanvasRenderingContext2D, {
    get: (t, k) => {
      const rec = t as unknown as Record<string | symbol, unknown>;
      if (k in rec) return rec[k];
      if (typeof k === "string") return 0;
      return undefined;
    },
    set: () => true,
  });
}

class FakeSocket implements SocketLike {
  sent: string[] = [];
  events: SocketEvents;
  constructor(events: SocketEvents) {
    this.events = events;
  }
  send(m: string): void {
    this.sent.push(m);
  }
  close(): void {}
  serverMessage(m: string): void {
    this.events.onMessage(m);
  }
}
class FakeFactory implements SocketFactory {
  sockets: FakeSocket[] = [];
  connect(url: string, events: SocketEvents): SocketLike {
    const s = new FakeSocket(events);
    this.sockets.push(s);
    return s;
  }
}

describe("GraphUI (DOM)", () => {
  beforeEach(() => {
    const proto = globalThis.HTMLCanvasElement.prototype;
    Object.defineProperty(proto, "getContext", {
      configurable: true,
      writable: true,
      value: () => fakeCtx(),
    });
  });

  it("builds 4 screens and setScreen toggles active", () => {
    const root = document.createElement("div");
    const factory = new FakeFactory();
    const gd = new GameData(null, factory);
    const gc = new GlobalClient(factory, () => 0, () => 0);
    const ui = new GraphUI(root, gd, gc);

    expect(ui.screens.length).toBe(4);
    expect(ui.activeScreen).toBe(Constants.MAIN_MENU_SCREEN);
    expect(root.querySelector("#screen0")!.classList.contains("active")).toBe(true);

    ui.setScreen(Constants.GLOBAL_ROOM_SCREEN);
    expect(root.querySelector("#screen0")!.classList.contains("active")).toBe(false);
    expect(root.querySelector("#screen2")!.classList.contains("active")).toBe(true);
  });

  it("lobby create-room panel shows/hides and validates key", () => {
    const root = document.createElement("div");
    const factory = new FakeFactory();
    const gd = new GameData(null, factory);
    const gc = new GlobalClient(factory, () => 0, () => 0);
    const ui = new GraphUI(root, gd, gc);

    let created: [string, string] | null = null;
    ui.onCreateRoomGlobal = (name, key) => {
      created = [name, key];
    };

    const createBtn = root.querySelector("#createRoomBtn") as HTMLElement;
    createBtn.click();
    const nameField = root.querySelector("#globalCreateName") as HTMLInputElement;
    const panel = nameField.closest(".menu-panel") as HTMLElement;
    expect(panel.style.display).not.toBe("none");
    (root.querySelector("#globalCreateBackBtn") as HTMLElement).click();
    expect(panel.style.display).toBe("none");

    createBtn.click();
    nameField.value = "Pub";
    (root.querySelector("#globalCreateGoBtn") as HTMLElement).click();
    expect(created).toEqual(["Pub", ""]);

    const privChk = root.querySelector("#globalCreatePrivate") as HTMLInputElement;
    privChk.checked = true;
    privChk.dispatchEvent(new Event("change"));
    const keyField = root.querySelector("#globalCreateKey") as HTMLInputElement;
    expect(keyField.disabled).toBe(false);
    keyField.value = "secret";
    (root.querySelector("#globalCreateGoBtn") as HTMLElement).click();
    expect(created).toEqual(["Pub", "secret"]);
  });

  it("menu name field syncs via setGlobalName/getGlobalName", () => {
    const root = document.createElement("div");
    const factory = new FakeFactory();
    const gd = new GameData(null, factory);
    const gc = new GlobalClient(factory, () => 0, () => 0);
    const ui = new GraphUI(root, gd, gc);
    ui.setGlobalName("Zed");
    expect(ui.getGlobalName()).toBe("Zed");
    const field = root.querySelector("#menuNameField") as HTMLInputElement;
    field.value = "Neo";
    expect(ui.getGlobalName()).toBe("Neo");
  });

  it("menu Play button triggers onJoinGlobal", () => {
    const root = document.createElement("div");
    const factory = new FakeFactory();
    const gd = new GameData(null, factory);
    const gc = new GlobalClient(factory, () => 0, () => 0);
    const ui = new GraphUI(root, gd, gc);
    let joined = false;
    ui.onJoinGlobal = () => {
      joined = true;
    };
    (root.querySelector("#playBtn") as HTMLElement).click();
    expect(joined).toBe(true);
  });

  it("pre-game players refresh renders rows", () => {
    const root = document.createElement("div");
    const factory = new FakeFactory();
    const gd = new GameData(null, factory);
    const gc = new GlobalClient(factory, () => 0, () => 0);
    const ui = new GraphUI(root, gd, gc);
    gd.setUI(ui);
    gd.connect(1);
    ui.setScreen(Constants.PRE_GAME_SCREEN);

    gd.connection!.receive(`${NetworkProtocol.ADD_PLAYER}&0&${javaUrlEncode("Alice")}&1&1&2&0`);
    ui.preGameRepaint();
    const list = root.querySelector("#preGamePlayers")! as HTMLElement;
    expect(list.textContent).toContain("Alice");
    expect(list.textContent).toContain("Not Ready");

    const modeBtn = root.querySelector("#modeBtn")! as HTMLElement;
    ui.preGameSetMode(Constants.FST_ODE);
    expect(modeBtn.textContent).toBe("1st ODE");

    const actionBtn = root.querySelector("#actionBtn")! as HTMLButtonElement;
    expect(actionBtn.textContent).toBe("Ready");
  });

  it("pre-game chat appends system + named messages", () => {
    const root = document.createElement("div");
    const factory = new FakeFactory();
    const gd = new GameData(null, factory);
    const gc = new GlobalClient(factory, () => 0, () => 0);
    const ui = new GraphUI(root, gd, gc);
    ui.setScreen(Constants.PRE_GAME_SCREEN);

    ui.chatPregame(null, "system message");
    ui.chatPregame({ name: "Bob", color: "#ff0" } as never, "hello");
    const log = root.querySelector("#preGameChat")! as HTMLElement;
    expect(log.textContent).toContain("system message");
    expect(log.textContent).toContain("Bob");
    expect(log.textContent).toContain("hello");
  });

  it("global rooms render rows and click joins room", () => {
    const root = document.createElement("div");
    const factory = new FakeFactory();
    const gd = new GameData(null, factory);
    const gc = new GlobalClient(factory, () => 0, () => 0);
    const ui = new GraphUI(root, gd, gc);

    let joined: { name: string; roomID: number; port: number; private: boolean } | null = null;
    ui.onJoinRoom = (room) => {
      joined = room;
    };
    gc.rooms.push({ name: "R1", roomID: 1, ip: "127.0.0.1", port: 20001, mode: 0, numPlayers: 2, private: false });
    ui.globalRefreshRooms();

    const rooms = root.querySelector("#globalRooms")! as HTMLElement;
    expect(rooms.textContent).toContain("R1");
    expect(rooms.textContent).toContain("Public");
    expect(rooms.textContent).toContain("Normal");
    const joinBtn = rooms.querySelector(".join-btn") as HTMLElement;
    joinBtn.click();
    expect(joined).toEqual({ name: "R1", roomID: 1, port: 20001, private: false });
  });

  it("private rooms render a Private status", () => {
    const root = document.createElement("div");
    const factory = new FakeFactory();
    const gd = new GameData(null, factory);
    const gc = new GlobalClient(factory, () => 0, () => 0);
    const ui = new GraphUI(root, gd, gc);
    gc.rooms.push({ name: "Sec", roomID: 9, ip: "127.0.0.1", port: 20009, mode: 0, numPlayers: 0, private: true });
    ui.globalRefreshRooms();
    const rooms = root.querySelector("#globalRooms")! as HTMLElement;
    expect(rooms.textContent).toContain("Private");
  });

  it("chatGlobal appends to the lobby chat log", () => {
    const root = document.createElement("div");
    const factory = new FakeFactory();
    const gd = new GameData(null, factory);
    const gc = new GlobalClient(factory, () => 0, () => 0);
    const ui = new GraphUI(root, gd, gc);
    ui.chatGlobal("Alice", "hi");
    const log = root.querySelector("#globalChat")! as HTMLElement;
    expect(log.textContent).toContain("Alice");
    expect(log.textContent).toContain("hi");
  });

  it("action button shows Ready states for a player", () => {
    const root = document.createElement("div");
    const factory = new FakeFactory();
    const gd = new GameData(null, factory);
    const gc = new GlobalClient(factory, () => 0, () => 0);
    const ui = new GraphUI(root, gd, gc);
    const btn = root.querySelector("#actionBtn")! as HTMLButtonElement;
    ui.preGameSetReadyButtonOn(false);
    expect(btn.textContent).toBe("Ready");
    ui.preGameSetReadyButtonOn(true);
    expect(btn.textContent).toBe("✓ Ready");
    ui.preGameSetCountdownActive(true);
    expect(btn.textContent).toBe("Cancel");
  });

  it("ui.prompt shows modal and resolves entered value", async () => {
    const root = document.createElement("div");
    const factory = new FakeFactory();
    const gd = new GameData(null, factory);
    const gc = new GlobalClient(factory, () => 0, () => 0);
    const ui = new GraphUI(root, gd, gc);
    const p = ui.prompt("Player name", "Player");
    const input = document.querySelector("#modalInput") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    if (input !== null) {
      input.value = "Bob";
      (document.querySelector("#modalOkBtn") as HTMLElement).click();
    }
    expect(await p).toBe("Bob");
  });

  it("ui.prompt resolves null on cancel", async () => {
    const root = document.createElement("div");
    const factory = new FakeFactory();
    const gd = new GameData(null, factory);
    const gc = new GlobalClient(factory, () => 0, () => 0);
    const ui = new GraphUI(root, gd, gc);
    const p = ui.prompt("Player name", "Player");
    const cancel = document.querySelector("#modalCancelBtn") as HTMLElement | null;
    expect(cancel).not.toBeNull();
    if (cancel !== null) cancel.click();
    expect(await p).toBeNull();
  });

  it("game screen render loop draws timer and plane without throwing", () => {
    const root = document.createElement("div");
    const factory = new FakeFactory();
    const gd = new GameData(null, factory);
    const gc = new GlobalClient(factory, () => 0, () => 0);
    const ui = new GraphUI(root, gd, gc);
    gd.setUI(ui);
    gd.connect(1);
    ui.setScreen(Constants.GAME_SCREEN);

    gd.connection!.receive(`${NetworkProtocol.ADD_PLAYER}&0&${javaUrlEncode("Alice")}&1&1&2&0`);
    gd.connection!.receive(
      [
        NetworkProtocol.START_GAME,
        "1",
        "300",
        "200",
        "40",
        "50",
        "300",
        "720",
        "100",
        "100",
        "150",
        "700",
        "350",
        "0",
      ].join("&")
    );
    ui.renderGame();
    expect(gd.gameState).toBe(Constants.GAME);
  });

  it("GraphPlane renders terrain from obstacle", () => {
    const root = document.createElement("div");
    const factory = new FakeFactory();
    const gd = new GameData(null, factory);
    const gc = new GlobalClient(factory, () => 0, () => 0);
    const ui = new GraphUI(root, gd, gc);
    gd.setUI(ui);
    gd.connect(1);

    gd.connection!.receive(`${NetworkProtocol.ADD_PLAYER}&0&${javaUrlEncode("Alice")}&1&1&2&0`);
    gd.connection!.receive(
      [
        NetworkProtocol.START_GAME,
        "1",
        "300",
        "200",
        "40",
        "50",
        "300",
        "720",
        "100",
        "100",
        "150",
        "700",
        "350",
        "0",
      ].join("&")
    );
    const plane = new GraphPlane();
    plane.setTerrain(gd.obstacle!);
    expect(() => plane.render(gd)).not.toThrow();
  });
});