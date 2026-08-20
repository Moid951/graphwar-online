import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Constants, NetworkProtocol, javaUrlEncode } from "@graphwar/math";
import { RoomServer, ClientConnection, resetRelayIds } from "../src/relay.js";
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

let relay: RoomServer;
let sockets: TestSocket[] = [];

function connect(): { client: ClientConnection; socket: TestSocket } {
  const socket = new TestSocket(() => {
    if (client !== null) {
      relay.removeClient(client);
      client.disconnect();
    }
  });
  let client: ClientConnection | null = null;
  const created = relay.createClientConnection(socket);
  client = created;
  socket.handler.msg = (m) => relay.handleMessage(m, created);
  socket.push(`${NetworkProtocol.KEY}&`);
  sockets.push(socket);
  return { client: created, socket };
}

beforeEach(() => {
  vi.useFakeTimers();
  resetRelayIds();
  relay = new RoomServer(1, "test", 20001, "");
  sockets = [];
});

afterEach(() => {
  relay.shutdown();
  vi.useRealTimers();
});

function parseAddPlayer(msg: string): string[] {
  return msg.split("&");
}

/** Adds Alice+Bob, sets them on opposite teams, readies both, and the leader requests START_GAME. */
function startFlow(
  a: ReturnType<typeof connect>,
  b: ReturnType<typeof connect>
): void {
  a.socket.push(`${NetworkProtocol.ADD_PLAYER}&${javaUrlEncode("Alice")}`);
  b.socket.push(`${NetworkProtocol.ADD_PLAYER}&${javaUrlEncode("Bob")}`);
  a.socket.push(`${NetworkProtocol.SET_TEAM}&${Constants.TEAM1}&0`);
  b.socket.push(`${NetworkProtocol.SET_TEAM}&${Constants.TEAM2}&1`);
  a.socket.push(`${NetworkProtocol.SET_READY}&0&1`);
  b.socket.push(`${NetworkProtocol.SET_READY}&1&1`);
  a.socket.push(`${NetworkProtocol.START_GAME}`);
}

describe("room relay protocol", () => {
  it("first client is leader and gets NEW_LEADER", () => {
    const { socket } = connect();
    expect(socket.sent).toContain(`${NetworkProtocol.NEW_LEADER}`);
    expect(socket.sent).toContain(`${NetworkProtocol.SET_MODE}&${Constants.NORMAL_FUNC}`);
  });

  it("rejects connection with wrong key", () => {
    const socket = new TestSocket(() => {});
    const created = relay.createClientConnection(socket);
    socket.handler.msg = (m) => relay.handleMessage(m, created);
    socket.push(`${NetworkProtocol.KEY}&wrong`);
    expect(created.authenticated).toBe(false);
    expect(socket.sent).toContain(`${NetworkProtocol.KEY_DENIED}`);
    expect(socket.closed).toBe(true);
  });

  it("rejects connection without key handshake", () => {
    const socket = new TestSocket(() => {});
    const created = relay.createClientConnection(socket);
    socket.handler.msg = (m) => relay.handleMessage(m, created);
    socket.push(`${NetworkProtocol.ADD_PLAYER}&${javaUrlEncode("Alice")}`);
    expect(created.authenticated).toBe(false);
    expect(socket.sent).toContain(`${NetworkProtocol.KEY_DENIED}`);
    expect(relay.clients.length).toBe(0);
  });

  it("private room accepts matching key", () => {
    const keyRelay = new RoomServer(2, "private", 20002, javaUrlEncode("secret"));
    const socket = new TestSocket(() => {});
    const created = keyRelay.createClientConnection(socket);
    socket.handler.msg = (m) => keyRelay.handleMessage(m, created);
    socket.push(`${NetworkProtocol.KEY}&${javaUrlEncode("secret")}`);
    expect(created.authenticated).toBe(true);
    expect(keyRelay.clients.length).toBe(1);
    expect(socket.sent).toContain(`${NetworkProtocol.SET_MODE}&${Constants.NORMAL_FUNC}`);
    keyRelay.shutdown();
  });

  it("ADD_PLAYER broadcasts player info to all clients", () => {
    const a = connect();
    const b = connect();
    a.socket.push(`${NetworkProtocol.ADD_PLAYER}&${javaUrlEncode("Alice")}`);
    const broadcast = a.socket.sent.filter((m) => m.startsWith(`${NetworkProtocol.ADD_PLAYER}&`));
    expect(broadcast.length).toBeGreaterThan(0);
    const fields = parseAddPlayer(broadcast[broadcast.length - 1]);
    expect(fields[0]).toBe(`${NetworkProtocol.ADD_PLAYER}`);
    expect(fields[1]).toBe("0");
    expect(fields[2]).toBe(javaUrlEncode("Alice"));
    expect(parseInt(fields[3], 10)).toBeGreaterThanOrEqual(1); // team
    expect(fields[4]).toBe("1"); // local to Alice's own client
    expect(fields[5]).toBe("2"); // initial soldiers
    expect(fields[6]).toBe("1"); // leader's players are always ready
    expect(b.socket.sent.some((m) => m.includes("Alice") && m.startsWith(`${NetworkProtocol.ADD_PLAYER}&`))).toBe(true);
  });

  it("SET_TEAM / ADD_SOLDIER / SET_READY echo to everyone and clear readiness", () => {
    const a = connect();
    a.socket.push(`${NetworkProtocol.ADD_PLAYER}&${javaUrlEncode("Alice")}`);
    a.socket.push(`${NetworkProtocol.SET_TEAM}&${Constants.TEAM2}&0`);
    expect(a.socket.sent.some((m) => m === `${NetworkProtocol.SET_TEAM}&${Constants.TEAM2}&0`)).toBe(true);

    a.socket.push(`${NetworkProtocol.ADD_SOLDIER}&0`);
    expect(a.socket.sent.some((m) => m === `${NetworkProtocol.ADD_SOLDIER}&0`)).toBe(true);

    a.socket.push(`${NetworkProtocol.SET_READY}&0&1`);
    expect(a.socket.sent.some((m) => m === `${NetworkProtocol.SET_READY}&0&1`)).toBe(true);
  });

  it("all ready alone does not auto-start; non-leader cannot start", () => {
    const a = connect();
    const b = connect();
    a.socket.push(`${NetworkProtocol.ADD_PLAYER}&${javaUrlEncode("Alice")}`);
    b.socket.push(`${NetworkProtocol.ADD_PLAYER}&${javaUrlEncode("Bob")}`);
    a.socket.push(`${NetworkProtocol.SET_TEAM}&${Constants.TEAM1}&0`);
    b.socket.push(`${NetworkProtocol.SET_TEAM}&${Constants.TEAM2}&1`);
    a.socket.push(`${NetworkProtocol.SET_READY}&0&1`);
    b.socket.push(`${NetworkProtocol.SET_READY}&1&1`);
    expect(a.socket.sent.some((m) => m === `${NetworkProtocol.START_COUNTDOWN}`)).toBe(false);

    b.socket.push(`${NetworkProtocol.START_GAME}`);
    expect(a.socket.sent.some((m) => m === `${NetworkProtocol.START_COUNTDOWN}`)).toBe(false);
  });

  it("leader START_GAME → START_COUNTDOWN → START_GAME after delay with circles/soldiers/startPlayer", () => {
    const a = connect();
    const b = connect();
    startFlow(a, b);

    expect(a.socket.sent.some((m) => m === `${NetworkProtocol.START_COUNTDOWN}`)).toBe(true);
    expect(b.socket.sent.some((m) => m === `${NetworkProtocol.START_COUNTDOWN}`)).toBe(true);

    vi.advanceTimersByTime(Constants.START_GAME_DELAY);

    const startMsg = a.socket.sent.find((m) => m.startsWith(`${NetworkProtocol.START_GAME}&`));
    expect(startMsg).toBeTruthy();
    const fields = startMsg!.split("&");
    expect(fields[0]).toBe(`${NetworkProtocol.START_GAME}`);
    const numCircles = parseInt(fields[1], 10);
    expect(numCircles).toBeGreaterThan(0);
    // 1 (code) + 1 (numCircles) + 3*numCircles + 2*4 soldiers + 1 startPlayer
    const soldierCount = a.client.players[0].numSoldiers + b.client.players[0].numSoldiers;
    expect(fields.length).toBe(2 + 3 * numCircles + 2 * soldierCount + 1);
    const startPlayer = parseInt(fields[fields.length - 1], 10);
    expect(startPlayer).toBeGreaterThanOrEqual(0);
    expect(startPlayer).toBeLessThan(2);
    // REORDER sent before START_GAME
    const reorderIdx = a.socket.sent.findIndex((m) => m.startsWith(`${NetworkProtocol.REORDER}`));
    const startIdx = a.socket.sent.findIndex((m) => m.startsWith(`${NetworkProtocol.START_GAME}&`));
    expect(reorderIdx).toBeLessThan(startIdx);
  });

  it("FIRE_FUNC relays to everyone in game state", () => {
    const a = connect();
    const b = connect();
    startFlow(a, b);
    vi.advanceTimersByTime(Constants.START_GAME_DELAY);

    const fire = `${NetworkProtocol.FIRE_FUNC}&0&${javaUrlEncode("sin(x)")}`;
    a.socket.push(fire);
    expect(b.socket.sent.some((m) => m === fire)).toBe(true);
  });

  it("READY_NEXT_TURN barrier → NEXT_TURN", () => {
    const a = connect();
    const b = connect();
    startFlow(a, b);
    vi.advanceTimersByTime(Constants.START_GAME_DELAY);

    b.socket.push(`${NetworkProtocol.READY_NEXT_TURN}`);
    expect(a.socket.sent.some((m) => m === `${NetworkProtocol.NEXT_TURN}`)).toBe(false);
    a.socket.push(`${NetworkProtocol.READY_NEXT_TURN}`);
    expect(a.socket.sent.some((m) => m === `${NetworkProtocol.NEXT_TURN}`)).toBe(true);
  });

  it("TIME_UP triggers nextTurn only when actually expired", () => {
    const a = connect();
    const b = connect();
    startFlow(a, b);
    vi.advanceTimersByTime(Constants.START_GAME_DELAY);

    a.socket.push(`${NetworkProtocol.TIME_UP}`);
    expect(a.socket.sent.some((m) => m === `${NetworkProtocol.NEXT_TURN}`)).toBe(false);

    for (let t = 0; t < Constants.TURN_TIME + 1000; t += 10000) {
      vi.advanceTimersByTime(10000);
      a.socket.push(`${NetworkProtocol.NO_INFO}`);
      b.socket.push(`${NetworkProtocol.NO_INFO}`);
    }
    a.socket.push(`${NetworkProtocol.TIME_UP}`);
    expect(a.socket.sent.some((m) => m === `${NetworkProtocol.NEXT_TURN}`)).toBe(true);
  });

  it("GAME_FINISHED aggregates across all clients → GAME_FINISHED + PRE_GAME", () => {
    const a = connect();
    const b = connect();
    startFlow(a, b);
    vi.advanceTimersByTime(Constants.START_GAME_DELAY);

    b.socket.push(`${NetworkProtocol.GAME_FINISHED}`);
    expect(a.socket.sent.some((m) => m === `${NetworkProtocol.GAME_FINISHED}`)).toBe(false);
    a.socket.push(`${NetworkProtocol.GAME_FINISHED}`);
    expect(a.socket.sent.some((m) => m === `${NetworkProtocol.GAME_FINISHED}`)).toBe(true);
    expect(relay.gameState).toBe(Constants.PRE_GAME);
    expect(relay.acceptingConnections).toBe(true);
  });

  it("disconnect removes players, broadcasts REMOVE_PLAYER, fails over leader", () => {
    const a = connect();
    const b = connect();
    a.socket.push(`${NetworkProtocol.ADD_PLAYER}&${javaUrlEncode("Alice")}`);
    b.socket.push(`${NetworkProtocol.ADD_PLAYER}&${javaUrlEncode("Bob")}`);

    b.socket.push(`${NetworkProtocol.DISCONNECT}`);
    b.socket.close();

    expect(a.socket.sent.some((m) => m === `${NetworkProtocol.REMOVE_PLAYER}&1`)).toBe(true);
    expect(a.client.leader).toBe(true);
    expect(a.socket.sent.filter((m) => m === `${NetworkProtocol.NEW_LEADER}`).length).toBeGreaterThan(0);
  });

  it("11th client gets GAME_FULL", () => {
    const conns = [];
    for (let i = 0; i < Constants.MAX_CLIENTS; i++) {
      conns.push(connect());
    }
    const extra = connect();
    expect(extra.socket.sent).toContain(`${NetworkProtocol.GAME_FULL}`);
    expect(extra.socket.closed).toBe(true);
  });

  it("-skip chat from all clients restarts the game", () => {
    const a = connect();
    const b = connect();
    startFlow(a, b);
    vi.advanceTimersByTime(Constants.START_GAME_DELAY);

    a.socket.push(`${NetworkProtocol.CHAT_MSG}&0&${javaUrlEncode("-skip")}`);
    b.socket.push(`${NetworkProtocol.CHAT_MSG}&1&${javaUrlEncode("-skip")}`);

    const starts = a.socket.sent.filter((m) => m.startsWith(`${NetworkProtocol.START_GAME}&`));
    expect(starts.length).toBe(2);
  });

  it("leader kick removes the target client entirely", () => {
    const a = connect();
    const b = connect();
    a.socket.push(`${NetworkProtocol.ADD_PLAYER}&${javaUrlEncode("Alice")}`);
    b.socket.push(`${NetworkProtocol.ADD_PLAYER}&${javaUrlEncode("Bob")}`);

    a.socket.push(`${NetworkProtocol.KICK}&1`);
    expect(b.socket.sent).toContain(`${NetworkProtocol.KICKED}`);
    expect(b.socket.closed).toBe(true);
    expect(relay.clients).toHaveLength(1);
    expect(relay.players).toHaveLength(1);
    expect(a.socket.sent.some((m) => m === `${NetworkProtocol.REMOVE_PLAYER}&1`)).toBe(true);
  });

  it("non-leader cannot kick or transfer leadership", () => {
    const a = connect();
    const b = connect();
    a.socket.push(`${NetworkProtocol.ADD_PLAYER}&${javaUrlEncode("Alice")}`);
    b.socket.push(`${NetworkProtocol.ADD_PLAYER}&${javaUrlEncode("Bob")}`);

    b.socket.push(`${NetworkProtocol.KICK}&0`);
    expect(a.socket.sent).not.toContain(`${NetworkProtocol.KICKED}`);
    expect(relay.clients).toHaveLength(2);

    b.socket.push(`${NetworkProtocol.TRANSFER_LEADER}&0`);
    expect(a.client.leader).toBe(true);
    expect(b.client.leader).toBe(false);
  });

  it("leader transfers leadership → new leader gets NEW_LEADER, all get SET_LEADER", () => {
    const a = connect();
    const b = connect();
    a.socket.push(`${NetworkProtocol.ADD_PLAYER}&${javaUrlEncode("Alice")}`);
    b.socket.push(`${NetworkProtocol.ADD_PLAYER}&${javaUrlEncode("Bob")}`);

    a.socket.push(`${NetworkProtocol.TRANSFER_LEADER}&1`);
    expect(a.client.leader).toBe(false);
    expect(b.client.leader).toBe(true);
    expect(b.socket.sent.filter((m) => m === `${NetworkProtocol.NEW_LEADER}`).length).toBeGreaterThan(0);
    expect(a.socket.sent.some((m) => m === `${NetworkProtocol.SET_LEADER}&1`)).toBe(true);
    expect(b.socket.sent.some((m) => m === `${NetworkProtocol.SET_LEADER}&1`)).toBe(true);
  });

  it("leader failover broadcasts SET_LEADER to the first remaining joiner", () => {
    const a = connect();
    const b = connect();
    const c = connect();
    a.socket.push(`${NetworkProtocol.ADD_PLAYER}&${javaUrlEncode("Alice")}`);
    b.socket.push(`${NetworkProtocol.ADD_PLAYER}&${javaUrlEncode("Bob")}`);
    c.socket.push(`${NetworkProtocol.ADD_PLAYER}&${javaUrlEncode("Cara")}`);

    a.socket.push(`${NetworkProtocol.DISCONNECT}`);
    a.socket.close();
    expect(b.client.leader).toBe(true);
    expect(b.socket.sent.some((m) => m === `${NetworkProtocol.SET_LEADER}&1`)).toBe(true);
    expect(c.socket.sent.some((m) => m === `${NetworkProtocol.SET_LEADER}&1`)).toBe(true);
  });

  it("player room auto-closes after grace when empty; permanent room does not", () => {
    const emptyEvents: string[] = [];
    const pr = new RoomServer(50, "player-room", 20050, "");
    pr.setStatusListener({
      onRoomStatus: () => {},
      onRoomGameState: () => {},
      onRoomEmpty: () => emptyEvents.push("empty"),
    });
    const p1 = pr.createClientConnection(new TestSocket(() => {}));
    const p1s = p1.socket as TestSocket;
    p1s.handler.msg = (m) => pr.handleMessage(m, p1);
    p1s.push(`${NetworkProtocol.KEY}&`);
    p1s.push(`${NetworkProtocol.DISCONNECT}`);
    p1s.close();
    vi.advanceTimersByTime(Constants.EMPTY_ROOM_CLOSE_DELAY);
    expect(emptyEvents).toContain("empty");
    pr.shutdown();

    const permEvents: string[] = [];
    const perm = new RoomServer(51, "perm", 20051, "", true);
    perm.setStatusListener({
      onRoomStatus: () => {},
      onRoomGameState: () => {},
      onRoomEmpty: () => permEvents.push("empty"),
    });
    const q1 = perm.createClientConnection(new TestSocket(() => {}));
    const q1s = q1.socket as TestSocket;
    q1s.handler.msg = (m) => perm.handleMessage(m, q1);
    q1s.push(`${NetworkProtocol.KEY}&`);
    q1s.push(`${NetworkProtocol.DISCONNECT}`);
    q1s.close();
    vi.advanceTimersByTime(Constants.EMPTY_ROOM_CLOSE_DELAY);
    expect(permEvents).not.toContain("empty");
    perm.shutdown();
  });

  it("keepalive: idle client receives NO_INFO after 5s, dropped after 30s", () => {
    const a = connect();
    vi.advanceTimersByTime(Constants.TIMEOUT_KEEPALIVE + 1000);
    expect(a.socket.sent.some((m) => m === `${NetworkProtocol.NO_INFO}`)).toBe(true);
    vi.advanceTimersByTime(Constants.TIMEOUT_DROP + 100);
    expect(a.socket.closed).toBe(true);
    expect(relay.clients).toHaveLength(0);
  });

  it("leader-only NEXT_MODE advances game mode and broadcasts", () => {
    const a = connect();
    const b = connect();
    b.socket.push(`${NetworkProtocol.NEXT_MODE}`);
    expect(relay.gameMode).toBe(Constants.NORMAL_FUNC);
    a.socket.push(`${NetworkProtocol.NEXT_MODE}`);
    expect(relay.gameMode).toBe(Constants.FST_ODE);
    expect(a.socket.sent.some((m) => m === `${NetworkProtocol.SET_MODE}&${Constants.FST_ODE}`)).toBe(true);
  });

  it("non-leader players start unready; only leader auto-ready survives team/player changes", () => {
    const a = connect();
    const b = connect();
    a.socket.push(`${NetworkProtocol.ADD_PLAYER}&${javaUrlEncode("Alice")}`);
    b.socket.push(`${NetworkProtocol.ADD_PLAYER}&${javaUrlEncode("Bob")}`);

    const aliceMsg = a.socket.sent.find((m) => m.startsWith(`${NetworkProtocol.ADD_PLAYER}&0&`));
    expect(aliceMsg!.split("&")[6]).toBe("1");

    const bobMsg = b.socket.sent.find((m) => m.startsWith(`${NetworkProtocol.ADD_PLAYER}&1&`));
    expect(bobMsg!.split("&")[6]).toBe("0");

    b.socket.push(`${NetworkProtocol.SET_READY}&1&1`);
    expect(a.socket.sent.some((m) => m === `${NetworkProtocol.SET_READY}&1&1`)).toBe(true);

    b.socket.push(`${NetworkProtocol.SET_TEAM}&${Constants.TEAM2}&1`);
    expect(b.socket.sent.some((m) => m === `${NetworkProtocol.SET_READY}&1&0`)).toBe(true);

    expect(relay.players.find((p) => p.playerID === 0)!.ready).toBe(true);
  });

  it("leader CANCEL_START stops countdown and broadcasts; non-leader is ignored", () => {
    const a = connect();
    const b = connect();
    startFlow(a, b);
    expect(a.socket.sent.some((m) => m === `${NetworkProtocol.START_COUNTDOWN}`)).toBe(true);

    b.socket.push(`${NetworkProtocol.CANCEL_START}`);
    expect(a.socket.sent.some((m) => m === `${NetworkProtocol.CANCEL_START}`)).toBe(false);

    a.socket.push(`${NetworkProtocol.CANCEL_START}`);
    expect(a.socket.sent.some((m) => m === `${NetworkProtocol.CANCEL_START}`)).toBe(true);

    vi.advanceTimersByTime(Constants.START_GAME_DELAY);
    expect(a.socket.sent.some((m) => m.startsWith(`${NetworkProtocol.START_GAME}&`))).toBe(false);
  });
});