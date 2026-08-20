import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Constants, NetworkProtocol, javaUrlEncode } from "@graphwar/math";
import { GlobalServer, LobbyPlayer, VIRTUAL_PORT_BASE, setGlobalIp, resetLobbyIds } from "../src/lobby.js";
import { ConnectedSocket } from "../src/net.js";

class TestSocket extends ConnectedSocket {
  sent: string[] = [];
  closed = false;
  handler: { msg: (m: string) => void } = { msg: () => {} };

  constructor(onClose: () => void) {
    super((m) => this.handler.msg(m), onClose);
  }

  sendRaw(m: string): void {
    this.sent.push(m);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.handlePeerClosed();
  }

  isOpen(): boolean {
    return !this.closed;
  }

  push(m: string): void {
    this.receive(m);
  }
}

let server: GlobalServer;

function connect(name: string): { player: LobbyPlayer; socket: TestSocket } {
  const socket = new TestSocket(() => {
    server.removePlayer(player);
  });
  let player: LobbyPlayer | null = null;
  player = server.registerConnection(socket);
  socket.handler.msg = (m) => server.handleMessage(m, player!);
  server.handleName(player, javaUrlEncode(name));
  return { player, socket };
}

beforeEach(() => {
  vi.useFakeTimers();
  resetLobbyIds();
  setGlobalIp("graphwar.example.com");
  server = new GlobalServer();
});

afterEach(() => {
  server.shutdown();
  vi.useRealTimers();
});

describe("global lobby protocol", () => {
  it("JOIN broadcast + LIST_PLAYERS to new player", () => {
    const a = connect("Alice");
    expect(a.socket.sent.some((m) => m === `${NetworkProtocol.JOIN}&${javaUrlEncode("Alice")}&1`)).toBe(true);
    expect(a.socket.sent.some((m) => m === `${NetworkProtocol.LIST_PLAYERS}&1&${javaUrlEncode("Alice")}&1`)).toBe(true);

    const b = connect("Bob");
    expect(b.socket.sent.some((m) => m.startsWith(`${NetworkProtocol.LIST_PLAYERS}&2`))).toBe(true);
    expect(a.socket.sent.some((m) => m === `${NetworkProtocol.JOIN}&${javaUrlEncode("Bob")}&2`)).toBe(true);
  });

  it("DUMMY_NAME hides the player", () => {
    const a = connect("Alice");
    const dummySocket = new TestSocket(() => {
      server.removePlayer(dummyPlayer);
    });
    let dummyPlayer: LobbyPlayer | null = null;
    dummyPlayer = server.registerConnection(dummySocket);
    dummySocket.handler.msg = (m) => server.handleMessage(m, dummyPlayer!);
    server.handleName(dummyPlayer, Constants.DUMMY_NAME);
    expect(dummyPlayer.dummy).toBe(true);
    expect(a.socket.sent.some((m) => m.includes("23E"))).toBe(false);
  });

  it("CREATE_ROOM → CREATE_ROOM broadcast with virtual port + LIST_ROOMS", () => {
    const a = connect("Alice");
    a.socket.push(`${NetworkProtocol.CREATE_ROOM}&${javaUrlEncode("My Room")}&`);
    expect(a.socket.sent.some((m) => m.startsWith(`${NetworkProtocol.CREATE_ROOM}&`))).toBe(true);
    const roomMsg = a.socket.sent.find((m) => m.startsWith(`${NetworkProtocol.CREATE_ROOM}&`))!;
    const fields = roomMsg.split("&");
    expect(fields[1]).toBe(javaUrlEncode("My Room"));
    expect(fields[2]).toBe("1");
    expect(fields[3]).toBe(javaUrlEncode("graphwar.example.com"));
    const port = parseInt(fields[4], 10);
    expect(port).toBeGreaterThanOrEqual(VIRTUAL_PORT_BASE);
    expect(fields[5]).toBe("0");
    expect(server.rooms.length).toBe(1);
    expect(a.player.room).toBe(server.rooms[0]);
  });

  it("CREATE_ROOM with key marks room private and passes key to relay", () => {
    const a = connect("Alice");
    a.socket.push(`${NetworkProtocol.CREATE_ROOM}&${javaUrlEncode("Secret Room")}&${javaUrlEncode("hunter2")}`);
    const roomMsg = a.socket.sent.find((m) => m.startsWith(`${NetworkProtocol.CREATE_ROOM}&`))!;
    const fields = roomMsg.split("&");
    expect(fields[5]).toBe("1");
    expect(server.rooms[0].key).toBe(javaUrlEncode("hunter2"));
    expect(server.rooms[0].relay?.key).toBe(javaUrlEncode("hunter2"));
  });

  it("NAME_CHANGE updates player name and refreshes player lists", () => {
    const a = connect("Alice");
    const b = connect("Bob");
    a.socket.push(`${NetworkProtocol.NAME_CHANGE}&${javaUrlEncode("Alicia")}`);
    expect(a.player.name).toBe(javaUrlEncode("Alicia"));
    expect(b.socket.sent.some((m) => m === `${NetworkProtocol.LIST_PLAYERS}&2&${javaUrlEncode("Alicia")}&1&${javaUrlEncode("Bob")}&2`)).toBe(true);
  });

  it("ROOM_STATUS updates room and broadcasts", () => {
    const a = connect("Alice");
    const b = connect("Bob");
    a.socket.push(`${NetworkProtocol.CREATE_ROOM}&${javaUrlEncode("My Room")}&`);
    const room = server.rooms[0];
    room.onRoomStatus(Constants.FST_ODE, 3);
    server.updateRoom(room);
    expect(b.socket.sent.some((m) => m === `${NetworkProtocol.ROOM_STATUS}&1&${Constants.FST_ODE}&3`)).toBe(true);
  });

  it("QUIT broadcasts QUIT + CLOSE_ROOM and removes room", () => {
    const a = connect("Alice");
    const b = connect("Bob");
    a.socket.push(`${NetworkProtocol.CREATE_ROOM}&${javaUrlEncode("My Room")}&`);
    expect(server.rooms.length).toBe(1);

    a.socket.push(`${NetworkProtocol.QUIT}`);
    expect(b.socket.sent.some((m) => m === `${NetworkProtocol.QUIT}&1`)).toBe(true);
    expect(b.socket.sent.some((m) => m === `${NetworkProtocol.CLOSE_ROOM}&1`)).toBe(true);
    expect(server.rooms.length).toBe(0);
    expect(server.players).toHaveLength(1);
  });

  it("CLOSE_ROOM removes room", () => {
    const a = connect("Alice");
    const b = connect("Bob");
    a.socket.push(`${NetworkProtocol.CREATE_ROOM}&${javaUrlEncode("My Room")}&`);
    a.socket.push(`${NetworkProtocol.CLOSE_ROOM}`);
    expect(server.rooms.length).toBe(0);
    expect(b.socket.sent.some((m) => m === `${NetworkProtocol.CLOSE_ROOM}&1`)).toBe(true);
  });

  it("SAY_CHAT relays encoded message", () => {
    const a = connect("Alice");
    const b = connect("Bob");
    a.socket.push(`${NetworkProtocol.SAY_CHAT}&${javaUrlEncode("hello world")}`);
    expect(b.socket.sent.some((m) => m === `${NetworkProtocol.SAY_CHAT}&1&${javaUrlEncode("hello world")}`)).toBe(true);
  });

  it("NO_INFO echoes NO_INFO", () => {
    const a = connect("Alice");
    a.socket.push(`${NetworkProtocol.NO_INFO}`);
    expect(a.socket.sent.some((m) => m === `${NetworkProtocol.NO_INFO}`)).toBe(true);
  });

  it("public rooms exist and appear in LIST_ROOMS", () => {
    server.createPublicRooms();
    const a = connect("Alice");
    const list = a.socket.sent.find((m) => m.startsWith(`${NetworkProtocol.LIST_ROOMS}&`))!;
    const fields = list.split("&");
    const numRooms = parseInt(fields[1], 10);
    expect(numRooms).toBe(3);
    expect(fields[2]).toBe(javaUrlEncode("Public Room 1"));
  });

  it("keepalive/drop on lobby connection", () => {
    const a = connect("Alice");
    vi.advanceTimersByTime(Constants.TIMEOUT_KEEPALIVE + 1000);
    expect(a.socket.sent.some((m) => m === `${NetworkProtocol.NO_INFO}`)).toBe(true);
    vi.advanceTimersByTime(Constants.TIMEOUT_DROP + 100);
    expect(a.socket.closed).toBe(true);
    expect(server.players).toHaveLength(0);
  });
});
