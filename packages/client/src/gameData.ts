import {
  Constants,
  NetworkProtocol,
  FunctionSim,
  Obstacle,
  javaUrlDecode,
  javaUrlEncode,
  mutateFunction,
  crossoverFunctions,
  simplifyFunction,
  getStringFunction,
  makeRandomTokens,
  PlayerSim,
  SimResult,
  CircleInfo,
} from "@graphwar/math";
import { Player, Soldier, toSimPlayers } from "./models.js";
import { ClientConnection, SocketFactory, roomWsUrl } from "./network.js";

/** UI callbacks the state machine drives (port of direct Swing screen calls). */
export interface GameUI {
  chatPregame(player: Player | null, message: string): void;
  chatGame(player: Player | null, message: string): void;
  preGameAddPlayer(p: Player): void;
  preGameRemovePlayer(p: Player): void;
  preGameUpdatePlayer(p: Player): void;
  preGameSetMode(mode: number): void;
  preGameSetReadyButtonOn(on: boolean): void;
  preGameSetCountdownActive(active: boolean): void;
  preGameRepaint(): void;
  preGameShowMessage(msg: string): void;
  preGameRefreshBoard(): void;
  preGameRestartScreen(): void;

  gameStartDrawingFunction(): void;
  gameUpdateFunction(func: string): void;
  gameRefreshFunction(): void;
  gameRefreshSoldiers(): void;
  gameRefreshBack(): void;

  gameRepaintAngle(): void;
  gameStopPanel(): void;
  gameShowMessage(msg: string): void;
  gameSetNextMarker(on: boolean): void;
  enterGameScreen(): void;
  enterPregameScreen(): void;
  globalRefreshGameButton(): void;
  globalRefreshPlayers(): void;
  globalRefreshRooms(): void;
  globalShowDisconnectMessage(msg: string): void;
}

export class GameData {
  private ui: GameUI;
  private socketFactory: SocketFactory;
  connection: ClientConnection | null = null;

  players: Player[] = [];
  private nextPCs: number[] = [];
  obstacle: Obstacle | null = null;

  gameMode: number = Constants.NORMAL_FUNC;
  gameState: number = Constants.NONE;

leader = false;
  leaderPlayerID = -1;
  private kicked = false;
  currentTurn: number = -1;
  lastLocalHumanPlayer: Player | null = null;
  timeTurnStarted = 0;
  turnTimeUp = false;
  nextTurnSent = false;

  function: FunctionSim | null = null;
  simResult: SimResult | null = null;
  drawingFunction = false;
  timeStartedDrawingFunction = 0;
  exploding = false;
  timeStartedExploding = 0;
  soldiersHit: Soldier[] = [];

  angleUpActive = false;
  angleDownActive = false;
  timeStartedAngle = 0;

  countingDown = false;
  countdownTimer: ReturnType<typeof setTimeout> | null = null;

  sayFunc = true;

  /** Fired by the UI when it leaves the game (back to lobby / main menu). */
  onGameStop: (() => void) | null = null;
  /** Fired when a local AI player wants to send a function (uses real FIRE_FUNC path). */
  private computerPlayers: ComputerPlayer[] = [];

  constructor(ui: GameUI | null, socketFactory: SocketFactory) {
    this.ui = ui ?? (new Proxy({} as GameUI, { get: () => () => {} }) as GameUI);
    this.socketFactory = socketFactory;
  }

  setUI(ui: GameUI): void {
    this.ui = ui;
  }

  connect(roomID: number, key = ""): void {
    const events = {
      onMessage: (m: string) => this.handleMessage(m),
      onClose: () => this.kickFromGame(),
    };
    const socket = this.socketFactory.connect(roomWsUrl(roomID), events);
    this.connection = new ClientConnection(socket, (m) => this.handleMessage(m));
    this.connection.send(`${NetworkProtocol.KEY}&${javaUrlEncode(key)}`);

    this.gameState = Constants.PRE_GAME;
    this.drawingFunction = false;
    this.exploding = false;
    this.players = [];
    this.lastLocalHumanPlayer = null;
    this.currentTurn = -1;
    this.turnTimeUp = false;
    this.nextTurnSent = false;
    this.computerPlayers = [];
    this.leader = false;
    this.leaderPlayerID = -1;
    this.kicked = false;

    this.ui.globalRefreshGameButton();
  }

  disconnect(): void {
    this.connection?.send(`${NetworkProtocol.DISCONNECT}`);
    this.connection?.close();
    this.connection = null;
    this.stopGame();
  }

  getPlayer(playerID: number): Player | null {
    for (const player of this.players) {
      if (player.playerID === playerID) return player;
    }
    return null;
  }

  getFirstLocalPlayer(): Player | null {
    for (const player of this.players) {
      if (player.localPlayer) return player;
    }
    return null;
  }

  isTerrainReversed(): boolean {
    if (this.lastLocalHumanPlayer === null) {
      const first = this.getFirstLocalPlayer();
      if (first !== null) {
        return first.team === Constants.TEAM2;
      }
      return false;
    }
    return this.lastLocalHumanPlayer.team === Constants.TEAM2;
  }

  isFunctionReversed(): boolean {
    return this.getCurrentTurnPlayer().team === Constants.TEAM2;
  }

  getCurrentTurnPlayer(): Player {
    return this.players[this.currentTurn];
  }

  getRemainingTime(): number {
    let time = Constants.TURN_TIME - (Date.now() - this.timeTurnStarted);
    if (this.drawingFunction || this.exploding) {
      time = Constants.TURN_TIME - (this.timeStartedDrawingFunction - this.timeTurnStarted);
    }
    if (time < 0) {
      time = 0;
      if (this.turnTimeUp === false) {
        this.turnTimeUp = true;
        if (this.gameState === Constants.GAME) {
          this.connection?.send(`${NetworkProtocol.TIME_UP}`);
        }
      }
    }
    return time;
  }

  sendChatMessage(chat: string): void {
    const player = this.getFirstLocalPlayer();
    let id = -1;
    if (player !== null) id = player.playerID;
    this.connection?.send(`${NetworkProtocol.CHAT_MSG}&${id}&${javaUrlEncode(chat)}`);
    this.handleCommands(chat);
  }

  sendFunctionPreview(functionPreview: string): void {
    const currentPlayer = this.getCurrentTurnPlayer();
    if (currentPlayer.localPlayer && !this.drawingFunction) {
      this.connection?.send(
        `${NetworkProtocol.FUNCTION_PREVIEW}&${currentPlayer.playerID}&${javaUrlEncode(functionPreview)}`
      );
    }
  }

  sendFunction(functionString: string): void {
    const currentPlayer = this.getCurrentTurnPlayer();
    if (currentPlayer.localPlayer && !this.drawingFunction) {
      try {
        new FunctionSim(functionString);
      } catch {
        return;
      }
      this.connection?.send(
        `${NetworkProtocol.FIRE_FUNC}&${currentPlayer.playerID}&${javaUrlEncode(functionString)}`
      );
    }
  }

  nextMode(): void {
    this.connection?.send(`${NetworkProtocol.NEXT_MODE}`);
  }

  sendStartGame(): void {
    this.connection?.send(`${NetworkProtocol.START_GAME}`);
  }

  sendCancelStart(): void {
    this.connection?.send(`${NetworkProtocol.CANCEL_START}`);
  }

  sendKick(playerID: number): void {
    this.connection?.send(`${NetworkProtocol.KICK}&${playerID}`);
  }

  sendTransferLeader(playerID: number): void {
    this.connection?.send(`${NetworkProtocol.TRANSFER_LEADER}&${playerID}`);
  }

  addPlayer(name: string): void {
    if (this.players.length < Constants.MAX_PLAYERS) {
      this.connection?.send(`${NetworkProtocol.ADD_PLAYER}&${javaUrlEncode(name)}`);
    }
  }

  addPC(name: string, level: number): void {
    if (this.players.length < Constants.MAX_PLAYERS) {
      this.nextPCs.push(level);
      this.addPlayer(name);
    }
  }

  removePlayer(player: Player): void {
    this.connection?.send(`${NetworkProtocol.REMOVE_PLAYER}&${player.playerID}`);
  }

  addSoldier(player: Player): void {
    this.connection?.send(`${NetworkProtocol.ADD_SOLDIER}&${player.playerID}`);
  }

  removeSoldier(player: Player): void {
    this.connection?.send(`${NetworkProtocol.REMOVE_SOLDIER}&${player.playerID}`);
  }

  switchSide(player: Player): void {
    let otherTeam: number = Constants.TEAM1;
    if (player.team === Constants.TEAM1) otherTeam = Constants.TEAM2;
    this.connection?.send(`${NetworkProtocol.SET_TEAM}&${otherTeam}&${player.playerID}`);
  }

  isAngleUp(): boolean {
    return this.angleUpActive;
  }

  isAngleDown(): boolean {
    return this.angleDownActive;
  }

  angleUp(): void {
    const cp = this.getCurrentTurnPlayer();
    if (!this.angleUpActive && cp.localPlayer && !(cp instanceof ComputerPlayer)) {
      this.timeStartedAngle = Date.now();
      this.angleUpActive = true;
      this.ui.gameRepaintAngle();
    }
  }

  angleDown(): void {
    const cp = this.getCurrentTurnPlayer();
    if (!this.angleDownActive && cp.localPlayer && !(cp instanceof ComputerPlayer)) {
      this.timeStartedAngle = Date.now();
      this.angleDownActive = true;
      this.ui.gameRepaintAngle();
    }
  }

  stopAngle(): void {
    const cp = this.getCurrentTurnPlayer();
    if (cp.localPlayer && !(cp instanceof ComputerPlayer)) {
      const player = this.players[this.currentTurn];
      const angle = this.getAngle();
      player.getCurrentTurnSoldier().angle = angle;
      this.angleUpActive = false;
      this.angleDownActive = false;
      this.ui.gameRepaintAngle();
      this.connection?.send(
        `${NetworkProtocol.SET_ANGLE}&${player.playerID}&${player.currentTurnSoldier}&${angle}`
      );
    }
  }

  setAngle(angle: number): void {
    const cp = this.getCurrentTurnPlayer();
    if (cp.localPlayer) {
      const player = this.players[this.currentTurn];
      player.getCurrentTurnSoldier().angle = angle;
      this.ui.gameRepaintAngle();
      this.connection?.send(
        `${NetworkProtocol.SET_ANGLE}&${player.playerID}&${player.currentTurnSoldier}&${angle}`
      );
    }
  }

  getAngle(): number {
    const angleTime = Date.now() - this.timeStartedAngle;
    let acceleration: number = Constants.ANGLE_ACCELERATION;
    if (this.angleDownActive) acceleration = -acceleration;
    const deltaAngle = acceleration * angleTime * angleTime;
    let currentAngle = this.players[this.currentTurn].getCurrentTurnSoldier().angle + deltaAngle;
    if (currentAngle > Math.PI / 2) currentAngle = Math.PI / 2;
    if (currentAngle < -Math.PI / 2) currentAngle = -Math.PI / 2;
    return currentAngle;
  }

  setReady(player: Player, ready: boolean): void {
    const readyInt = ready ? 1 : 0;
    this.connection?.send(`${NetworkProtocol.SET_READY}&${player.playerID}&${readyInt}`);
  }

  private checkGameFinished(): boolean {
    let team1Alive = false;
    let team2Alive = false;
    for (const player of this.players) {
      for (let j = 0; j < player.numSoldiers; j++) {
        if (player.soldiers[j].alive) {
          if (player.team === Constants.TEAM1) team1Alive = true;
          else team2Alive = true;
        }
      }
    }
    return team1Alive === false || team2Alive === false;
  }

  private nextTurn(): void {
    if (this.checkGameFinished()) {
      this.connection?.send(`${NetworkProtocol.GAME_FINISHED}`);
    } else {
      this.connection?.send(`${NetworkProtocol.READY_NEXT_TURN}`);
    }
  }

  private addSoldierMessage(info: string[]): void {
    const playerID = parseInt(info[1], 10);
    const player = this.getPlayer(playerID);
    if (player !== null) {
      player.numSoldiers += 1;
      this.ui.preGameUpdatePlayer(player);
    }
    this.sendRoomStatus();
  }

  private removeSoldierMessage(info: string[]): void {
    const playerID = parseInt(info[1], 10);
    const player = this.getPlayer(playerID);
    if (player !== null) {
      player.numSoldiers -= 1;
      this.ui.preGameUpdatePlayer(player);
    }
    this.sendRoomStatus();
  }

  private removePlayerMessage(info: string[]): void {
    const playerID = parseInt(info[1], 10);
    const player = this.getPlayer(playerID);
    if (player === null) return;

    this.ui.preGameRemovePlayer(player);
    this.ui.chatPregame(null, `${player.name} has left the game.`);

    if (this.gameState === Constants.GAME) {
      if (
        this.players[this.currentTurn].playerID === player.playerID &&
        !this.drawingFunction
      ) {
        this.nextTurn();
      }
      for (let i = 0; i < player.numSoldiers; i++) {
        if (player.soldiers[i].alive) {
          player.soldiers[i].alive = false;
          player.soldiers[i].setExploding(true);
        }
      }
      player.disconnected = true;
      this.ui.chatGame(null, `${player.name} has left the game.`);
    } else {
      this.players = this.players.filter((p) => p !== player);
      this.sendRoomStatus();
      if (this.checkHaveLocals() === false) {
        this.disconnectKick();
      }
    }
  }

  private checkHaveLocals(): boolean {
    for (const player of this.players) {
      if (player.localPlayer) return true;
    }
    return false;
  }

  private setSideMessage(info: string[]): void {
    const team = parseInt(info[1], 10);
    const playerID = parseInt(info[2], 10);
    const player = this.getPlayer(playerID);
    if (player !== null) {
      player.team = team;
      this.ui.preGameUpdatePlayer(player);
    }
    this.sendRoomStatus();
  }

  private addPlayerMessage(info: string[]): void {
    const playerID = parseInt(info[1], 10);
    const name = javaUrlDecode(info[2]);
    const team = parseInt(info[3], 10);
    const local = parseInt(info[4], 10) !== 0;
    const numSoldiers = parseInt(info[5], 10);
    const ready = parseInt(info[6], 10) !== 0;

    let player: Player;
    if (local && this.nextPCs.length > 0) {
      const level = this.nextPCs.shift()!;
      player = new ComputerPlayer(name, playerID, team, local, numSoldiers, ready, level, this);
    } else {
      player = new Player(name, playerID, team, local, numSoldiers);
      player.ready = ready;
    }
    this.players.push(player);

    if (player instanceof ComputerPlayer) {
      this.computerPlayers.push(player);
    }

    this.ui.preGameAddPlayer(player);
    this.ui.chatPregame(null, `${player.name} has joined the game.`);
    this.sendRoomStatus();
  }

  private addChatMessage(info: string[]): void {
    const playerID = parseInt(info[1], 10);
    const chatMessage = javaUrlDecode(info[2]);
    const player = this.getPlayer(playerID);
    if (this.gameState === Constants.PRE_GAME) {
      this.ui.chatPregame(player, chatMessage);
    } else if (this.gameState === Constants.GAME) {
      this.ui.chatGame(player, chatMessage);
    }
  }

  private handleCommands(msg: string): void {
    if (msg.startsWith("-")) {
      if (msg.toLowerCase() === "-sayfunc") {
        this.sayFunc = true;
      } else if (msg.toLowerCase() === "-stopsayfunc") {
        this.sayFunc = false;
      } else if (msg.toLowerCase() === "-shownext") {
        this.ui.gameSetNextMarker(true);
      } else if (msg.toLowerCase() === "-stopshownext") {
        this.ui.gameSetNextMarker(false);
      }
    }
  }

  private setModeMessage(info: string[]): void {
    const mode = parseInt(info[1], 10);
    this.gameMode = mode;
    this.ui.preGameSetMode(mode);
    this.sendRoomStatus();
  }

  private setReadyMessage(info: string[]): void {
    const playerID = parseInt(info[1], 10);
    const ready = parseInt(info[2], 10) !== 0;
    const player = this.getPlayer(playerID);
    if (player === null) return;

    player.ready = ready;
    if (this.gameState === Constants.PRE_GAME) {
      this.ui.preGameRepaint();
    }
    if (player.localPlayer) {
      this.updateReadyButton();
    }
    if (ready === false && this.countingDown && this.gameState === Constants.PRE_GAME) {
      this.stopCountdown();
      this.displaySystemMessage("Game start cancelled.");
    }
    this.sendRoomStatus();
  }

  private updateReadyButton(): void {
    let readyOn = true;
    for (const player of this.players) {
      if (player.localPlayer && player.ready === false) {
        readyOn = false;
        break;
      }
    }
    this.ui.preGameSetReadyButtonOn(readyOn);
  }

  private stopComputers(): void {
    for (const cp of this.computerPlayers) {
      cp.stopThinkFunction();
    }
  }

  private startGameMessage(info: string[]): void {
    this.hideRoom();
    this.stopComputers();
    this.gameState = Constants.GAME;
    this.drawingFunction = false;
    this.exploding = false;

    const numCircles = parseInt(info[1], 10);
    const circleInfo: CircleInfo[] = [];
    for (let i = 0; i < numCircles; i++) {
      circleInfo.push({
        x: parseInt(info[2 + 3 * i], 10),
        y: parseInt(info[3 + 3 * i], 10),
        radius: parseInt(info[4 + 3 * i], 10),
      });
    }
    this.obstacle = new Obstacle(numCircles, circleInfo);

    let i = 3 * numCircles + 2;
    for (const player of this.players) {
      for (let s = 0; s < player.numSoldiers; s++) {
        const x = parseInt(info[i], 10);
        const y = parseInt(info[i + 1], 10);
        i += 2;
        player.startSoldier(s, x, y);
      }
      player.restartTurn();
    }

    let startPlayer = Math.abs(parseInt(info[i], 10));
    startPlayer = startPlayer % this.players.length;
    this.currentTurn = startPlayer;
    this.timeTurnStarted = Date.now();

    const currentPlayer = this.players[this.currentTurn];
    if (currentPlayer.localPlayer) {
      if (currentPlayer instanceof ComputerPlayer) {
        currentPlayer.thinkFunction();
      } else {
        this.lastLocalHumanPlayer = currentPlayer;
      }
    }

    this.ui.gameRefreshFunction();
    this.ui.gameRefreshSoldiers();
    this.ui.gameRefreshBack();
    this.ui.enterGameScreen();
  }

  private nextTurnMessage(): void {
    if (this.checkGameFinished()) {
      this.connection?.send(`${NetworkProtocol.GAME_FINISHED}`);
    }

    const numPlayers = this.players.length;
    for (let i = 0; i < numPlayers; i++) {
      this.currentTurn = (this.currentTurn + 1) % numPlayers;
      if (this.players[this.currentTurn].nextTurn()) {
        break;
      }
    }

    const currentPlayer = this.players[this.currentTurn];
    if (currentPlayer.localPlayer) {
      if (currentPlayer instanceof ComputerPlayer) {
        currentPlayer.thinkFunction();
      } else {
        this.lastLocalHumanPlayer = currentPlayer;
      }
    }

    this.timeTurnStarted = Date.now();
    this.turnTimeUp = false;
    this.drawingFunction = false;
    this.exploding = false;
    this.nextTurnSent = false;

    this.ui.gameRepaintAngle();
    this.ui.gameRefreshFunction();
    this.ui.gameRefreshBack();
  }

  private fireFunctionMessage(info: string[]): void {
    if (info.length === 3 && !this.drawingFunction) {
      const playerID = parseInt(info[1], 10);
      const functionString = javaUrlDecode(info[2]);
      if (this.players[this.currentTurn].playerID === playerID) {
        const player = this.getPlayer(playerID);
        if (player === null) return;
        this.processFunction(player, functionString);
        this.drawingFunction = true;
        this.timeStartedDrawingFunction = Date.now();
        this.ui.gameStartDrawingFunction();
        if (this.sayFunc) {
          this.ui.chatGame(player, functionString);
        }
      }
    }
  }

  private updateFunctionMessage(info: string[]): void {
    if (info.length === 3 && !this.drawingFunction) {
      const playerID = parseInt(info[1], 10);
      const functionString = javaUrlDecode(info[2]);
      const player = this.getPlayer(playerID);
      if (
        player !== null &&
        this.players[this.currentTurn].playerID === playerID &&
        !player.localPlayer
      ) {
        this.ui.gameUpdateFunction(functionString);
      }
    }
  }

  private setLeaderMessage(): void {
    this.leader = true;
    this.ui.preGameRefreshBoard();
    this.ui.chatPregame(null, "You are now the room leader.");
  }

  private setLeaderInfoMessage(info: string[]): void {
    this.leaderPlayerID = parseInt(info[1], 10);
    const local = this.getFirstLocalPlayer();
    this.leader = local !== null && local.playerID === this.leaderPlayerID;
    if (this.gameState === Constants.PRE_GAME) {
      this.ui.preGameRefreshBoard();
    }
    if (this.onLeaderChanged !== null) {
      this.onLeaderChanged();
    }
  }

  canStartGame(): boolean {
    if (!this.leader) return false;
    if (this.players.length < 2) return false;
    const teams = new Set(this.players.map((p) => p.team));
    if (teams.size < 2) return false;
    return this.players.every((p) => p.localPlayer || p.ready);
  }

  private startCountdownMessage(): void {
    if (!this.countingDown) {
      this.stopCountdown();
      this.countingDown = true;
      this.ui.preGameSetCountdownActive(true);
      let secondsLeft = Math.floor(Constants.START_GAME_DELAY / 1000);
      const tick = () => {
        if (!this.countingDown) return;
        if (secondsLeft > 0) {
          this.displaySystemMessage(`Game starting in ${secondsLeft}...`);
          secondsLeft--;
          this.countdownTimer = setTimeout(tick, 1000);
        } else {
          this.countingDown = false;
          this.ui.preGameSetCountdownActive(false);
        }
      };
      tick();
    }
  }

  private stopCountdown(): void {
    this.countingDown = false;
    this.ui.preGameSetCountdownActive(false);
    if (this.countdownTimer !== null) {
      clearTimeout(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  displaySystemMessage(message: string): void {
    this.ui.chatPregame(null, message);
  }

  private reorderMessage(info: string[]): void {
    const newPlayers: Player[] = [];
    for (let i = 1; i < info.length; i++) {
      const p = this.getPlayer(parseInt(info[i], 10));
      if (p !== null) newPlayers.push(p);
    }
    this.players = newPlayers;
  }

  private finishGameMessage(): void {
    this.gameState = Constants.PRE_GAME;
    this.drawingFunction = false;
    this.exploding = false;
    this.nextTurnSent = false;
    this.stopComputers();
    this.ui.gameStopPanel();

    for (const player of this.players) {
      for (let i = 0; i < player.soldiers.length; i++) {
        if (player.soldiers[i].alive) {
          this.ui.chatPregame(null, `${player.name} won the game.`);
          break;
        }
      }
    }

    this.removeDisconnectedPlayers();
    this.updateReadyButton();
    this.recreateRoom();
    this.ui.enterPregameScreen();
  }

  private removeDisconnectedPlayers(): void {
    this.players = this.players.filter((p) => !p.disconnected);
  }

  private setAngleMessage(info: string[]): void {
    const playerID = parseInt(info[1], 10);
    const soldierIndex = parseInt(info[2], 10);
    const angle = parseFloat(info[3]);
    const player = this.getPlayer(playerID);
    if (player !== null && !player.localPlayer) {
      player.soldiers[soldierIndex].angle = angle;
      this.ui.gameRepaintAngle();
    }
  }

  handleMessage(message: string): void {
    const info = message.split("&");
    try {
      const type = parseInt(info[0], 10);
      switch (type) {
        case NetworkProtocol.NO_INFO:
          break;
        case NetworkProtocol.ADD_PLAYER:
          this.addPlayerMessage(info);
          break;
        case NetworkProtocol.SET_TEAM:
          this.setSideMessage(info);
          break;
        case NetworkProtocol.REMOVE_PLAYER:
          this.removePlayerMessage(info);
          break;
        case NetworkProtocol.ADD_SOLDIER:
          this.addSoldierMessage(info);
          break;
        case NetworkProtocol.REMOVE_SOLDIER:
          this.removeSoldierMessage(info);
          break;
        case NetworkProtocol.CHAT_MSG:
          this.addChatMessage(info);
          break;
        case NetworkProtocol.SET_MODE:
          this.setModeMessage(info);
          break;
        case NetworkProtocol.SET_READY:
          this.setReadyMessage(info);
          break;
        case NetworkProtocol.START_GAME:
          this.startGameMessage(info);
          break;
        case NetworkProtocol.NEXT_TURN:
          this.nextTurnMessage();
          break;
        case NetworkProtocol.FIRE_FUNC:
          this.fireFunctionMessage(info);
          break;
        case NetworkProtocol.GAME_FINISHED:
          this.finishGameMessage();
          break;
        case NetworkProtocol.SET_ANGLE:
          this.setAngleMessage(info);
          break;
        case NetworkProtocol.NEW_LEADER:
          this.setLeaderMessage();
          break;
        case NetworkProtocol.SET_LEADER:
          this.setLeaderInfoMessage(info);
          break;
        case NetworkProtocol.KICKED:
          this.kicked = true;
          this.kickFromGame();
          break;
        case NetworkProtocol.START_COUNTDOWN:
          this.startCountdownMessage();
          break;
        case NetworkProtocol.CANCEL_START:
          if (this.countingDown) {
            this.stopCountdown();
            this.displaySystemMessage("Game start cancelled.");
          }
          break;
        case NetworkProtocol.REORDER:
          this.reorderMessage(info);
          break;
        case NetworkProtocol.FUNCTION_PREVIEW:
          this.updateFunctionMessage(info);
          break;
        case NetworkProtocol.GAME_FULL:
        case NetworkProtocol.DISCONNECT:
          this.connection?.close();
          this.kickFromGame();
          break;
        case NetworkProtocol.KEY_DENIED:
          this.ui.globalShowDisconnectMessage("Wrong room key.");
          this.stopGame();
          break;
      }
    } catch (e) {
      console.error("Invalid message received: " + message, e);
    }
  }

  private invalidMessage(message: string): void {
    console.error("Invalid message received: " + message);
  }

  kickFromGame(): void {
    const wasPreGame = this.gameState === Constants.PRE_GAME;
    const wasGame = this.gameState === Constants.GAME;
    const msg = this.kicked ? "You have been kicked from the room." : "You have been disconnected.";
    this.ui.chatPregame(null, msg);
    this.gameState = Constants.NONE;
    this.connection = null;
    this.drawingFunction = false;
    this.exploding = false;
    this.nextTurnSent = false;
    this.leader = false;
    this.leaderPlayerID = -1;
    if (wasPreGame) {
      this.ui.preGameShowMessage(msg);
    } else if (wasGame) {
      this.ui.gameStopPanel();
      this.ui.gameShowMessage(msg);
    }
  }

  stopGame(): void {
    this.gameState = Constants.NONE;
    this.connection = null;
    this.drawingFunction = false;
    this.exploding = false;
    this.nextTurnSent = false;
    this.leader = false;
    this.leaderPlayerID = -1;
    this.stopComputers();
    this.ui.preGameRestartScreen();
    if (this.onGameStop !== null) {
      this.onGameStop();
    }
  }

  disconnectKick(): void {
    this.connection?.send(`${NetworkProtocol.DISCONNECT}`);
    this.connection?.close();
    this.connection = null;
    this.kickFromGame();
  }

  hideRoom(): void {
    if (this.onHideRoom !== null) {
      this.onHideRoom();
    }
  }

  recreateRoom(): void {
    if (this.onRecreateRoom !== null) {
      this.onRecreateRoom();
    }
  }

  sendRoomStatus(): void {
    if (this.onRoomStatus !== null) {
      this.onRoomStatus();
    }
  }

  /** Hooks the UI/global client uses. */
  onHideRoom: (() => void) | null = null;
  onRecreateRoom: (() => void) | null = null;
  onRoomStatus: (() => void) | null = null;
  onLeaderChanged: (() => void) | null = null;

  updateDrawingStuff(): void {
    if (this.drawingFunction) {
      this.getCurrentFunctionPosition();
    }
    if (this.exploding) {
      this.getTimeExploding();
    }
    this.getRemainingTime();
  }

  getCurrentFunctionPosition(): number {
    if (this.exploding) {
      return this.simResult!.numSteps;
    }

    let numDrawSteps =
      Math.floor(((Date.now() - this.timeStartedDrawingFunction) * Constants.FUNCTION_VELOCITY) / 1000);

    if (numDrawSteps > this.simResult!.numSteps && this.drawingFunction) {
      numDrawSteps = this.simResult!.numSteps;

      this.exploding = true;
      this.timeStartedExploding = Date.now();

      if (this.obstacle !== null) {
        if (this.isFunctionReversed()) {
          this.obstacle.setExplosion(
            Constants.PLANE_LENGTH - Math.floor(this.simResult!.lastX),
            Math.floor(this.simResult!.lastY),
            Constants.EXPLOSION_RADIUS
          );
        } else {
          this.obstacle.setExplosion(
            Math.floor(this.simResult!.lastX),
            Math.floor(this.simResult!.lastY),
            Constants.EXPLOSION_RADIUS
          );
        }
        this.obstacle.explodePoint();
      }
    }

    for (const soldier of this.soldiersHit) {
      if (soldier.alive) {
        if (soldier.exploding) {
          if (soldier.getTimeExploding() > Constants.SOLDIER_MAX_DEATH_TIME) {
            soldier.setExploding(false);
          }
        } else if (numDrawSteps > soldier.killPosition) {
          soldier.setExploding(true);
          soldier.alive = false;
        }
      }
    }

    return numDrawSteps;
  }

  getTimeExploding(): number {
    const time = Date.now() - this.timeStartedExploding;
    if (time > Constants.NEXT_TURN_DELAY) {
      if (this.exploding && !this.nextTurnSent) {
        this.nextTurn();
        this.nextTurnSent = true;
      }
    }
    return time;
  }

  private processFunction(player: Player, functionString: string): void {
    this.function = new FunctionSim(functionString);
    player.getCurrentTurnSoldier().function_ = functionString;

    const simPlayers = toSimPlayers(this.players);
    const inverted = player.team === Constants.TEAM2;
    this.simResult = this.simulate(this.function, this.obstacle!, simPlayers, inverted);

    this.soldiersHit = [];
    for (const hit of this.simResult.hits) {
      const soldier = this.players[hit.player].soldiers[hit.soldier];
      soldier.killPosition = hit.position;
      this.soldiersHit.push(soldier);
    }

    player.getCurrentTurnSoldier().angle = this.simResult.fireAngle;
    this.ui.gameRepaintAngle();
  }

  private simulate(
    func: FunctionSim,
    obstacle: Obstacle,
    simPlayers: PlayerSim[],
    inverted: boolean
  ): SimResult {
    switch (this.gameMode) {
      case Constants.NORMAL_FUNC:
        return func.processFunctionRange(obstacle, simPlayers, simPlayers.length, this.currentTurn, inverted);
      case Constants.FST_ODE:
        return func.processRK4Range(obstacle, simPlayers, simPlayers.length, this.currentTurn, inverted);
      case Constants.SND_ODE:
        return func.processRK42Range(
          obstacle,
          simPlayers,
          simPlayers.length,
          this.currentTurn,
          this.players[this.currentTurn].getCurrentTurnSoldier().angle,
          inverted
        );
      default:
        throw new Error("unknown game mode");
    }
  }
}

/** Client-side AI. Port of Graphwar/ComputerPlayer. */
export class ComputerPlayer extends Player {
  private numGenerations: number;
  private numFunctions: number;
  private bestFunction: EvolvableFunction[];
  private functions: EvolvableFunction[][];
  private over9000: boolean;
  private myTurn = false;
  private processingFunction = false;
  private gameData: GameData;
  private generationTimer: ReturnType<typeof setTimeout> | null = null;
  private bestAngle = 0;

  constructor(
    name: string,
    playerID: number,
    team: number,
    localPlayer: boolean,
    numSoldiers: number,
    ready: boolean,
    level: number,
    gameData: GameData
  ) {
    super(name, playerID, team, localPlayer, numSoldiers);
    this.ready = ready;
    this.gameData = gameData;
    this.numGenerations = level;
    this.over9000 = level > 9000;
    this.numFunctions = Constants.NUM_FUNCTIONS_AI;

    this.bestFunction = [];
    for (let i = 0; i < Constants.MAX_SOLDIERS_PER_PLAYER; i++) {
      const ef = new EvolvableFunction();
      ef.function = makeRandomTokens(Constants.NORMAL_FUNC);
      ef.angle = Math.PI * Math.random() - Math.PI / 2;
      this.bestFunction.push(ef);
    }

    this.functions = [];
    for (let i = 0; i < Constants.MAX_SOLDIERS_PER_PLAYER; i++) {
      const row: EvolvableFunction[] = [];
      for (let j = 0; j < this.numFunctions; j++) {
        const ef = new EvolvableFunction();
        ef.function = makeRandomTokens(Constants.NORMAL_FUNC);
        ef.angle = Math.PI * Math.random() - Math.PI / 2;
        row.push(ef);
      }
      this.functions.push(row);
    }
  }

  getAngle(): number {
    return this.bestAngle;
  }

  thinkFunction(): void {
    if (this.over9000) {
      this.myTurn = true;
    }
    if (!this.processingFunction) {
      this.processingFunction = true;
      this.scheduleGeneration();
    }
  }

  stopThinkFunction(): void {
    this.myTurn = false;
    this.processingFunction = false;
    if (this.generationTimer !== null) {
      clearTimeout(this.generationTimer);
      this.generationTimer = null;
    }
  }

  private scheduleGeneration(): void {
    this.generationTimer = setTimeout(() => this.runGeneration(), 0);
  }

  private runGeneration(): void {
    this.generationTimer = null;
    const gd = this.gameData;
    const gameMode = gd.gameMode;

    const generationLoopCondition = (k: number): boolean =>
      this.processingFunction &&
      gd.gameState === Constants.GAME &&
      (k < this.numGenerations && gd.getRemainingTime() > 5000) ||
      this.over9000;

    let functions = this.functions[this.getCurrentTurnSoldierIndex()];
    let totalPoints = 0;

    for (let k = 0; generationLoopCondition(k); k++) {
      if (gd.getCurrentTurnPlayer() === this) {
        functions = this.functions[this.currentTurnSoldier];
      } else {
        const nextTurnSoldier = this.getCurrentTurnSoldierIndex();
        if (nextTurnSoldier === -1) {
          this.processingFunction = false;
          return;
        }
        functions = this.functions[nextTurnSoldier];
      }

      const newFunctions: EvolvableFunction[] = [];
      totalPoints = this.getTotalPoints(functions);

      for (let i = 0; i < Constants.NUM_FUNCTIONS_UNCHANGED_TURN_AI; i++) {
        newFunctions[i] = functions[i];
      }

      for (
        let i = Constants.NUM_FUNCTIONS_UNCHANGED_TURN_AI;
        i < Constants.NUM_FUNCTIONS_UNCHANGED_TURN_AI + Constants.NUM_FUNCTION_MUTATED_AI;
        i++
      ) {
        const nef = new EvolvableFunction();
        const funcToMutate = this.getFunctionToReproduce(functions, totalPoints);
        nef.function = mutateFunction(functions[funcToMutate].function, gameMode);
        nef.angle = functions[funcToMutate].angle;
        newFunctions[i] = nef;

        if (gameMode === Constants.SND_ODE) {
          if (Math.random() < 0.5) {
            if (Math.random() < 0.5) {
              functions[i].angle = Math.PI * Math.random() - Math.PI / 2;
            } else {
              functions[i].angle = functions[i].angle + (functions[i].angle * (Math.random() - 0.5)) / 5;
            }
          }
        }
      }

      for (let i = Constants.NUM_FUNCTIONS_UNCHANGED_TURN_AI + Constants.NUM_FUNCTION_MUTATED_AI; i < this.numFunctions; i++) {
        const nef = new EvolvableFunction();
        const cross1 = this.getFunctionToReproduce(functions, totalPoints);
        const cross2 = this.getFunctionToReproduce(functions, totalPoints);
        nef.function = crossoverFunctions(functions[cross1].function, functions[cross2].function, gameMode);

        if (Math.random() < 0.5) {
          nef.angle = functions[cross1].angle;
        } else {
          nef.angle = functions[cross2].angle;
        }
        newFunctions[i] = nef;

        if (gameMode === Constants.SND_ODE) {
          if (Math.random() < 0.5) {
            if (Math.random() < 0.5) {
              functions[i].angle = Math.PI * Math.random() - Math.PI / 2;
            } else {
              functions[i].angle = functions[i].angle + (functions[i].angle * (Math.random() - 0.5)) / 5;
            }
          }
        }
      }

      const oldFunctions = this.functions[this.currentTurnSoldier];
      this.functions[this.currentTurnSoldier] = newFunctions;
      functions = newFunctions;

      let shouldBreak = false;
      for (let i = 0; i < this.numFunctions; i++) {
        const points = this.evaluateFunction(functions[i].function, functions[i].angle);
        functions[i].points = points;

        if (gd.getRemainingTime() < 3000 && !this.over9000) {
          functions = oldFunctions;
          this.functions[this.currentTurnSoldier] = oldFunctions;
          shouldBreak = true;
          break;
        }
      }
      if (shouldBreak) break;

      functions.sort((a, b) => b.points - a.points);

      if (this.over9000) {
        if (this.myTurn && gd.getRemainingTime() < 5000) {
          this.bestFunction[this.currentTurnSoldier] = functions[0];
          this.sendFunction();
          this.myTurn = false;
        }
      }
    }

    if (this.processingFunction) {
      if (!this.over9000) {
        this.bestFunction[this.currentTurnSoldier] = functions[0];
        this.sendFunction();
      }
    }
    this.processingFunction = false;
  }

  private evaluateFunction(ft: FunctionTokenLike, angle: number): number {
    const func = new FunctionSim(ft);
    const gd = this.gameData;
    const players = gd.players;
    const numPlayers = players.length;

    const inverted = this.team === Constants.TEAM2;

    const simPlayers = toSimPlayers(players);
    let result: SimResult;
    switch (gd.gameMode) {
      case Constants.NORMAL_FUNC:
        result = func.processFunctionRange(gd.obstacle!, simPlayers, numPlayers, gd.currentTurn, inverted);
        break;
      case Constants.FST_ODE:
        result = func.processRK4Range(gd.obstacle!, simPlayers, numPlayers, gd.currentTurn, inverted);
        break;
      case Constants.SND_ODE:
        result = func.processRK42Range(gd.obstacle!, simPlayers, numPlayers, gd.currentTurn, angle, inverted);
        break;
      default:
        return 0;
    }

    let minDistSquared = 1000000;
    let totalPoints = 0;

    for (let i = 0; i < numPlayers; i++) {
      for (let j = 0; j < players[i].numSoldiers; j++) {
        if (players[i].soldiers[j].alive) {
          let hit = false;
          for (const h of result.hits) {
            if (h.player === i && h.soldier === j) {
              if (players[i].team !== this.team) {
                totalPoints += 2000000;
              } else {
                totalPoints -= 2000000;
              }
              hit = true;
              break;
            }
          }
          if (hit) continue;

          if (players[i].team !== this.team) {
            let soldierMinDist = Number.MAX_VALUE;
            for (let k = 0; k < result.numSteps; k++) {
              const distY =
                (-Constants.PLANE_LENGTH * result.valuesY[k]) / Constants.PLANE_GAME_LENGTH +
                Constants.PLANE_HEIGHT / 2 -
                players[i].soldiers[j].y;

              let distX: number;
              if (this.team === Constants.TEAM2) {
                distX =
                  Constants.PLANE_LENGTH -
                  ((Constants.PLANE_LENGTH * result.valuesX[k]) / Constants.PLANE_GAME_LENGTH +
                    Constants.PLANE_LENGTH / 2) -
                  players[i].soldiers[j].x;
                if (distX < 0) continue;
              } else {
                distX =
                  (Constants.PLANE_LENGTH * result.valuesX[k]) / Constants.PLANE_GAME_LENGTH +
                  Constants.PLANE_LENGTH / 2 -
                  players[i].soldiers[j].x;
                if (distX > 0) continue;
              }

              const tempDistSquared = Math.pow(distX, 2) + Math.pow(distY, 2);
              if (tempDistSquared < soldierMinDist) {
                soldierMinDist = tempDistSquared;
              }
            }
            if (soldierMinDist < minDistSquared) {
              minDistSquared = soldierMinDist;
            }
          }
        }
      }
    }

    totalPoints += 1000000 - minDistSquared;
    return totalPoints;
  }

  private getFunctionToReproduce(functions: EvolvableFunction[], totalPoints: number): number {
    const randomPoints = totalPoints * Math.random();
    for (let i = 0; i < functions.length; i++) {
      if (totalPoints > randomPoints) {
        totalPoints -= functions[i].points;
      } else {
        return i;
      }
    }
    return 0;
  }

  private getTotalPoints(functions: EvolvableFunction[]): number {
    let totalPoints = 0;
    for (const f of functions) {
      totalPoints += f.points;
    }
    return totalPoints;
  }

  private sendFunction(): void {
    const bf = this.bestFunction[this.currentTurnSoldier];
    const functionString = getStringFunction(simplifyFunction(bf.function));
    this.bestAngle = bf.angle;
    this.gameData.setAngle(this.bestAngle);
    this.gameData.sendFunction(functionString);
  }
}

type FunctionTokenLike = ReturnType<typeof makeRandomTokens>;

class EvolvableFunction {
  function: FunctionTokenLike;
  angle: number;
  points: number;
  constructor() {
    this.function = makeRandomTokens(Constants.NORMAL_FUNC);
    this.angle = 0;
    this.points = 0;
  }
}