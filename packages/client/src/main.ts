import { Constants, gaussian } from "@graphwar/math";
import { GameData, ComputerPlayer } from "./gameData.js";
import { GlobalClient, WsSocket, SocketFactory, SocketEvents, SocketLike } from "./network.js";
import { GraphUI } from "./ui/screens.js";
import "./styles/main.css";

const wsFactory: SocketFactory = {
  connect(url: string, events: SocketEvents): SocketLike {
    return new WsSocket(url, events);
  },
};

function randomComputerLevel(): number {
  let level = Math.trunc(gaussian() * Constants.COMPUTER_LEVEL_STANDARD_DEVIATION + Constants.COMPUTER_LEVEL_MEAN_VALUE);
  if (level < Constants.COMPUTER_LEVEL_MIN_VALUE) level = Constants.COMPUTER_LEVEL_MIN_VALUE;
  return level;
}

function start(): void {
  const app = document.getElementById("app");
  if (app === null) throw new Error("no #app element");

  let localName = "Player";
  const getName = (): string => {
    const stored = localStorage.getItem("graphwar.name");
    if (stored !== null && stored.length > 0) return stored;
    return localName;
  };
  const setName = (n: string): void => {
    localName = n;
    localStorage.setItem("graphwar.name", n);
  };

  const gameData = new GameData(null, wsFactory);
  const globalClient = new GlobalClient(
    wsFactory,
    () => gameData.gameMode,
    () => gameData.players.length
  );
  const ui = new GraphUI(app, gameData, globalClient);
  ui.setGlobalName(getName());
  gameData.setUI(ui);

  // wire state machine <-> global client hooks
  gameData.onHideRoom = () => globalClient.hideRoom();
  gameData.onRecreateRoom = () => globalClient.recreateRoom();
  gameData.onRoomStatus = () => globalClient.sendRoomStatus();

  // render loop
  const renderLoop = (): void => {
    ui.renderGame();
    requestAnimationFrame(renderLoop);
  };
  requestAnimationFrame(renderLoop);

  // ---- lobby actions (the lobby is the start screen) ----
  ui.onGlobalNameChange = (name) => {
    if (name.length > 0) {
      setName(name);
      globalClient.sendName(name);
    }
  };

  ui.onJoinGlobal = () => {
    if (gameData.gameState !== Constants.NONE) {
      gameData.disconnect();
    }
    const name = ui.getMenuName();
    if (name.length > 0) setName(name);
    if (!globalClient.running) {
      globalClient.joinGlobalServer(location.hostname, Constants.GLOBAL_PORT, getName());
    }
    ui.setScreen(Constants.GLOBAL_ROOM_SCREEN);
  };

  ui.onCreateRoomGlobal = (name, key) => {
    globalClient.createRoom(name, key);
  };

  ui.onJoinRoom = async (room) => {
    let key = "";
    if (room.private) {
      const entered = await ui.prompt("Enter room key", "");
      if (entered === null || entered.length === 0) return;
      key = entered;
    }
    gameData.connect(room.roomID, key);
    gameData.addPlayer(getName());
    ui.setScreen(Constants.PRE_GAME_SCREEN);
  };

  globalClient.onRoomCreated = (roomID) => {
    gameData.connect(roomID, globalClient.roomKey);
    gameData.addPlayer(getName());
    ui.setScreen(Constants.PRE_GAME_SCREEN);
  };

  globalClient.onPlayersChanged = () => ui.globalRefreshPlayers();
  globalClient.onRoomsChanged = () => ui.globalRefreshRooms();
  globalClient.onChat = (name, message) => {
    ui.chatGlobal(name, message);
  };
  globalClient.onRoomInvalid = () => {
    ui.globalShowDisconnectMessage("Room limit reached. Could not create room.");
  };
  globalClient.onDisconnect = (kicked) => {
    if (kicked) {
      ui.showGlobalMessage("You have been disconnected.");
    }
    ui.setScreen(Constants.GLOBAL_ROOM_SCREEN);
  };

  // start at the main menu; joining the lobby happens on Play
  ui.setScreen(Constants.MAIN_MENU_SCREEN);

  // ---- pre-game actions ----
  const localPlayersReady = (): boolean => {
    for (const p of gameData.players) {
      if (p.localPlayer && !p.ready) return false;
    }
    return true;
  };

  ui.onAddComputerPlayer = async () => {
    const nameDefault = computerName();
    const levelDefault = String(randomComputerLevel());
    const vals = await ui.promptFields(
      "Computer player",
      [
        { label: "Name", value: nameDefault, id: "modalInput" },
        { label: "Level", value: levelDefault, id: "modalLevel" },
      ],
      "modalInput"
    );
    if (vals === null) return;
    const name = vals[0].trim();
    if (name.length === 0) return;
    if (name.length > 20) {
      ui.preGameShowMessage("Name must be at most 20 characters.");
      return;
    }
    const levelText = vals[1].trim();
    let level: number;
    if (levelText.toLowerCase() === "over 9000") {
      level = 9001;
    } else {
      const parsed = Number(levelText);
      if (levelText.length === 0 || !Number.isInteger(parsed) || parsed < 0) {
        ui.preGameShowMessage("Invalid computer level. Use a number 0-9000 or 'Over 9000'.");
        return;
      }
      level = parsed > 9000 ? 9001 : parsed;
    }
    gameData.addPC(name, level);
  };

  ui.onSwitchSide = (playerID) => {
    const player = gameData.getPlayer(playerID);
    if (player !== null) gameData.switchSide(player);
  };

  ui.onAddSoldier = (playerID) => {
    const player = gameData.getPlayer(playerID);
    if (player !== null) gameData.addSoldier(player);
  };

  ui.onRemoveSoldier = (playerID) => {
    const player = gameData.getPlayer(playerID);
    if (player !== null) gameData.removeSoldier(player);
  };

  ui.onRemovePlayer = (playerID) => {
    const player = gameData.getPlayer(playerID);
    if (player !== null) gameData.removePlayer(player);
  };

  ui.onSetReady = () => {
    const targetReady = !localPlayersReady();
    for (const p of gameData.players) {
      if (p.localPlayer) {
        gameData.setReady(p, targetReady);
      }
    }
    ui.preGameSetReadyButtonOn(targetReady);
  };

  ui.onStartGame = () => {
    if (gameData.canStartGame()) {
      gameData.sendStartGame();
      return;
    }
    const numPlayers = gameData.players.length;
    if (numPlayers < 2) {
      ui.preGameShowMessage("You need at least 2 players to start.");
      return;
    }
    const teams = new Set(gameData.players.map((p) => p.team));
    if (teams.size < 2) {
      ui.preGameShowMessage("Players are on the same team. Switch a player's team before starting.");
      return;
    }
    ui.preGameShowMessage("All players must be ready to start.");
  };

  ui.onCancelStart = () => {
    gameData.sendCancelStart();
  };

  ui.onKick = (playerID) => {
    gameData.sendKick(playerID);
  };

  ui.onTransferLeader = (playerID) => {
    gameData.sendTransferLeader(playerID);
  };

  ui.onNextMode = () => {
    gameData.nextMode();
  };

  ui.onSendChatPregame = (msg) => {
    gameData.sendChatMessage(msg);
  };

  ui.onSendChatGame = (msg) => {
    gameData.sendChatMessage(msg);
  };

  ui.onSendChatGlobal = (msg) => {
    globalClient.sendChatMessage(msg);
  };

  const closeRoomIfEmpty = (): void => {
    const hasRemote = gameData.players.some((p) => !p.localPlayer);
    if (gameData.gameState !== Constants.NONE) {
      gameData.disconnect();
    }
    if (globalClient.roomCreated && !hasRemote) {
      globalClient.closeRoom();
    }
    ui.setScreen(Constants.GLOBAL_ROOM_SCREEN);
  };

  ui.onBackGlobal = () => {
    closeRoomIfEmpty();
  };

  // ---- game actions ----
  const currentTurnIsComputer = (): boolean => {
    if (gameData.gameState !== Constants.GAME) return false;
    return gameData.getCurrentTurnPlayer() instanceof ComputerPlayer;
  };

  ui.onFireFunction = (func) => {
    if (currentTurnIsComputer()) return;
    gameData.sendFunction(func);
  };

  ui.onPreviewFunction = (func) => {
    if (currentTurnIsComputer()) return;
    gameData.sendFunctionPreview(func);
  };

  ui.onAngleUpDown = (up, down) => {
    if (up) gameData.angleUp();
    if (down) gameData.angleDown();
  };

  ui.onStopAngle = () => {
    gameData.stopAngle();
  };

  ui.onQuit = async () => {
    const yes = await ui.confirm("Quit the game?");
    if (!yes) return;
    closeRoomIfEmpty();
  };

  ui.onGameMessageOk = () => {
    ui.setScreen(Constants.GLOBAL_ROOM_SCREEN);
  };

  gameData.onLeaderChanged = () => {
    ui.preGameRefreshBoard();
  };

  gameData.onGameStop = () => {
    ui.setScreen(Constants.GLOBAL_ROOM_SCREEN);
  };
}

function computerName(): string {
  const names = Constants.computerNames;
  return names[Math.floor(Math.random() * names.length)];
}

window.addEventListener("DOMContentLoaded", start);