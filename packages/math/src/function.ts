import { Constants } from "./constants.js";
import {
  FunctionToken,
  getNumParam,
  makeToken,
  parseFunctionString,
  evaluateTokens,
  TokenType,
  clonePolishFunction,
  makeRandomTokens,
  mutateFunction,
  crossoverFunctions,
  getStringFunction,
  simplifyFunction,
} from "./tokens.js";
import { Obstacle } from "./obstacle.js";
import { intCast } from "./util.js";

export interface SoldierSim {
  x: number;
  y: number;
  alive: boolean;
}

export interface PlayerSim {
  soldiers: SoldierSim[];
  numSoldiers: number;
  currentTurnSoldierIndex: number;
}

export interface HitRecord {
  player: number;
  soldier: number;
  position: number;
}

export interface SimResult {
  valuesX: Float64Array;
  valuesY: Float64Array;
  valuesDY: Float64Array | null;
  numSteps: number;
  lastX: number;
  lastY: number;
  fireAngle: number;
  hits: HitRecord[];
}

export class FunctionSim {
  tokens: FunctionToken[];

  constructor(strOrTokens: string | FunctionToken[]) {
    if (typeof strOrTokens === "string") {
      this.tokens = parseFunctionString(strOrTokens);
    } else {
      this.tokens = strOrTokens;
    }
  }

  evaluate(x: number, y: number, dy: number): number {
    return evaluateTokens(this.tokens, x, y, dy);
  }

  getStringFunc(): string {
    return getStringFunction(this.tokens);
  }

  getStartAngle(x: number, radius: number): number {
    let angle = 0;
    let startAngleTangent =
      (this.evaluate(x + Constants.STEP_SIZE, 0, 0) - this.evaluate(x, 0, 0)) /
      Constants.STEP_SIZE;
    angle = Math.atan(startAngleTangent);

    let finalX: number;
    let error = 10000;
    for (let i = 0; error > Constants.ANGLE_ERROR && i < Constants.MAX_ANGLE_LOOPS; i++) {
      finalX = x + radius * Math.cos(angle);
      startAngleTangent =
        (this.evaluate(finalX + Constants.STEP_SIZE, 0, 0) - this.evaluate(finalX, 0, 0)) /
        Constants.STEP_SIZE;
      const newAngle = Math.atan(startAngleTangent);
      error = Math.abs(newAngle - angle);
      angle = newAngle;
    }
    return angle;
  }

  private getRK4StartAngle(x: number, y: number, radius: number): number {
    let angle = 0;
    let startAngleTangent: number;
    let finalX: number;
    let finalY: number;
    let error = 10000;
    for (let i = 0; error > Constants.ANGLE_ERROR && i < Constants.MAX_ANGLE_LOOPS; i++) {
      finalX = x + radius * Math.cos(angle);
      finalY = y + radius * Math.sin(angle);

      const tempStepSize = Constants.STEP_SIZE;

      const k1 = this.evaluate(finalX, finalY, 0);
      const k2 = this.evaluate(finalX + 0.5 * tempStepSize, finalY + 0.5 * tempStepSize * k1, 0);
      const k3 = this.evaluate(finalX + 0.5 * tempStepSize, finalY + 0.5 * tempStepSize * k2, 0);
      const k4 = this.evaluate(finalX + tempStepSize, finalY + tempStepSize * k3, 0);

      const nextY = finalY + (tempStepSize / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
      const nextX = finalX + tempStepSize;

      startAngleTangent = (nextY - finalY) / (nextX - finalX);
      const newAngle = Math.atan(startAngleTangent);
      error = Math.abs(newAngle - angle);
      angle = newAngle;
    }
    return angle;
  }

  private playerAlreadyHit(playersHit: number[], soldiersHit: number[], numPlayersHit: number, player: number, soldier: number): boolean {
    for (let i = 0; i < numPlayersHit; i++) {
      if (playersHit[i] === player && soldiersHit[i] === soldier) return true;
    }
    return false;
  }

  private toScreenX(gameX: number): number {
    return (
      (Constants.PLANE_LENGTH * gameX) / Constants.PLANE_GAME_LENGTH + Constants.PLANE_LENGTH / 2
    );
  }

  private toScreenY(gameY: number): number {
    return (
      (-Constants.PLANE_LENGTH * gameY) / Constants.PLANE_GAME_LENGTH + Constants.PLANE_HEIGHT / 2
    );
  }

  /** Mirrors Function.processFunctionRange (game mode NORMAL_FUNC). */
  processFunctionRange(
    obstacle: Obstacle,
    players: PlayerSim[],
    numPlayers: number,
    currentTurn: number,
    inverted: boolean
  ): SimResult {
    const maxHits = numPlayers * Constants.MAX_SOLDIERS_PER_PLAYER;
    const playersHit = new Array<number>(maxHits);
    const soldiersHit = new Array<number>(maxHits);
    const soldierHitPosition = new Array<number>(maxHits);
    let numPlayersHit = 0;

    const valuesX = new Float64Array(Constants.FUNC_MAX_STEPS);
    const valuesY = new Float64Array(Constants.FUNC_MAX_STEPS);

    const currentTurnSoldier = players[currentTurn].soldiers[players[currentTurn].currentTurnSoldierIndex];

    valuesX[0] = currentTurnSoldier.x;
    valuesY[0] = currentTurnSoldier.y;

    if (inverted) {
      valuesX[0] = Constants.PLANE_LENGTH - valuesX[0];
    }

    valuesX[0] = (Constants.PLANE_GAME_LENGTH * (valuesX[0] - Constants.PLANE_LENGTH / 2)) / Constants.PLANE_LENGTH;
    valuesY[0] = (Constants.PLANE_GAME_LENGTH * (-valuesY[0] + Constants.PLANE_HEIGHT / 2)) / Constants.PLANE_LENGTH;

    const gameCoordinateRadius =
      (Constants.PLANE_GAME_LENGTH * Constants.SOLDIER_RADIUS) / Constants.PLANE_LENGTH;

    const fireAngle = this.getStartAngle(valuesX[0], gameCoordinateRadius);

    if (Number.isNaN(fireAngle) === false && Number.isFinite(fireAngle)) {
      valuesX[0] = valuesX[0] + gameCoordinateRadius * Math.cos(fireAngle);
      valuesY[0] = valuesY[0] + gameCoordinateRadius * Math.sin(fireAngle);
    }

    const offSet = -this.evaluate(valuesX[0], 0, 0) + valuesY[0];

    let stepSize = Constants.STEP_SIZE;
    let tempStepSize = Constants.STEP_SIZE;

    let numSteps: number = Constants.FUNC_MAX_STEPS;
    for (let i = 1; i < Constants.FUNC_MAX_STEPS; i++) {
      tempStepSize = stepSize;

      valuesX[i] = valuesX[i - 1] + tempStepSize;
      valuesY[i] = this.evaluate(valuesX[i], 0, 0) + offSet;

      let endFunc = false;

      for (
        let j = 0;
        Math.pow(valuesX[i] - valuesX[i - 1], 2) + Math.pow(valuesY[i] - valuesY[i - 1], 2) >
        Constants.FUNC_MAX_STEP_DISTANCE_SQUARED;
        j++
      ) {
        if (valuesX[i] - valuesX[i - 1] > Constants.FUNC_MIN_X_STEP_DISTANCE) {
          tempStepSize = tempStepSize / 2;
          valuesX[i] = valuesX[i - 1] + tempStepSize;
          valuesY[i] = this.evaluate(valuesX[i], 0, 0) + offSet;
        } else {
          endFunc = true;
          break;
        }
      }

      if (endFunc) {
        numSteps = i;
        break;
      }

      let x = this.toScreenX(valuesX[i]);
      let y = this.toScreenY(valuesY[i]);

      if (inverted) {
        x = Constants.PLANE_LENGTH - x;
      }

      for (let j = 0; j < numPlayers; j++) {
        for (let k = 0; k < players[j].numSoldiers; k++) {
          if (j === currentTurn && k === players[j].currentTurnSoldierIndex) {
            continue;
          }
          if (players[j].soldiers[k].alive) {
            const distX = players[j].soldiers[k].x - x;
            const distY = players[j].soldiers[k].y - y;
            const distSquared = Math.pow(distX, 2) + Math.pow(distY, 2);
            if (distSquared < Constants.SOLDIER_RADIUS * Constants.SOLDIER_RADIUS) {
              if (this.playerAlreadyHit(playersHit, soldiersHit, numPlayersHit, j, k) === false) {
                playersHit[numPlayersHit] = j;
                soldiersHit[numPlayersHit] = k;
                soldierHitPosition[numPlayersHit] = i;
                numPlayersHit++;
              }
            }
          }
        }
      }

      if (obstacle.collidePoint(intCast(x), intCast(y))) {
        numSteps = i;
        break;
      }

      if (Number.isNaN(y) || !Number.isFinite(y)) {
        numSteps = i;
        break;
      }
    }

    const lastX = this.toScreenX(valuesX[numSteps - 1]);
    const lastY = this.toScreenY(valuesY[numSteps - 1]);

    const hits: HitRecord[] = [];
    for (let i = 0; i < numPlayersHit; i++) {
      hits.push({ player: playersHit[i], soldier: soldiersHit[i], position: soldierHitPosition[i] });
    }

    return { valuesX, valuesY, valuesDY: null, numSteps, lastX, lastY, fireAngle, hits };
  }

  /** Mirrors Function.processRK4Range (game mode FST_ODE). */
  processRK4Range(
    obstacle: Obstacle,
    players: PlayerSim[],
    numPlayers: number,
    currentTurn: number,
    inverted: boolean
  ): SimResult {
    const maxHits = numPlayers * Constants.MAX_SOLDIERS_PER_PLAYER;
    const playersHit = new Array<number>(maxHits);
    const soldiersHit = new Array<number>(maxHits);
    const soldierHitPosition = new Array<number>(maxHits);
    let numPlayersHit = 0;

    const valuesX = new Float64Array(Constants.FUNC_MAX_STEPS);
    const valuesY = new Float64Array(Constants.FUNC_MAX_STEPS);

    let stepSize = Constants.STEP_SIZE;

    const currentTurnSoldier = players[currentTurn].soldiers[players[currentTurn].currentTurnSoldierIndex];

    valuesX[0] = currentTurnSoldier.x;
    valuesY[0] = currentTurnSoldier.y;

    if (inverted) {
      valuesX[0] = Constants.PLANE_LENGTH - valuesX[0];
    }

    valuesX[0] = (Constants.PLANE_GAME_LENGTH * (valuesX[0] - Constants.PLANE_LENGTH / 2)) / Constants.PLANE_LENGTH;
    valuesY[0] = (Constants.PLANE_GAME_LENGTH * (-valuesY[0] + Constants.PLANE_HEIGHT / 2)) / Constants.PLANE_LENGTH;

    const gameCoordinateRadius =
      (Constants.PLANE_GAME_LENGTH * Constants.SOLDIER_RADIUS) / Constants.PLANE_LENGTH;

    const fireAngle = this.getRK4StartAngle(valuesX[0], valuesY[0], gameCoordinateRadius);

    valuesX[0] = valuesX[0] + gameCoordinateRadius * Math.cos(fireAngle);
    valuesY[0] = valuesY[0] + gameCoordinateRadius * Math.sin(fireAngle);

    let numSteps: number = Constants.FUNC_MAX_STEPS;
    for (let i = 1; i < Constants.FUNC_MAX_STEPS; i++) {
      let tempStepSize = stepSize;

      let k1 = this.evaluate(valuesX[i - 1], valuesY[i - 1], 0);
      let k2 = this.evaluate(valuesX[i - 1] + 0.5 * tempStepSize, valuesY[i - 1] + 0.5 * tempStepSize * k1, 0);
      let k3 = this.evaluate(valuesX[i - 1] + 0.5 * tempStepSize, valuesY[i - 1] + 0.5 * tempStepSize * k2, 0);
      let k4 = this.evaluate(valuesX[i - 1] + tempStepSize, valuesY[i - 1] + tempStepSize * k3, 0);

      valuesY[i] = valuesY[i - 1] + (tempStepSize / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
      valuesX[i] = valuesX[i - 1] + tempStepSize;

      let endFunc = false;

      for (
        let j = 0;
        Math.pow(valuesX[i] - valuesX[i - 1], 2) + Math.pow(valuesY[i] - valuesY[i - 1], 2) >
          Constants.FUNC_MAX_STEP_DISTANCE_SQUARED &&
        valuesX[i] - valuesX[i - 1] > Constants.FUNC_MIN_X_STEP_DISTANCE;
        j++
      ) {
        if (valuesX[i] - valuesX[i - 1] > Constants.FUNC_MIN_X_STEP_DISTANCE) {
          tempStepSize = tempStepSize / 2;

          k1 = this.evaluate(valuesX[i - 1], valuesY[i - 1], 0);
          k2 = this.evaluate(valuesX[i - 1] + 0.5 * tempStepSize, valuesY[i - 1] + 0.5 * tempStepSize * k1, 0);
          k3 = this.evaluate(valuesX[i - 1] + 0.5 * tempStepSize, valuesY[i - 1] + 0.5 * tempStepSize * k2, 0);
          k4 = this.evaluate(valuesX[i - 1] + tempStepSize, valuesY[i - 1] + tempStepSize * k3, 0);

          valuesY[i] = valuesY[i - 1] + (tempStepSize / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
          valuesX[i] = valuesX[i - 1] + tempStepSize;
        } else {
          endFunc = true;
          break;
        }
      }

      if (endFunc) {
        numSteps = i;
        break;
      }

      let x = this.toScreenX(valuesX[i]);
      let y = this.toScreenY(valuesY[i]);

      if (inverted) {
        x = Constants.PLANE_LENGTH - x;
      }

      for (let j = 0; j < numPlayers; j++) {
        for (let k = 0; k < players[j].numSoldiers; k++) {
          if (j === currentTurn && k === players[j].currentTurnSoldierIndex) {
            continue;
          }
          if (players[j].soldiers[k].alive) {
            const distX = players[j].soldiers[k].x - x;
            const distY = players[j].soldiers[k].y - y;
            const distSquared = Math.pow(distX, 2) + Math.pow(distY, 2);
            if (distSquared < Constants.SOLDIER_RADIUS * Constants.SOLDIER_RADIUS) {
              if (this.playerAlreadyHit(playersHit, soldiersHit, numPlayersHit, j, k) === false) {
                playersHit[numPlayersHit] = j;
                soldiersHit[numPlayersHit] = k;
                soldierHitPosition[numPlayersHit] = i;
                numPlayersHit++;
              }
            }
          }
        }
      }

      if (obstacle.collidePoint(intCast(x), intCast(y))) {
        numSteps = i;
        break;
      }

      if (Number.isNaN(y) || Number.isNaN(valuesY[i]) || !Number.isFinite(y) || !Number.isFinite(valuesY[i])) {
        numSteps = i;
        break;
      }
    }

    const lastX = this.toScreenX(valuesX[numSteps - 1]);
    const lastY = this.toScreenY(valuesY[numSteps - 1]);

    const hits: HitRecord[] = [];
    for (let i = 0; i < numPlayersHit; i++) {
      hits.push({ player: playersHit[i], soldier: soldiersHit[i], position: soldierHitPosition[i] });
    }

    return { valuesX, valuesY, valuesDY: null, numSteps, lastX, lastY, fireAngle, hits };
  }

  /** Mirrors Function.processRK42Range (game mode SND_ODE). */
  processRK42Range(
    obstacle: Obstacle,
    players: PlayerSim[],
    numPlayers: number,
    currentTurn: number,
    angle: number,
    inverted: boolean
  ): SimResult {
    const maxHits = numPlayers * Constants.MAX_SOLDIERS_PER_PLAYER;
    const playersHit = new Array<number>(maxHits);
    const soldiersHit = new Array<number>(maxHits);
    const soldierHitPosition = new Array<number>(maxHits);
    let numPlayersHit = 0;

    const valuesX = new Float64Array(Constants.FUNC_MAX_STEPS);
    const valuesY = new Float64Array(Constants.FUNC_MAX_STEPS);
    const valuesDY = new Float64Array(Constants.FUNC_MAX_STEPS);

    let stepSize = Constants.STEP_SIZE;

    const currentTurnSoldier = players[currentTurn].soldiers[players[currentTurn].currentTurnSoldierIndex];

    valuesX[0] = currentTurnSoldier.x;
    if (inverted) {
      valuesX[0] = Constants.PLANE_LENGTH - valuesX[0];
    }
    valuesX[0] = valuesX[0] + Constants.SOLDIER_RADIUS * Math.cos(angle);

    valuesY[0] = currentTurnSoldier.y;
    valuesY[0] = valuesY[0] - Constants.SOLDIER_RADIUS * Math.sin(angle);

    valuesX[0] = (Constants.PLANE_GAME_LENGTH * (valuesX[0] - Constants.PLANE_LENGTH / 2)) / Constants.PLANE_LENGTH;
    valuesY[0] = (Constants.PLANE_GAME_LENGTH * (-valuesY[0] + Constants.PLANE_HEIGHT / 2)) / Constants.PLANE_LENGTH;
    valuesDY[0] = Math.tan(angle);

    const fireAngle = angle;

    let numSteps: number = Constants.FUNC_MAX_STEPS;
    for (let i = 1; i < Constants.FUNC_MAX_STEPS; i++) {
      let tempStepSize = stepSize;

      let x1 = valuesX[i - 1];
      let y1 = valuesY[i - 1];
      let y2 = valuesDY[i - 1];

      let k11 = y2;
      let k12 = this.evaluate(x1, y1, y2);

      x1 = valuesX[i - 1] + tempStepSize / 2;
      y1 = valuesY[i - 1] + (tempStepSize / 2) * k11;
      y2 = valuesDY[i - 1] + (tempStepSize / 2) * k12;

      let k21 = y2;
      let k22 = this.evaluate(x1, y1, y2);

      y1 = valuesY[i - 1] + (tempStepSize / 2) * k21;
      y2 = valuesDY[i - 1] + (tempStepSize / 2) * k22;

      let k31 = y2;
      let k32 = this.evaluate(x1, y1, y2);

      x1 = valuesX[i - 1] + tempStepSize;
      y1 = valuesY[i - 1] + tempStepSize * k31;
      y2 = valuesDY[i - 1] + tempStepSize * k32;

      let k41 = y2;
      let k42 = this.evaluate(x1, y1, y2);

      valuesX[i] = valuesX[i - 1] + tempStepSize;
      valuesY[i] = valuesY[i - 1] + (tempStepSize / 6) * (k11 + 2 * k21 + 2 * k31 + k41);
      valuesDY[i] = valuesDY[i - 1] + (tempStepSize / 6) * (k12 + 2 * k22 + 2 * k32 + k42);

      let endFunc = false;

      for (
        let j = 0;
        Math.pow(valuesX[i] - valuesX[i - 1], 2) + Math.pow(valuesY[i] - valuesY[i - 1], 2) >
          Constants.FUNC_MAX_STEP_DISTANCE_SQUARED &&
        valuesX[i] - valuesX[i - 1] > Constants.FUNC_MIN_X_STEP_DISTANCE;
        j++
      ) {
        if (valuesX[i] - valuesX[i - 1] > Constants.FUNC_MIN_X_STEP_DISTANCE) {
          tempStepSize = tempStepSize / 2;

          x1 = valuesX[i - 1];
          y1 = valuesY[i - 1];
          y2 = valuesDY[i - 1];

          k11 = y2;
          k12 = this.evaluate(x1, y1, y2);

          x1 = valuesX[i - 1] + tempStepSize / 2;
          y1 = valuesY[i - 1] + (tempStepSize / 2) * k11;
          y2 = valuesDY[i - 1] + (tempStepSize / 2) * k12;

          k21 = y2;
          k22 = this.evaluate(x1, y1, y2);

          y1 = valuesY[i - 1] + (tempStepSize / 2) * k21;
          y2 = valuesDY[i - 1] + (tempStepSize / 2) * k22;

          k31 = y2;
          k32 = this.evaluate(x1, y1, y2);

          x1 = valuesX[i - 1] + tempStepSize;
          y1 = valuesY[i - 1] + tempStepSize * k31;
          y2 = valuesDY[i - 1] + tempStepSize * k32;

          k41 = y2;
          k42 = this.evaluate(x1, y1, y2);

          valuesX[i] = valuesX[i - 1] + tempStepSize;
          valuesY[i] = valuesY[i - 1] + (tempStepSize / 6) * (k11 + 2 * k21 + 2 * k31 + k41);
          valuesDY[i] = valuesDY[i - 1] + (tempStepSize / 6) * (k12 + 2 * k22 + 2 * k32 + k42);
        } else {
          endFunc = true;
          break;
        }
      }

      if (endFunc) {
        numSteps = i;
        break;
      }

      let x = this.toScreenX(valuesX[i]);
      let y = this.toScreenY(valuesY[i]);

      if (inverted) {
        x = Constants.PLANE_LENGTH - x;
      }

      for (let j = 0; j < numPlayers; j++) {
        for (let k = 0; k < players[j].numSoldiers; k++) {
          if (j === currentTurn && k === players[j].currentTurnSoldierIndex) {
            continue;
          }
          if (players[j].soldiers[k].alive) {
            const distX = players[j].soldiers[k].x - x;
            const distY = players[j].soldiers[k].y - y;
            const distSquared = Math.pow(distX, 2) + Math.pow(distY, 2);
            if (distSquared < Constants.SOLDIER_RADIUS * Constants.SOLDIER_RADIUS) {
              if (this.playerAlreadyHit(playersHit, soldiersHit, numPlayersHit, j, k) === false) {
                playersHit[numPlayersHit] = j;
                soldiersHit[numPlayersHit] = k;
                soldierHitPosition[numPlayersHit] = i;
                numPlayersHit++;
              }
            }
          }
        }
      }

      if (obstacle.collidePoint(intCast(x), intCast(y))) {
        numSteps = i;
        break;
      }

      if (Number.isNaN(y) || !Number.isFinite(y)) {
        numSteps = i;
        break;
      }
    }

    const lastX = this.toScreenX(valuesX[numSteps - 1]);
    const lastY = this.toScreenY(valuesY[numSteps - 1]);

    const hits: HitRecord[] = [];
    for (let i = 0; i < numPlayersHit; i++) {
      hits.push({ player: playersHit[i], soldier: soldiersHit[i], position: soldierHitPosition[i] });
    }

    return { valuesX, valuesY, valuesDY, numSteps, lastX, lastY, fireAngle, hits };
  }
}

export type { FunctionToken };

export {
  getNumParam,
  makeToken,
  TokenType,
  clonePolishFunction,
  makeRandomTokens,
  mutateFunction,
  crossoverFunctions,
  getStringFunction,
  simplifyFunction,
  evaluateTokens,
};