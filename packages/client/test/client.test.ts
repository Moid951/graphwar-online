import { describe, it, expect, afterEach } from "vitest";
import { Constants, NetworkProtocol, javaUrlEncode } from "@graphwar/math";
import { GameData, GameUI, ComputerPlayer } from "../src/gameData.js";
import { GlobalClient, WsSocket } from "../src/network.js";
import type { SocketFactory, SocketEvents, SocketLike } from "../src/network.js";
import { Player } from "../src/models.js";

const SOLDIERS = ["50", "300", "720", "100", "100", "150", "700", "350"];

function startGameMsg(obstacle: number[], startPlayer: string): string {
  return [
    NetworkProtocol.START_GAME,
    String(obstacle.length / 3),
    ...obstacle.map(String),
    ...SOLDIERS,
    startPlayer,
  ].join("&");
}

class FakeSocket implements SocketLike {
  sent: string[] = [];
  closed = false;
  events: SocketEvents;
  constructor(events: SocketEvents) {
    this.events = events;
  }
  send(message: string): void {
    this.sent.push(message);
  }
  close(): void {
    this.closed = true;
  }
  serverMessage(message: string): void {
    this.events.onMessage(message);
  }
}

class FakeFactory implements SocketFactory {
  sockets: FakeSocket[] = [];
  urls: string[] = [];
  connect(url: string, events: SocketEvents): SocketLike {
    this.urls.push(url);
    const s = new FakeSocket(events);
    this.sockets.push(s);
    return s;
  }
}

function makeUI(): { ui: GameUI; calls: string[] } {
  const calls: string[] = [];
  const noop = (): void => {};
  const ui: GameUI = {
    chatPregame: () => calls.push("chatPregame"),
    chatGame: () => calls.push("chatGame"),
    preGameAddPlayer: () => calls.push("preGameAddPlayer"),
    preGameRemovePlayer: () => calls.push("preGameRemovePlayer"),
    preGameUpdatePlayer: () => calls.push("preGameUpdatePlayer"),
    preGameSetMode: () => calls.push("preGameSetMode"),
    preGameSetReadyButtonOn: noop,
    preGameSetCountdownActive: noop,
    preGameRepaint: noop,
    preGameShowMessage: noop,
    preGameRefreshBoard: noop,
    preGameRestartScreen: noop,
    gameStartDrawingFunction: () => calls.push("gameStartDrawingFunction"),
    gameUpdateFunction: noop,
    gameRefreshFunction: noop,
    gameRefreshSoldiers: noop,
    gameRefreshBack: noop,
    gameRepaintAngle: noop,
    gameStopPanel: noop,
    gameShowMessage: noop,
    gameSetNextMarker: noop,
    enterGameScreen: () => calls.push("enterGameScreen"),
    enterPregameScreen: () => calls.push("enterPregameScreen"),
    globalRefreshGameButton: noop,
    globalRefreshPlayers: noop,
    globalRefreshRooms: noop,
    globalShowDisconnectMessage: noop,
  };
  return { ui, calls };
}

describe("GameData", () => {
  let factory: FakeFactory;
  let gd: GameData;
  let ui: GameUI;
  let calls: string[];

  function fresh(): void {
    factory = new FakeFactory();
    const made = makeUI();
    ui = made.ui;
    calls = made.calls;
    gd = new GameData(ui, factory);
    gd.connect(1);
  }

  function twoPlayers(): void {
    gd.connection!.receive(`${NetworkProtocol.ADD_PLAYER}&0&${javaUrlEncode("Alice")}&1&1&2&0`);
    gd.connection!.receive(`${NetworkProtocol.ADD_PLAYER}&1&${javaUrlEncode("Bob")}&2&0&2&0`);
  }

  function startGame(startPlayer: string): void {
    twoPlayers();
    gd.connection!.receive(startGameMsg([300, 200, 40, 100, 400, 25], startPlayer));
  }

  afterEach(() => {
    gd?.connection?.close();
  });

  it("connect opens ws on /room/<id> and enters PRE_GAME", () => {
    fresh();
    expect(factory.urls[0]).toBe("ws://localhost/room/1");
    expect(gd.gameState).toBe(Constants.PRE_GAME);
  });

  it("ADD_PLAYER builds a Player and notifies UI", () => {
    fresh();
    gd.connection!.receive(`${NetworkProtocol.ADD_PLAYER}&0&${javaUrlEncode("Alice")}&1&1&2&0`);
    expect(gd.players.length).toBe(1);
    expect(gd.players[0].name).toBe("Alice");
    expect(gd.players[0].team).toBe(Constants.TEAM1);
    expect(gd.players[0].localPlayer).toBe(true);
    expect(gd.players[0].numSoldiers).toBe(2);
    expect(calls).toContain("preGameAddPlayer");
  });

  it("ADD_PLAYER with pending PC level creates ComputerPlayer", () => {
    fresh();
    gd.addPC("Hal", 50);
    gd.connection!.receive(`${NetworkProtocol.ADD_PLAYER}&0&${javaUrlEncode("Hal")}&1&1&2&0`);
    expect(gd.players[0]).toBeInstanceOf(ComputerPlayer);
  });

  it("SET_TEAM updates team", () => {
    fresh();
    gd.connection!.receive(`${NetworkProtocol.ADD_PLAYER}&0&${javaUrlEncode("Alice")}&1&1&2&0`);
    gd.connection!.receive(`${NetworkProtocol.SET_TEAM}&${Constants.TEAM2}&0`);
    expect(gd.players[0].team).toBe(Constants.TEAM2);
  });

  it("ADD_SOLDIER / REMOVE_SOLDIER update soldier count", () => {
    fresh();
    gd.connection!.receive(`${NetworkProtocol.ADD_PLAYER}&0&${javaUrlEncode("Alice")}&1&1&2&0`);
    gd.connection!.receive(`${NetworkProtocol.ADD_SOLDIER}&0`);
    expect(gd.players[0].numSoldiers).toBe(3);
    gd.connection!.receive(`${NetworkProtocol.REMOVE_SOLDIER}&0`);
    expect(gd.players[0].numSoldiers).toBe(2);
  });

  it("START_GAME builds terrain, soldiers, starts turn, enters game screen", () => {
    fresh();
    startGame("1");
    expect(gd.gameState).toBe(Constants.GAME);
    expect(gd.obstacle).not.toBeNull();
    expect(gd.currentTurn).toBe(1);
    expect(gd.players[0].soldiers[0].alive).toBe(true);
    expect(gd.players[0].soldiers[0].x).toBe(50);
    expect(calls).toContain("enterGameScreen");
  });

  it("FIRE_FUNC processes trajectory and sets drawingFunction", () => {
    fresh();
    startGame("0");
    gd.connection!.receive(`${NetworkProtocol.FIRE_FUNC}&0&${javaUrlEncode("sin(x)")}`);
    expect(gd.drawingFunction).toBe(true);
    expect(gd.function).not.toBeNull();
    expect(gd.simResult).not.toBeNull();
    expect(calls).toContain("gameStartDrawingFunction");
  });

  it("NEXT_TURN advances to next alive soldier", () => {
    fresh();
    startGame("1");
    const before = gd.currentTurn;
    gd.connection!.receive(`${NetworkProtocol.NEXT_TURN}`);
    expect(gd.currentTurn).toBe((before + 1) % 2);
    expect(gd.drawingFunction).toBe(false);
  });

  it("SET_READY false during countdown cancels start", () => {
    fresh();
    gd.connection!.receive(`${NetworkProtocol.ADD_PLAYER}&0&${javaUrlEncode("Alice")}&1&1&2&0`);
    gd.connection!.receive(`${NetworkProtocol.START_COUNTDOWN}`);
    expect(gd.countingDown).toBe(true);
    gd.connection!.receive(`${NetworkProtocol.SET_READY}&0&0`);
    expect(gd.countingDown).toBe(false);
  });

  it("GAME_FINISHED returns to pre-game and recreates room", () => {
    fresh();
    let recreated = false;
    gd.onRecreateRoom = () => {
      recreated = true;
    };
    startGame("0");
    gd.connection!.receive(`${NetworkProtocol.GAME_FINISHED}`);
    expect(gd.gameState).toBe(Constants.PRE_GAME);
    expect(recreated).toBe(true);
    expect(calls).toContain("enterPregameScreen");
  });

  it("sendFunction refuses malformed functions", () => {
    fresh();
    startGame("0");
    const sock = factory.sockets[0];
    const sentBefore = sock.sent.length;
    gd.sendFunction("sin(");
    expect(sock.sent.length).toBe(sentBefore);
    gd.sendFunction("sin(x)");
    expect(sock.sent.length).toBe(sentBefore + 1);
    expect(sock.sent[sentBefore]).toBe(`${NetworkProtocol.FIRE_FUNC}&0&${javaUrlEncode("sin(x)")}`);
  });
});

describe("GlobalClient", () => {
  function make(): { gc: GlobalClient; sock: FakeSocket } {
    const factory = new FakeFactory();
    const gc = new GlobalClient(factory, () => 0, () => 0);
    gc.joinGlobalServer("localhost", 23761, "Alice");
    return { gc, sock: factory.sockets[0] };
  }

  it("parses LIST_PLAYERS and LIST_ROOMS", () => {
    const { gc, sock } = make();
    sock.serverMessage(
      `${NetworkProtocol.LIST_PLAYERS}&2&${javaUrlEncode("Alice")}&1&${javaUrlEncode("Bob")}&2`
    );
    sock.serverMessage(
      `${NetworkProtocol.LIST_ROOMS}&1&${javaUrlEncode("Public Room 1")}&1&127.0.0.1&20001&0&0&0`
    );
    expect(gc.players.length).toBe(2);
    expect(gc.players[0].name).toBe("Alice");
    expect(gc.rooms.length).toBe(1);
    expect(gc.rooms[0].name).toBe("Public Room 1");
    expect(gc.rooms[0].port).toBe(20001);
    expect(gc.rooms[0].private).toBe(false);
  });

  it("CREATE_ROOM echo triggers onRoomCreated with roomID", () => {
    const { gc, sock } = make();
    gc.createRoom("My Room", "");
    expect(sock.sent).toContain(
      `${NetworkProtocol.CREATE_ROOM}&${javaUrlEncode("My Room")}&`
    );
    let created: number | null = null;
    gc.onRoomCreated = (roomID) => {
      created = roomID;
    };
    sock.serverMessage(
      `${NetworkProtocol.CREATE_ROOM}&${javaUrlEncode("My Room")}&7&127.0.0.1&20007&0`
    );
    expect(created).toBe(7);
  });

  it("private room parsed from LIST_ROOMS", () => {
    const { gc, sock } = make();
    sock.serverMessage(
      `${NetworkProtocol.LIST_ROOMS}&1&${javaUrlEncode("Secret Room")}&7&127.0.0.1&20007&0&0&1`
    );
    expect(gc.rooms[0].private).toBe(true);
  });

  it("sendRoomStatus sends mode + player count", () => {
    const factory = new FakeFactory();
    const gc = new GlobalClient(factory, () => 1, () => 3);
    gc.joinGlobalServer("localhost", 23761, "Alice");
    gc.createRoom("R", "");
    gc.sendRoomStatus();
    expect(factory.sockets[0].sent.at(-1)).toBe(`${NetworkProtocol.ROOM_STATUS}&1&3`);
  });

  it("QUIT / SAY_CHAT / CLOSE_ROOM handled", () => {
    const { gc, sock } = make();
    sock.serverMessage(`${NetworkProtocol.JOIN}&${javaUrlEncode("Bob")}&2`);
    expect(gc.players.some((p) => p.name === "Bob")).toBe(true);

    let chat: [string, string] | null = null;
    gc.onChat = (n, m) => {
      chat = [n, m];
    };
    sock.serverMessage(`${NetworkProtocol.SAY_CHAT}&2&${javaUrlEncode("hello world")}`);
    expect(chat).toEqual(["Bob", "hello world"]);

    sock.serverMessage(`${NetworkProtocol.QUIT}&2`);
    expect(gc.players.some((p) => p.name === "Bob")).toBe(false);

    sock.serverMessage(
      `${NetworkProtocol.CREATE_ROOM}&${javaUrlEncode("R")}&7&127.0.0.1&20007&0`
    );
    expect(gc.rooms.length).toBe(1);
    sock.serverMessage(`${NetworkProtocol.CLOSE_ROOM}&7`);
    expect(gc.rooms.length).toBe(0);
  });

  it("ROOM_INVALID flags invalid room", () => {
    const { gc, sock } = make();
    let invalid = false;
    gc.onRoomInvalid = () => {
      invalid = true;
    };
    sock.serverMessage(`${NetworkProtocol.ROOM_INVALID}`);
    expect(invalid).toBe(true);
    expect(gc.roomInvalid).toBe(true);
  });
});

describe("Player model", () => {
  it("nextTurn cycles alive soldiers only", () => {
    const p = new Player("P", 0, 1, true, 2);
    p.startSoldier(0, 0, 0);
    p.startSoldier(1, 0, 0);
    p.soldiers[1].alive = false;
    p.currentTurnSoldier = 1;
    expect(p.nextTurn()).toBe(true);
    expect(p.currentTurnSoldier).toBe(0);
    p.soldiers[0].alive = false;
    p.currentTurnSoldier = 1;
    expect(p.nextTurn()).toBe(false);
  });
});

describe("WsSocket", () => {
  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    readyState = FakeWebSocket.CONNECTING;
    sent: string[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: unknown }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(_url: string) {}
    send(data: string): void {
      this.sent.push(data);
    }
    close(): void {
      this.readyState = FakeWebSocket.CLOSED;
    }
    open(): void {
      this.readyState = FakeWebSocket.OPEN;
      if (this.onopen) this.onopen();
    }
  }

  it("queues sends while CONNECTING and flushes in order on OPEN", () => {
    const Original = globalThis.WebSocket;
    const fake = new FakeWebSocket("ws://x");
    const Stub: typeof FakeWebSocket = function (this: FakeWebSocket) {
      return fake;
    } as unknown as typeof FakeWebSocket;
    Stub.CONNECTING = FakeWebSocket.CONNECTING;
    Stub.OPEN = FakeWebSocket.OPEN;
    Stub.CLOSING = FakeWebSocket.CLOSING;
    Stub.CLOSED = FakeWebSocket.CLOSED;
    (globalThis as { WebSocket: unknown }).WebSocket = Stub;
    try {
      const events: SocketEvents = { onMessage: () => {}, onClose: () => {} };
      const sock = new WsSocket("ws://x", events);
      sock.send("first");
      sock.send("second");
      expect(fake.sent).toEqual([]);
      fake.open();
      expect(fake.sent).toEqual(["first", "second"]);
      sock.send("third");
      expect(fake.sent).toEqual(["first", "second", "third"]);
    } finally {
      (globalThis as { WebSocket: unknown }).WebSocket = Original;
    }
  });
});