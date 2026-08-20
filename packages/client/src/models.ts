import { Constants, PlayerSim } from "@graphwar/math";

/** Minimal snapshot the math FunctionSim needs. */
export function toSimPlayers(players: Player[]): PlayerSim[] {
  return players.map((p) => ({
    soldiers: p.soldiers,
    numSoldiers: p.numSoldiers,
    currentTurnSoldierIndex: p.currentTurnSoldier,
  }));
}

function randomColor(): string {
  let r = 0;
  let g = 0;
  let b = 0;
  do {
    r = Math.floor(Math.random() * 256);
    g = Math.floor(Math.random() * 256);
    b = Math.floor(Math.random() * 256);
  } while (r * r + g * g + b * b > Constants.MAXIMUM_COLOR_MODULE_SQUARED);
  return `rgb(${r},${g},${b})`;
}

export class Soldier {
  x: number;
  y: number;
  angle = 0;
  alive = false;
  exploding = false;
  timeExplodingStarted = 0;
  killPosition = 0;
  function_ = "";
  private animating = false;
  private animationNum = 0;
  private timeAnimationStarted = 0;
  private nextAnimation = 0;

  constructor(x?: number, y?: number) {
    this.x = x ?? 0;
    this.y = y ?? 0;
    if (x !== undefined && y !== undefined) {
      this.alive = true;
    }
  }

  setExploding(exploding: boolean): void {
    this.exploding = exploding;
    if (exploding) {
      this.timeExplodingStarted = Date.now();
    }
  }

  getTimeExploding(): number {
    return Date.now() - this.timeExplodingStarted;
  }

  isAnimating(): boolean {
    if (this.animating) return true;
    if (Date.now() > this.nextAnimation) {
      this.animating = true;
      this.timeAnimationStarted = Date.now();
      this.animationNum = Math.floor(Math.random() * 2147483647);
      return true;
    }
    return false;
  }

  getAnimationNum(): number {
    return this.animationNum;
  }

  getAnimationTime(): number {
    return Date.now() - this.timeAnimationStarted;
  }

  endAnimation(): void {
    this.animating = false;
    this.nextAnimation = Math.round(
      Date.now() +
        Math.abs(gaussian() * Constants.SOLDIER_ANIMATION_DELAY_STANDARD_DEVIATION +
          Constants.SOLDIER_ANIMATION_MEAN_VALUE)
    );
  }
}

function gaussian(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export class Player {
  name: string;
  team: number;
  numSoldiers: number;
  soldiers: Soldier[];
  currentTurnSoldier = 0;
  playerID: number;
  localPlayer: boolean;
  color: string;
  ready = false;
  disconnected = false;

  constructor(
    name: string,
    playerID: number,
    team: number,
    localPlayer: boolean,
    numSoldiers: number
  ) {
    this.name = name;
    this.team = team;
    this.numSoldiers = numSoldiers;
    this.soldiers = [];
    for (let i = 0; i < Constants.MAX_SOLDIERS_PER_PLAYER; i++) {
      this.soldiers.push(new Soldier());
    }
    this.playerID = playerID;
    this.localPlayer = localPlayer;
    this.color = randomColor();
  }

  startSoldier(soldierNum: number, x: number, y: number): void {
    this.soldiers[soldierNum] = new Soldier(x, y);
  }

  getCurrentTurnSoldierIndex(): number {
    return this.currentTurnSoldier;
  }

  getCurrentTurnSoldier(): Soldier {
    return this.soldiers[this.currentTurnSoldier];
  }

  restartTurn(): void {
    this.currentTurnSoldier = 0;
  }

  getNextTurnSoldier(): Soldier | null {
    let nextSoldier = this.currentTurnSoldier;
    for (let i = 0; i < this.numSoldiers; i++) {
      nextSoldier = (nextSoldier + 1) % this.numSoldiers;
      if (this.soldiers[nextSoldier].alive) {
        return this.soldiers[nextSoldier];
      }
    }
    return null;
  }

  nextTurn(): boolean {
    for (let i = 0; i < this.numSoldiers; i++) {
      this.currentTurnSoldier = (this.currentTurnSoldier + 1) % this.numSoldiers;
      if (this.soldiers[this.currentTurnSoldier].alive) {
        return true;
      }
    }
    return false;
  }
}

export class LobbyPlayerEntry {
  name: string;
  playerID: number;
  constructor(name: string, playerID: number) {
    this.name = name;
    this.playerID = playerID;
  }
}

export class RoomEntry {
  name: string;
  roomID: number;
  ip: string;
  port: number;
  mode: number;
  numPlayers: number;
  constructor(name: string, roomID: number, ip: string, port: number, mode: number, numPlayers: number) {
    this.name = name;
    this.roomID = roomID;
    this.ip = ip;
    this.port = port;
    this.mode = mode;
    this.numPlayers = numPlayers;
  }
}

export const MODE_NAMES: Record<number, string> = {
  [Constants.NORMAL_FUNC]: "Normal",
  [Constants.FST_ODE]: "1st ODE",
  [Constants.SND_ODE]: "2nd ODE",
};