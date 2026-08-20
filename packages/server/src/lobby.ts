import { Constants, NetworkProtocol, javaUrlEncode } from "@graphwar/math";
import { ConnectedSocket, SocketLike, Ticker, checkDrop, checkKeepAlive } from "./net.js";
import { RoomServer, RoomStatusListener } from "./relay.js";

/** Virtual port base. Room relays are addressed by roomID = port - VIRTUAL_PORT_BASE. */
export const VIRTUAL_PORT_BASE = 20000;

let lastPlayerId = 1;
let lastRoomId = 1;

export function resetLobbyIds(): void {
  lastPlayerId = 1;
  lastRoomId = 1;
}

export class LobbyPlayer {
  socket: ConnectedSocket;
  name = "Player";
  playerID: number;
  running = true;
  room: Room | null = null;
  dummy = true;

  constructor(server: GlobalServer, socket: ConnectedSocket) {
    this.socket = socket;
    this.playerID = lastPlayerId;
    lastPlayerId++;
  }

  getIpAddress(): string {
    return "127.0.0.1";
  }

  sendMessage(message: string): void {
    this.socket.send(message);
  }

  disconnect(): void {
    this.running = false;
    this.socket.close();
  }
}

export class Room implements RoomStatusListener {
  name: string;
  ip: string;
  port: number;
  gameMode: number;
  numPlayers: number;
  roomID: number;
  relay: RoomServer | null = null;
  publicRoom: boolean;
  key: string;
  hidden = false;
  permanent = false;
  server: GlobalServer | null = null;

  constructor(name: string, ip: string, port: number, key = "", permanent = false) {
    this.name = name;
    this.ip = ip;
    this.port = port;
    this.gameMode = 0;
    this.numPlayers = 0;
    this.roomID = lastRoomId;
    this.publicRoom = false;
    this.key = key;
    this.permanent = permanent;
    lastRoomId++;
  }

  getIp(): string {
    if (this.ip.startsWith("127.0.0.1")) {
      return GLOBAL_IP;
    }
    return this.ip;
  }

  onRoomStatus(mode: number, numPlayers: number): void {
    this.gameMode = mode;
    this.numPlayers = numPlayers;
  }

  onRoomGameState(state: number): void {
    if (!this.publicRoom) return;
    if (state === Constants.GAME && !this.hidden) {
      this.hidden = true;
      this.server?.sendCloseRoom(this);
    } else if (state === Constants.PRE_GAME && this.hidden) {
      this.hidden = false;
      this.server?.sendCreateRoom(this);
    }
  }

  onRoomEmpty(): void {
    if (!this.permanent) {
      this.server?.removeRoom(this);
    }
  }
}

export let GLOBAL_IP = "127.0.0.1";

export function setGlobalIp(ip: string): void {
  GLOBAL_IP = ip;
}

export class GlobalServer {
  players: LobbyPlayer[] = [];
  rooms: Room[] = [];
  lastRoomCheck = Date.now();
  maxRooms = 64;
  private ticker = new Ticker();
  private statusHtml = "";

  constructor() {
    this.ticker.start(1000, () => {
      for (const player of [...this.players]) {
        if (checkDrop(player.socket.getLastReceived())) {
          this.removePlayer(player);
        } else if (checkKeepAlive(player.socket.getLastSent())) {
          player.sendMessage(`${NetworkProtocol.NO_INFO}`);
        }
      }
    });
    this.writeStatus();
  }

  /** Add public rooms so players always have somewhere to play. */
  createPublicRooms(): void {
    for (let i = 1; i <= 3; i++) {
      const room = new Room(javaUrlEncode(`Public Room ${i}`), "127.0.0.1", VIRTUAL_PORT_BASE + lastRoomId);
      room.publicRoom = true;
      room.permanent = true;
      this.spawnRelay(room);
      this.rooms.push(room);
    }
  }

  /** Accept a fresh lobby connection. First message = player name. */
  registerConnection(socket: ConnectedSocket): LobbyPlayer {
    const player = new LobbyPlayer(this, socket);
    this.players.push(player);
    return player;
  }

  handleName(player: LobbyPlayer, name: string): void {
    player.name = name;
    if (name === Constants.DUMMY_NAME) {
      player.dummy = true;
    } else {
      player.dummy = false;
    }
    this.registerNewPlayer(player);
    this.sendListPlayers(player);
    this.sendListRooms(player);
  }

  registerNewPlayer(newPlayer: LobbyPlayer): void {
    if (!newPlayer.dummy) {
      this.sendMessageAll(`${NetworkProtocol.JOIN}&${newPlayer.name}&${newPlayer.playerID}`);
    }
  }

  private sendChat(playerID: number, chatMessage: string): void {
    this.sendMessageAll(`${NetworkProtocol.SAY_CHAT}&${playerID}&${chatMessage}`);
  }

  private sendNewRoom(room: Room): void {
    this.sendMessageAll(
      `${NetworkProtocol.CREATE_ROOM}&${room.name}&${room.roomID}&${room.getIp()}&${room.port}&${room.key.length > 0 ? 1 : 0}`
    );
  }

  /** Re-broadcast a previously hidden public room (game over, back to PRE_GAME). */
  sendCreateRoom(room: Room): void {
    this.sendNewRoom(room);
  }

  /** Take a public room out of the lobby list while a game is running in it. */
  sendCloseRoom(room: Room): void {
    this.sendMessageAll(`${NetworkProtocol.CLOSE_ROOM}&${room.roomID}`);
  }

  sendListPlayers(player: LobbyPlayer): void {
    let message = "";
    let i = 0;
    for (const tempPlayer of this.players) {
      if (!tempPlayer.dummy) {
        message = message + "&" + tempPlayer.name + "&" + tempPlayer.playerID;
        i++;
      }
    }
    player.sendMessage(`${NetworkProtocol.LIST_PLAYERS}&${i}${message}`);
  }

  sendListRooms(player: LobbyPlayer): void {
    let message = "";
    let i = 0;
    for (const room of this.rooms) {
      if (room.hidden) continue;
      message =
        message +
        "&" +
        room.name +
        "&" +
        room.roomID +
        "&" +
        room.getIp() +
        "&" +
        room.port +
        "&" +
        room.gameMode +
        "&" +
        room.numPlayers +
        "&" +
        (room.key.length > 0 ? 1 : 0);
      i++;
    }
    player.sendMessage(`${NetworkProtocol.LIST_ROOMS}&${i}${message}`);
  }

  updateRoom(room: Room): void {
    this.sendMessageAll(
      `${NetworkProtocol.ROOM_STATUS}&${room.roomID}&${room.gameMode}&${room.numPlayers}`
    );
  }

  private sendMessageAll(message: string): void {
    for (const player of [...this.players]) {
      player.sendMessage(message);
    }
  }

  removePlayer(player: LobbyPlayer): void {
    if (this.players.indexOf(player) === -1) return;
    this.players = this.players.filter((p) => p !== player);
    this.sendMessageAll(`${NetworkProtocol.QUIT}&${player.playerID}`);
    player.disconnect();
    if (player.room !== null) {
      this.removeRoom(player.room);
    }
    this.writeStatus();
  }

  removeRoom(room: Room): void {
    this.sendMessageAll(`${NetworkProtocol.CLOSE_ROOM}&${room.roomID}`);
    this.rooms = this.rooms.filter((r) => r !== room);
    if (room.relay !== null) {
      room.relay.detached = true;
    }
    this.writeStatus();
  }

  private spawnRelay(room: Room): void {
    room.server = this;
    const relay = new RoomServer(room.roomID, room.name, room.port, room.key, room.permanent);
    relay.setStatusListener({
      onRoomStatus: (mode, numPlayers) => {
        room.onRoomStatus(mode, numPlayers);
        this.updateRoom(room);
      },
      onRoomGameState: (state) => {
        room.onRoomGameState(state);
      },
      onRoomEmpty: () => {
        room.onRoomEmpty();
      },
    });
    room.relay = relay;
  }

  handleMessage(message: string, player: LobbyPlayer): void {
    const info = message.split("&");
    if (info.length > 0) {
      const code = parseInt(info[0], 10);
      switch (code) {
        case NetworkProtocol.NO_INFO: {
          player.sendMessage(`${NetworkProtocol.NO_INFO}`);
          break;
        }

        case NetworkProtocol.SAY_CHAT: {
          if (info.length === 2) {
            this.sendChat(player.playerID, info[1]);
          }
          break;
        }

        case NetworkProtocol.ROOM_STATUS: {
          if (info.length === 3) {
            const gameMode = parseInt(info[1], 10);
            const numPlayers = parseInt(info[2], 10);
            const room = player.room;
            if (room !== null && room.relay !== null) {
              room.onRoomStatus(gameMode, numPlayers);
              this.updateRoom(room);
            }
          }
          break;
        }

        case NetworkProtocol.CREATE_ROOM: {
          if (info.length === 3) {
            const roomName = info[1];
            // Web-hosted rooms: the requested port is replaced by a virtual port.
            const room = new Room(roomName, "127.0.0.1", VIRTUAL_PORT_BASE + lastRoomId, info[2]);
            if (this.rooms.length >= this.maxRooms) {
              player.sendMessage(`${NetworkProtocol.ROOM_INVALID}`);
            } else {
              this.spawnRelay(room);
              this.rooms.push(room);
              player.room = room;
              this.sendNewRoom(room);
              this.writeStatus();
            }
          }
          break;
        }

        case NetworkProtocol.NAME_CHANGE: {
          if (info.length === 2) {
            player.name = info[1];
            player.dummy = info[1] === Constants.DUMMY_NAME;
            for (const tempPlayer of this.players) {
              this.sendListPlayers(tempPlayer);
            }
            this.writeStatus();
          }
          break;
        }

        case NetworkProtocol.QUIT: {
          if (info.length === 1) {
            if (player.room !== null) {
              this.removeRoom(player.room);
            }
            this.removePlayer(player);
          }
          break;
        }

        case NetworkProtocol.CLOSE_ROOM: {
          if (info.length === 1) {
            if (player.room !== null) {
              this.removeRoom(player.room);
            }
          }
          break;
        }
      }
    }
  }

  private checkRooms(): void {
    if (Date.now() - this.lastRoomCheck > 5 * 60 * 1000) {
      this.lastRoomCheck = Date.now();
      const playerSnapshot = [...this.players];
      this.rooms = this.rooms.filter((room) => {
        if (room.publicRoom) return true;
        const owned = playerSnapshot.some((p) => p.room === room);
        if (!owned && room.relay !== null && room.relay.clients.length === 0) {
          room.relay.shutdown();
          room.relay = null;
        }
        return owned;
      });
      for (const tempPlayer of playerSnapshot) {
        this.sendListRooms(tempPlayer);
      }
    }
  }

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  writeStatus(): void {
    const playerCount = this.players.filter((p) => !p.dummy).length;
    const timestamp = new Date().toString();

    let sb = "<!DOCTYPE html>\n<html>\n<head>\n";
    sb += '<meta charset="utf-8">\n';
    sb += '<meta http-equiv="refresh" content="30">\n';
    sb += "<title>Graphwar Status</title>\n";
    sb +=
      "body{font-family:sans-serif;max-width:600px;margin:40px auto;color:#222;}h1{border-bottom:2px solid #888;padding-bottom:8px;}.stat{font-size:1.2em;margin:8px 0;}table{border-collapse:collapse;width:100%;margin-top:20px;}th,td{padding:8px 12px;border:1px solid #ccc;text-align:left;}th{background:#f0f0f0;}";
    sb += "</head>\n<body>\n";
    sb += "<h1>Graphwar Server Status</h1>\n";
    sb += `<p style="color:#666">Updated: ${timestamp}</p>\n`;
    sb += `<p class="stat">Players online: <strong>${playerCount}</strong></p>\n`;
    sb += `<p class="stat">Rooms open: <strong>${this.rooms.length}</strong></p>\n`;
    if (this.rooms.length > 0) {
      sb += "<table>\n<tr><th>Room</th><th>Players</th><th>Status</th></tr>\n";
      for (const room of this.rooms) {
        let mode: string;
        switch (room.gameMode) {
          case Constants.GAME:
            mode = "In game";
            break;
          case Constants.PRE_GAME:
            mode = "Starting";
            break;
          default:
            mode = "Waiting";
            break;
        }
        sb +=
          `<tr><td>${this.escapeHtml(room.name)}${room.key.length > 0 ? " (private)" : ""}</td><td>${room.numPlayers}</td><td>${mode}</td></tr>\n`;
      }
      sb += "</table>\n";
    }
    sb += "</body>\n</html>\n";
    this.statusHtml = sb;
  }

  getStatusHtml(): string {
    return this.statusHtml;
  }

  shutdown(): void {
    this.ticker.stop();
    for (const room of [...this.rooms]) {
      room.relay?.shutdown();
    }
  }
}