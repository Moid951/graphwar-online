import { Constants, NetworkProtocol, javaUrlEncode, javaUrlDecode } from "@graphwar/math";

export interface SocketLike {
  send(message: string): void;
  close(): void;
}

export interface SocketEvents {
  onMessage(message: string): void;
  onClose(): void;
}

export interface SocketFactory {
  connect(url: string, events: SocketEvents): SocketLike;
}

/** Browser WebSocket adapter preserving the line-framed protocol contract. */
export class WsSocket implements SocketLike {
  private ws: WebSocket;
  private pending: string[] = [];

  constructor(url: string, events: SocketEvents) {
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      for (const message of this.pending) {
        this.ws.send(message);
      }
      this.pending = [];
    };
    this.ws.onmessage = (ev) => events.onMessage(String(ev.data));
    this.ws.onclose = () => events.onClose();
    this.ws.onerror = () => {
      try {
        this.ws.close();
      } catch {
        /* already closed */
      }
    };
  }

  send(message: string): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(message);
    } else if (this.ws.readyState === WebSocket.CONNECTING) {
      this.pending.push(message);
    } else {
      // CLOSING/CLOSED: message cannot be delivered; the app is expected to
      // detect the disconnect via onClose and rejoin.
    }
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
  }
}

/** Shared connection with keepalive/drop semantics (mirrors server Connection). */
export class ClientConnection {
  socket: SocketLike;
  lastSent = 0;
  lastReceived = 0;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private onMessage: (m: string) => void;

  constructor(socket: SocketLike, onMessage: (m: string) => void) {
    this.socket = socket;
    this.onMessage = onMessage;
    this.lastSent = Date.now();
    this.lastReceived = Date.now();
    this.ticker = setInterval(() => this.tick(), 1000);
  }

  private tick(): void {
    if (Date.now() - this.lastSent > Constants.TIMEOUT_KEEPALIVE) {
      this.send(`${NetworkProtocol.NO_INFO}`);
    }
  }

  receive(message: string): void {
    this.lastReceived = Date.now();
    this.onMessage(message);
  }

  send(message: string): void {
    this.socket.send(message);
    this.lastSent = Date.now();
  }

  close(): void {
    if (this.ticker !== null) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
    this.socket.close();
  }
}

let serverBase: string | null = null;

export function setServerBase(base: string): void {
  serverBase = base;
}

function wsBase(): string {
  if (serverBase !== null) {
    return serverBase;
  }
  if (typeof location !== "undefined") {
    return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
  }
  return "ws://localhost";
}

export function roomWsUrl(roomID: number): string {
  return `${wsBase()}/room/${roomID}`;
}

export function lobbyWsUrl(): string {
  return `${wsBase()}/lobby`;
}

/** Client-side GlobalClient (lobby connection). Port of Graphwar/GlobalClient. */
export class GlobalClient {
  private connection: ClientConnection | null = null;
  players: { name: string; playerID: number }[] = [];
  rooms: {
    name: string;
    roomID: number;
    ip: string;
    port: number;
    mode: number;
    numPlayers: number;
    private: boolean;
  }[] = [];
  localPlayer = "Player";
  running = false;
  roomCreated = false;
  roomHidden = false;
  roomInvalid = false;
  roomName = "Room";
  roomPort: number = Constants.DEFAULT_PORT;
  roomKey = "";

  onPlayersChanged: () => void = () => {};
  onRoomsChanged: () => void = () => {};
  onChat: (playerName: string, message: string) => void = () => {};
  onRoomCreated: (roomID: number) => void = () => {};
  onRoomInvalid: () => void = () => {};
  onDisconnect: (kicked: boolean) => void = () => {};

  constructor(
    private readonly factory: SocketFactory,
    private readonly getGameMode: () => number,
    private readonly getNumPlayers: () => number
  ) {}

  joinGlobalServer(ip: string, port: number, playerName: string): void {
    this.localPlayer = playerName;
    this.running = true;
    this.players = [];
    this.rooms = [];

    const events: SocketEvents = {
      onMessage: (m) => this.handleMessage(m),
      onClose: () => this.disconnect(true),
    };
    const socket = this.factory.connect(lobbyWsUrl(), events);
    this.connection = new ClientConnection(socket, (m) => this.handleMessage(m));
    this.connection.send(javaUrlEncode(playerName));
  }

  getNumRooms(): number {
    return this.rooms.length;
  }

  getRoom(n: number) {
    return this.rooms[n];
  }

  private addPlayer(name: string, id: number): void {
    this.players.push({ name, playerID: id });
    this.onPlayersChanged();
  }

  private removePlayer(id: number): void {
    this.players = this.players.filter((p) => p.playerID !== id);
    this.onPlayersChanged();
  }

  private removeRoom(id: number): void {
    this.rooms = this.rooms.filter((r) => r.roomID !== id);
    this.onRoomsChanged();
  }

  private updateRoom(id: number, gameMode: number, numPlayers: number): void {
    for (const room of this.rooms) {
      if (room.roomID === id) {
        room.mode = gameMode;
        room.numPlayers = numPlayers;
        break;
      }
    }
    this.onRoomsChanged();
  }

  private addRoom(
    name: string,
    roomID: number,
    ip: string,
    port: number,
    mode: number,
    numPlayers: number,
    privateRoom: boolean
  ): void {
    this.rooms.push({ name, roomID, ip, port, mode, numPlayers, private: privateRoom });
    if (this.roomCreated && this.roomName === name) {
      this.onRoomCreated(roomID);
    }
    this.onRoomsChanged();
  }

  private addToChat(playerId: number, chatMessage: string): void {
    let playerName = "Anon";
    for (const p of this.players) {
      if (p.playerID === playerId) {
        playerName = p.name;
        break;
      }
    }
    this.onChat(playerName, chatMessage);
  }

  handleMessage(message: string): void {
    if (this.connection === null) return;
    const info = message.split("&");
    if (info.length === 0) return;

    const code = parseInt(info[0], 10);
    switch (code) {
      case NetworkProtocol.NO_INFO:
        break;
      case NetworkProtocol.JOIN: {
        if (info.length === 3) {
          this.addPlayer(javaUrlDecode(info[1]), parseInt(info[2], 10));
        }
        break;
      }
      case NetworkProtocol.SAY_CHAT: {
        if (info.length === 3) {
          this.addToChat(parseInt(info[1], 10), javaUrlDecode(info[2]));
        }
        break;
      }
      case NetworkProtocol.ROOM_STATUS: {
        if (info.length === 4) {
          this.updateRoom(parseInt(info[1], 10), parseInt(info[2], 10), parseInt(info[3], 10));
        }
        break;
      }
      case NetworkProtocol.CREATE_ROOM: {
        if (info.length === 6) {
          const roomName = javaUrlDecode(info[1]);
          const roomID = parseInt(info[2], 10);
          const ipAddress = javaUrlDecode(info[3]);
          const port = parseInt(info[4], 10);
          const privateRoom = info[5] === "1";
          this.addRoom(roomName, roomID, ipAddress, port, Constants.NORMAL_FUNC, 0, privateRoom);
        }
        break;
      }
      case NetworkProtocol.LIST_PLAYERS: {
        if (info.length >= 2) {
          this.players = [];
          const numPlayers = parseInt(info[1], 10);
          for (let i = 0; i < numPlayers; i++) {
            this.addPlayer(javaUrlDecode(info[2 + 2 * i]), parseInt(info[3 + 2 * i], 10));
          }
        }
        break;
      }
      case NetworkProtocol.LIST_ROOMS: {
        if (info.length >= 2) {
          this.rooms = [];
          const numRooms = parseInt(info[1], 10);
          for (let i = 0; i < numRooms; i++) {
            this.addRoom(
              javaUrlDecode(info[2 + 7 * i]),
              parseInt(info[3 + 7 * i], 10),
              javaUrlDecode(info[4 + 7 * i]),
              parseInt(info[5 + 7 * i], 10),
              parseInt(info[6 + 7 * i], 10),
              parseInt(info[7 + 7 * i], 10),
              info[8 + 7 * i] === "1"
            );
          }
        }
        break;
      }
      case NetworkProtocol.CLOSE_ROOM: {
        if (info.length === 2) {
          this.removeRoom(parseInt(info[1], 10));
        }
        break;
      }
      case NetworkProtocol.ROOM_INVALID: {
        this.roomInvalid = true;
        this.onRoomInvalid();
        break;
      }
      case NetworkProtocol.QUIT: {
        if (info.length === 2) {
          this.removePlayer(parseInt(info[1], 10));
        }
        break;
      }
    }
  }

  sendChatMessage(chatMessage: string): void {
    this.connection?.send(`${NetworkProtocol.SAY_CHAT}&${javaUrlEncode(chatMessage)}`);
  }

  createRoom(roomName: string, key: string): void {
    this.roomName = roomName;
    this.roomKey = key;
    this.roomPort = Constants.DEFAULT_PORT;
    this.roomCreated = true;
    this.roomHidden = false;
    this.roomInvalid = false;
    this.connection?.send(`${NetworkProtocol.CREATE_ROOM}&${javaUrlEncode(roomName)}&${javaUrlEncode(key)}`);
  }

  sendName(name: string): void {
    this.connection?.send(`${NetworkProtocol.NAME_CHANGE}&${javaUrlEncode(name)}`);
  }

  closeRoom(): void {
    if (this.roomCreated) {
      this.roomCreated = false;
      this.roomHidden = false;
      this.roomInvalid = false;
      this.connection?.send(`${NetworkProtocol.CLOSE_ROOM}`);
    }
  }

  hideRoom(): void {
    if (this.roomCreated) {
      this.roomCreated = false;
      this.roomHidden = true;
      this.connection?.send(`${NetworkProtocol.CLOSE_ROOM}`);
    }
  }

  recreateRoom(): void {
    if (this.roomHidden) {
      this.roomCreated = true;
      this.roomHidden = false;
      this.roomInvalid = false;
      this.connection?.send(
        `${NetworkProtocol.CREATE_ROOM}&${javaUrlEncode(this.roomName)}&${javaUrlEncode(this.roomKey)}`
      );
    }
  }

  sendRoomStatus(): void {
    if (this.roomCreated) {
      this.connection?.send(
        `${NetworkProtocol.ROOM_STATUS}&${this.getGameMode()}&${this.getNumPlayers()}`
      );
    }
  }

  stop(): void {
    if (this.roomCreated) {
      this.closeRoom();
    }
    this.connection?.send(`${NetworkProtocol.QUIT}`);
    this.disconnect(false);
  }

  disconnect(kicked: boolean): void {
    this.running = false;
    this.connection?.close();
    this.connection = null;
    this.onDisconnect(kicked);
  }

  isRunning(): boolean {
    return this.running;
  }
}