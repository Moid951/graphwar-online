import { Constants, NetworkProtocol, gaussian, intCast } from "@graphwar/math";
import { ConnectedSocket, SocketLike, Ticker, checkDrop, checkKeepAlive } from "./net.js";

let lastPlayerId = 0;

export function resetRelayIds(): void {
  lastPlayerId = 0;
}

export class ServerPlayer {
  name: string;
  numSoldiers: number;
  team: number;
  playerID: number;
  ready: boolean;

  constructor(name: string) {
    this.name = name;
    this.numSoldiers = Constants.INITIAL_NUM_SOLDIERS;
    this.team = Math.random() < 0.5 ? Constants.TEAM1 : Constants.TEAM2;
    this.playerID = lastPlayerId;
    this.ready = false;
    lastPlayerId++;
  }
}

export class ClientConnection {
  server: RoomServer;
  socket: ConnectedSocket;
  players: ServerPlayer[] = [];
  leader = false;
  readyNextTurn = false;
  gameFinished = false;
  skipLevel = false;
  authenticated = false;

  constructor(server: RoomServer, socket: ConnectedSocket) {
    this.server = server;
    this.socket = socket;
  }

  sendMessage(message: string): void {
    this.socket.send(message);
  }

  disconnect(): void {
    this.socket.close();
  }
}

export interface RoomStatusListener {
  onRoomStatus(mode: number, numPlayers: number): void;
  onRoomGameState(state: number): void;
  onRoomEmpty(): void;
}

export class RoomServer {
  clients: ClientConnection[] = [];
  players: ServerPlayer[] = [];
  acceptingConnections = true;
  gameMode: number = Constants.NORMAL_FUNC;
  gameState: number = Constants.PRE_GAME;
  private countingDown = false;
  private startDelayerTimer: ReturnType<typeof setTimeout> | null = null;
  timeTurnStarted = 0;

  private ticker = new Ticker();
  readonly roomID: number;
  readonly roomName: string;
  readonly virtualPort: number;
  readonly key: string;
  private statusListener: RoomStatusListener | null = null;
  private shutdownFlag = false;
  private lastClientsChange = Date.now();
  private emptyRoomTimer: ReturnType<typeof setTimeout> | null = null;
  detached = false;
  readonly permanent: boolean;

  constructor(roomID: number, roomName: string, virtualPort: number, key: string, permanent = false) {
    this.roomID = roomID;
    this.roomName = roomName;
    this.virtualPort = virtualPort;
    this.key = key;
    this.permanent = permanent;
    this.startTicker();
  }

  setStatusListener(l: RoomStatusListener): void {
    this.statusListener = l;
  }

  private notifyStatus(): void {
    this.statusListener?.onRoomStatus(this.gameMode, this.players.length);
  }

  private notifyGameState(): void {
    this.statusListener?.onRoomGameState(this.gameState);
  }

  private leaderClient(): ClientConnection | null {
    return this.clients.find((c) => c.leader) ?? null;
  }

  private leaderPlayerID(): number {
    const leader = this.leaderClient();
    if (leader === null || leader.players.length === 0) return -1;
    return leader.players[0].playerID;
  }

  private sendLeaderInfo(): void {
    this.sendMessageAll(`${NetworkProtocol.SET_LEADER}&${this.leaderPlayerID()}`);
  }

  private scheduleEmptyClose(): void {
    if (this.permanent || this.detached || this.clients.length !== 0) return;
    if (this.emptyRoomTimer !== null) return;
    this.emptyRoomTimer = setTimeout(() => {
      this.emptyRoomTimer = null;
      if (!this.permanent && !this.detached && this.clients.length === 0) {
        this.statusListener?.onRoomEmpty();
      }
    }, Constants.EMPTY_ROOM_CLOSE_DELAY);
  }

  private cancelEmptyClose(): void {
    if (this.emptyRoomTimer !== null) {
      clearTimeout(this.emptyRoomTimer);
      this.emptyRoomTimer = null;
    }
  }

  private canStartGame(): boolean {
    if (this.players.length < 2) return false;
    const teams = new Set(this.players.map((p) => p.team));
    if (teams.size < 2) return false;
    return this.checkAllReady();
  }

  private startTicker(): void {
    this.ticker.start(1000, () => {
      for (const client of [...this.clients]) {
        if (checkDrop(client.socket.getLastReceived())) {
          this.removeClient(client);
          client.disconnect();
        } else if (checkKeepAlive(client.socket.getLastSent())) {
          client.sendMessage(`${NetworkProtocol.NO_INFO}`);
        }
      }
      if (this.detached && this.clients.length === 0 && Date.now() - this.lastClientsChange > 5000) {
        this.shutdown();
      }
    });
  }

  /** Returns a ConnectedSocket wrapper. Only used by the WS layer. */
  createClientConnection(connection: ConnectedSocket): ClientConnection {
    if (this.clients.length >= Constants.MAX_CLIENTS || !this.acceptingConnections) {
      const client = new ClientConnection(this, connection);
      client.sendMessage(`${NetworkProtocol.GAME_FULL}`);
      client.disconnect();
      return client;
    }

    return new ClientConnection(this, connection);
  }

  /** First message must be a key handshake (web-only rooms are key-gated). */
  private handleAuth(message: string, client: ClientConnection): void {
    const info = message.split("&");
    if (info[0] === String(NetworkProtocol.KEY) && info.length === 2 && info[1] === this.key) {
      client.authenticated = true;
      this.acceptClient(client);
    } else {
      client.sendMessage(`${NetworkProtocol.KEY_DENIED}`);
      client.disconnect();
    }
  }

  private acceptClient(client: ClientConnection): void {
    if (this.clients.length === 0) {
      client.leader = true;
    }
    this.cancelEmptyClose();
    this.clients.push(client);
    this.lastClientsChange = Date.now();
    this.notifyStatus();

    this.sendAllInfoMessage(client);
    client.sendMessage(`${NetworkProtocol.SET_LEADER}&${this.leaderPlayerID()}`);
    if (client.leader) {
      this.sendLeaderMessage(client);
    }
  }

  private sendMessageAll(message: string): void {
    for (const client of this.clients) {
      client.sendMessage(message);
    }
  }

  private sendLeaderMessage(client: ClientConnection): void {
    client.sendMessage(`${NetworkProtocol.NEW_LEADER}`);
  }

  private sendAllInfoMessage(client: ClientConnection): void {
    for (const tmpClient of this.clients) {
      for (const player of tmpClient.players) {
        const local = client === tmpClient ? 1 : 0;
        const ready = player.ready ? 1 : 0;
        const message = `${NetworkProtocol.ADD_PLAYER}&${player.playerID}&${player.name}&${player.team}&${local}&${player.numSoldiers}&${ready}`;
        client.sendMessage(message);
      }
    }
    client.sendMessage(`${NetworkProtocol.SET_MODE}&${this.gameMode}`);
  }

  protected sendAddPlayerMessage(player: ServerPlayer, playerFrom: ClientConnection): void {
    for (const client of this.clients) {
      const local = client === playerFrom ? 1 : 0;
      const ready = player.ready ? 1 : 0;
      const message = `${NetworkProtocol.ADD_PLAYER}&${player.playerID}&${player.name}&${player.team}&${local}&${player.numSoldiers}&${ready}`;
      client.sendMessage(message);
    }
    this.sendLeaderInfo();
  }

  private setTeam(team: number, playerID: number, client: ClientConnection): boolean {
    for (const player of client.players) {
      if (player.playerID === playerID) {
        player.team = team;
        return true;
      }
    }
    if (client.leader) {
      for (const tmpClient of this.clients) {
        for (const player of tmpClient.players) {
          if (player.playerID === playerID) {
            player.team = team;
            return true;
          }
        }
      }
    }
    return false;
  }

  protected removePlayer(playerID: number, client: ClientConnection): boolean {
    const idx = client.players.findIndex((p) => p.playerID === playerID);
    if (idx !== -1) {
      const player = client.players.splice(idx, 1)[0];
      const pidx = this.players.indexOf(player);
      if (pidx !== -1) this.players.splice(pidx, 1);
      return true;
    }
    if (client.leader) {
      for (const tmpClient of this.clients) {
        const jdx = tmpClient.players.findIndex((p) => p.playerID === playerID);
        if (jdx !== -1) {
          const player = tmpClient.players.splice(jdx, 1)[0];
          const pidx = this.players.indexOf(player);
          if (pidx !== -1) this.players.splice(pidx, 1);
          return true;
        }
      }
    }
    return false;
  }

  private setReady(playerID: number, client: ClientConnection, ready: boolean): boolean {
    for (const player of client.players) {
      if (player.playerID === playerID) {
        player.ready = ready;
        if (!ready && this.startDelayerTimer !== null) {
          this.stopStartDelayer();
        }
        return true;
      }
    }
    return false;
  }

  private addSoldier(playerID: number, client: ClientConnection): boolean {
    for (const player of client.players) {
      if (player.playerID === playerID) {
        const newNum = player.numSoldiers + 1;
        if (newNum <= Constants.MAX_SOLDIERS_PER_PLAYER) {
          player.numSoldiers = newNum;
          return true;
        }
        break;
      }
    }
    if (client.leader) {
      for (const tmpClient of this.clients) {
        for (const player of tmpClient.players) {
          if (player.playerID === playerID) {
            const newNum = player.numSoldiers + 1;
            if (newNum <= Constants.MAX_SOLDIERS_PER_PLAYER) {
              player.numSoldiers = newNum;
              return true;
            }
            break;
          }
        }
      }
    }
    return false;
  }

  private removeSoldier(playerID: number, client: ClientConnection): boolean {
    for (const player of client.players) {
      if (player.playerID === playerID) {
        const newNum = player.numSoldiers - 1;
        if (newNum >= 0) {
          player.numSoldiers = newNum;
          return true;
        }
        break;
      }
    }
    if (client.leader) {
      for (const tmpClient of this.clients) {
        for (const player of tmpClient.players) {
          if (player.playerID === playerID) {
            const newNum = player.numSoldiers - 1;
            if (newNum >= 0) {
              player.numSoldiers = newNum;
              return true;
            }
            break;
          }
        }
      }
    }
    return false;
  }

  private setEveryoneNotReady(): void {
    this.stopStartDelayer();
    for (const tmpClient of this.clients) {
      if (tmpClient.leader) continue;
      for (const player of tmpClient.players) {
        if (player.ready) {
          player.ready = false;
          this.sendMessageAll(`${NetworkProtocol.SET_READY}&${player.playerID}&0`);
        }
      }
    }
  }

  private checkPlayer(playerID: number, client: ClientConnection): boolean {
    return client.players.some((p) => p.playerID === playerID);
  }

  private findClientByPlayer(playerID: number): ClientConnection | null {
    return this.clients.find((c) => c.players.some((p) => p.playerID === playerID)) ?? null;
  }

  protected sendModeMessage(): void {
    this.sendMessageAll(`${NetworkProtocol.SET_MODE}&${this.gameMode}`);
    this.notifyStatus();
  }

  private checkAllReady(): boolean {
    for (const tmpClient of this.clients) {
      if (tmpClient.leader) continue;
      for (const player of tmpClient.players) {
        if (!player.ready) return false;
      }
    }
    return true;
  }

  removeClient(client: ClientConnection): void {
    const idx = this.clients.indexOf(client);
    if (idx === -1) return;
    this.clients.splice(idx, 1);
    this.lastClientsChange = Date.now();

    for (const player of [...client.players]) {
      this.sendMessageAll(`${NetworkProtocol.REMOVE_PLAYER}&${player.playerID}`);
      const pidx = this.players.indexOf(player);
      if (pidx !== -1) this.players.splice(pidx, 1);
    }
    this.sendLeaderInfo();

    if (this.clients.length > 0) {
      if (client.leader) {
        this.clients[0].leader = true;
        this.sendLeaderMessage(this.clients[0]);
        this.sendLeaderInfo();
      }
    } else {
      if (this.gameState === Constants.GAME) {
        this.goPreGame();
      }
      this.notifyStatus();
      this.scheduleEmptyClose();
      return;
    }

    this.notifyStatus();
    this.checkNextTurn();
  }

  private generateCircles(): number[] {
    let numCircles = intCast(
      gaussian() * Constants.NUM_CIRCLES_STANDARD_DEVIATION + Constants.NUM_CIRCLES_MEAN_VALUE
    );
    if (numCircles < 1) numCircles = 1;

    const circles: number[] = [];
    for (let i = 0; i < numCircles; i++) {
      circles.push(Math.floor(Math.random() * Constants.PLANE_LENGTH));
      circles.push(Math.floor(Math.random() * Constants.PLANE_HEIGHT));
      let r = intCast(gaussian() * Constants.CIRCLE_STANDARD_DEVIATION + Constants.CIRCLE_MEAN_RADIUS);
      while (r < 0) {
        r = intCast(gaussian() * Constants.CIRCLE_STANDARD_DEVIATION + Constants.CIRCLE_MEAN_RADIUS);
      }
      circles.push(r);
    }
    return circles;
  }

  private distance(x1: number, y1: number, x2: number, y2: number): number {
    return Math.sqrt((x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2));
  }

  private testSoldier(
    soldier: { x: number; y: number },
    soldiers: { x: number; y: number }[],
    circles: number[]
  ): boolean {
    for (const tempSoldier of soldiers) {
      if (Math.abs(soldier.x - tempSoldier.x) < 20 && Math.abs(soldier.y - tempSoldier.y) < 20) {
        return false;
      }
    }
    const numCircles = circles.length / 3;
    for (let i = 0; i < numCircles; i++) {
      if (
        this.distance(soldier.x, soldier.y, circles[3 * i], circles[3 * i + 1]) <
        circles[3 * i + 2] + Constants.SOLDIER_SELECTION_RADIUS
      ) {
        return false;
      }
    }
    return true;
  }

  private generateSoldier(
    soldiers: { x: number; y: number }[],
    circles: number[],
    team: number
  ): { x: number; y: number } {
    let soldier: { x: number; y: number };
    do {
      const x =
        Math.floor(
          Math.random() * (Constants.PLANE_LENGTH / 2 - 2 * Constants.SOLDIER_RADIUS)
        ) + Constants.SOLDIER_RADIUS;
      const y =
        Math.floor(Math.random() * (Constants.PLANE_HEIGHT - 2 * Constants.SOLDIER_RADIUS)) +
        Constants.SOLDIER_RADIUS;
      if (team === Constants.TEAM2) {
        soldier = { x: x + Constants.PLANE_LENGTH / 2, y };
      } else {
        soldier = { x, y };
      }
    } while (!this.testSoldier(soldier, soldiers, circles));
    return soldier;
  }

  private generateSoldiers(circles: number[]): number[] {
    const soldiers: { x: number; y: number }[] = [];
    for (const player of this.players) {
      for (let i = 0; i < player.numSoldiers; i++) {
        soldiers.push(this.generateSoldier(soldiers, circles, player.team));
      }
    }
    const soldiersPos: number[] = [];
    for (const s of soldiers) {
      soldiersPos.push(s.x, s.y);
    }
    return soldiersPos;
  }

  private stopStartDelayer(): void {
    if (this.startDelayerTimer !== null) {
      clearTimeout(this.startDelayerTimer);
      this.startDelayerTimer = null;
    }
    this.countingDown = false;
  }

  protected sendStartGameMessage(): void {
    if (this.checkAllReady()) {
      this.startGame();
    }
    this.countingDown = false;
  }

  private sendStartCountDown(): void {
    if (!this.countingDown) {
      this.countingDown = true;
      this.startDelayerTimer = setTimeout(() => {
        this.startDelayerTimer = null;
        this.sendStartGameMessage();
      }, Constants.START_GAME_DELAY);
      this.sendMessageAll(`${NetworkProtocol.START_COUNTDOWN}`);
    }
  }

  private reorderPlayers(): void {
    const newPlayers: ServerPlayer[] = [];
    let currentTeam: number = Constants.TEAM1;
    if (Math.random() < 0.5) currentTeam = Constants.TEAM2;

    while (this.players.length > 0) {
      let found = false;
      for (let i = 0; i < this.players.length; i++) {
        if (this.players[i].team === currentTeam) {
          newPlayers.push(this.players.splice(i, 1)[0]);
          currentTeam = currentTeam === Constants.TEAM1 ? Constants.TEAM2 : Constants.TEAM1;
          found = true;
          break;
        }
      }
      if (!found) {
        currentTeam = currentTeam === Constants.TEAM1 ? Constants.TEAM2 : Constants.TEAM1;
      }
    }

    this.players = newPlayers;

    let message = `${NetworkProtocol.REORDER}`;
    for (const player of this.players) {
      message = message + "&" + player.playerID;
    }
    this.sendMessageAll(message);
  }

  protected startGame(): void {
    this.acceptingConnections = false;

    this.reorderPlayers();

    const circles = this.generateCircles();
    const numCircles = circles.length / 3;

    const soldiers = this.generateSoldiers(circles);

    if (soldiers.length === 0) {
      return; // Game can't start with no soldiers
    }

    let message = `${NetworkProtocol.START_GAME}&${numCircles}`;
    for (const c of circles) {
      message = message + "&" + c;
    }
    for (const s of soldiers) {
      message = message + "&" + s;
    }

    let startPlayer = Math.floor(Math.random() * this.players.length);
    while (this.players[startPlayer].numSoldiers === 0) {
      startPlayer = Math.floor(Math.random() * this.players.length);
    }

    message = message + "&" + startPlayer;

    this.sendMessageAll(message);

    this.timeTurnStarted = Date.now();
    this.gameState = Constants.GAME;
    this.notifyGameState();

    this.setEveryoneNotReady();
    this.notifyStatus();
  }

  private checkNextTurn(): void {
    for (const client of this.clients) {
      if (!client.readyNextTurn) return;
    }
    this.nextTurn();
  }

  private nextTurn(): void {
    for (const client of this.clients) {
      client.readyNextTurn = false;
    }
    this.sendMessageAll(`${NetworkProtocol.NEXT_TURN}`);
    this.timeTurnStarted = Date.now();
  }

  protected finishGame(client: ClientConnection): void {
    client.gameFinished = true;
    for (const tempClient of this.clients) {
      if (!tempClient.gameFinished) return;
    }

    for (const tempClient of this.clients) {
      tempClient.gameFinished = false;
      tempClient.skipLevel = false;
    }

    this.setEveryoneNotReady();
    this.sendMessageAll(`${NetworkProtocol.GAME_FINISHED}`);
    this.goPreGame();
  }

  protected goPreGame(): void {
    this.gameState = Constants.PRE_GAME;
    this.acceptingConnections = true;
    this.notifyGameState();
    this.notifyStatus();
  }

  private checkTimeUp(): void {
    if (Date.now() - this.timeTurnStarted > Constants.TURN_TIME) {
      this.nextTurn();
    }
  }

  private checkSkipLevel(): void {
    for (const client of this.clients) {
      if (!client.skipLevel) return;
    }
    for (const client of this.clients) {
      client.skipLevel = false;
    }
    this.startGame();
  }

  private handleCommands(msg: string, _client: ClientConnection): void {
    if (msg.startsWith("-")) {
      if (msg.localeCompare("-skip", undefined, { sensitivity: "accent" }) === 0) {
        // ignore case semantics preserved via compareToIgnoreCase
        if (this.gameState === Constants.GAME) {
          _client.skipLevel = true;
          this.checkSkipLevel();
        }
      }
    }
  }

  handleMessage(message: string, client: ClientConnection): void {
    if (!client.authenticated) {
      this.handleAuth(message, client);
      return;
    }
    const info = message.split("&");
    try {
      const type = parseInt(info[0], 10);
      switch (type) {
        case NetworkProtocol.NO_INFO:
          break;

        case NetworkProtocol.ADD_PLAYER: {
          if (this.players.length < Constants.MAX_PLAYERS) {
            const player = new ServerPlayer(info[1]);
            client.players.push(player);
            this.players.push(player);
            this.setEveryoneNotReady();
            if (client.leader) player.ready = true;
            this.sendAddPlayerMessage(player, client);
            this.notifyStatus();
          }
          break;
        }

        case NetworkProtocol.SET_TEAM: {
          const team = parseInt(info[1], 10);
          const playerID = parseInt(info[2], 10);
          if (this.setTeam(team, playerID, client)) {
            this.setEveryoneNotReady();
            this.sendMessageAll(message);
            this.notifyStatus();
          }
          break;
        }

        case NetworkProtocol.REMOVE_PLAYER: {
          const playerID = parseInt(info[1], 10);
          if (this.removePlayer(playerID, client)) {
            this.setEveryoneNotReady();
            this.sendMessageAll(message);
            this.notifyStatus();
          }
          break;
        }

        case NetworkProtocol.ADD_SOLDIER: {
          const playerID = parseInt(info[1], 10);
          if (this.addSoldier(playerID, client)) {
            this.setEveryoneNotReady();
            this.sendMessageAll(message);
            this.notifyStatus();
          }
          break;
        }

        case NetworkProtocol.REMOVE_SOLDIER: {
          const playerID = parseInt(info[1], 10);
          if (this.removeSoldier(playerID, client)) {
            this.setEveryoneNotReady();
            this.sendMessageAll(message);
            this.notifyStatus();
          }
          break;
        }

        case NetworkProtocol.CHAT_MSG: {
          const playerID = parseInt(info[1], 10);
          if (this.checkPlayer(playerID, client)) {
            this.handleCommands(info[2], client);
            this.sendMessageAll(message);
          }
          break;
        }

        case NetworkProtocol.NEXT_MODE: {
          if (client.leader) {
            this.gameMode = (this.gameMode + 1) % 3;
            this.setEveryoneNotReady();
            this.sendModeMessage();
          }
          break;
        }

        case NetworkProtocol.SET_READY: {
          const playerID = parseInt(info[1], 10);
          const ready = parseInt(info[2], 10) !== 0;
          if (this.setReady(playerID, client, ready)) {
            this.sendMessageAll(message);
            this.notifyStatus();
          }
          break;
        }

        case NetworkProtocol.START_GAME: {
          if (client.leader && this.gameState === Constants.PRE_GAME && this.canStartGame()) {
            this.sendStartCountDown();
          }
          break;
        }

        case NetworkProtocol.KICK: {
          const playerID = parseInt(info[1], 10);
          if (!client.leader) break;
          const target = this.findClientByPlayer(playerID);
          if (target === null || target === client) break;
          target.sendMessage(`${NetworkProtocol.KICKED}`);
          this.removeClient(target);
          target.disconnect();
          break;
        }

        case NetworkProtocol.TRANSFER_LEADER: {
          const playerID = parseInt(info[1], 10);
          if (!client.leader) break;
          const target = this.findClientByPlayer(playerID);
          if (target === null || target === client) break;
          client.leader = false;
          target.leader = true;
          for (const player of target.players) {
            player.ready = true;
          }
          this.sendLeaderMessage(target);
          this.sendLeaderInfo();
          break;
        }

        case NetworkProtocol.CANCEL_START: {
          if (client.leader && this.startDelayerTimer !== null) {
            this.stopStartDelayer();
            this.sendMessageAll(`${NetworkProtocol.CANCEL_START}`);
          }
          break;
        }

        case NetworkProtocol.READY_NEXT_TURN: {
          if (this.gameState === Constants.GAME) {
            client.readyNextTurn = true;
            this.checkNextTurn();
          }
          break;
        }

        case NetworkProtocol.FIRE_FUNC: {
          const playerID = parseInt(info[1], 10);
          if (this.checkPlayer(playerID, client) && this.gameState === Constants.GAME) {
            this.sendMessageAll(message);
          }
          break;
        }

        case NetworkProtocol.FUNCTION_PREVIEW: {
          const playerID = parseInt(info[1], 10);
          if (this.checkPlayer(playerID, client) && this.gameState === Constants.GAME) {
            this.sendMessageAll(message);
          }
          break;
        }

        case NetworkProtocol.TIME_UP: {
          if (this.gameState === Constants.GAME) {
            this.checkTimeUp();
          }
          break;
        }

        case NetworkProtocol.GAME_FINISHED: {
          this.finishGame(client);
          break;
        }

        case NetworkProtocol.SET_ANGLE: {
          const playerID = parseInt(info[1], 10);
          if (this.checkPlayer(playerID, client) && this.gameState === Constants.GAME) {
            this.sendMessageAll(message);
          }
          break;
        }

        case NetworkProtocol.DISCONNECT: {
          this.removeClient(client);
          client.disconnect();
          break;
        }
      }
    } catch {
      // invalid message, ignore (Java logged it)
    }
  }

  shutdown(): void {
    this.shutdownFlag = true;
    this.ticker.stop();
    this.stopStartDelayer();
    for (const client of [...this.clients]) {
      client.disconnect();
    }
  }
}