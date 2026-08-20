import { Constants, toScreenX, toScreenY } from "@graphwar/math";
import { Obstacle } from "@graphwar/math";
import type { Player, Soldier } from "../models.js";
import type { GameData } from "../gameData.js";
import {
  getSoldierSprite,
  getExplosionSprite,
  getCurrentMarkerSprite,
  getNextTeamSprite,
  getSpriteSize,
} from "./sprites.js";

/**
 * Canvas renderer for the game world (770x450 plane). Port of GraphPlane,
 * including the rsc sprite assets (tinted soldiers, death/explosion/current
 * marker animations) and the white-background / black-obstacle terrain.
 */
export class GraphPlane {
  canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private terrainCanvas: HTMLCanvasElement;
  private wasExploding = false;
  private nextMarker = false;

  constructor(width = Constants.WIDTH, height = Constants.PLANE_HEIGHT + 150) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.canvas.getContext("2d");
    if (ctx === null) throw new Error("no 2d context");
    this.ctx = ctx;
    this.terrainCanvas = document.createElement("canvas");
    this.terrainCanvas.width = Constants.PLANE_LENGTH;
    this.terrainCanvas.height = Constants.PLANE_HEIGHT;
  }

  setNextMarker(on: boolean): void {
    this.nextMarker = on;
  }

  setTerrain(obstacle: Obstacle): void {
    const tctx = this.terrainCanvas.getContext("2d");
    if (tctx === null) return;
    const img = tctx.createImageData(Constants.PLANE_LENGTH, Constants.PLANE_HEIGHT);
    img.data.set(obstacle.rgba);
    tctx.putImageData(img, 0, 0);

    // Java drawBackground(): black crosshair lines at mid.
    tctx.strokeStyle = "#000";
    tctx.lineWidth = 1;
    tctx.beginPath();
    tctx.moveTo(Constants.PLANE_LENGTH / 2, 0);
    tctx.lineTo(Constants.PLANE_LENGTH / 2, Constants.PLANE_HEIGHT);
    tctx.stroke();
    tctx.beginPath();
    tctx.moveTo(0, Constants.PLANE_HEIGHT / 2);
    tctx.lineTo(Constants.PLANE_LENGTH, Constants.PLANE_HEIGHT / 2);
    tctx.stroke();
  }

  render(gd: GameData): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const reversed = gd.isTerrainReversed();

    // Terrain must re-bake when an explosion erases it.
    if (gd.exploding && !this.wasExploding) {
      this.setTerrain(gd.obstacle!);
    }
    this.wasExploding = gd.exploding;
    if (reversed) {
      ctx.save();
      ctx.translate(Constants.PLANE_LENGTH, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(this.terrainCanvas, 0, 0);
      ctx.restore();
    } else {
      ctx.drawImage(this.terrainCanvas, 0, 0);
    }

    this.drawPlayersNames(gd, reversed);
    if (gd.gameState === Constants.GAME) {
      this.drawCurrentMarker(gd, reversed);
      if (this.nextMarker) {
        this.drawNextPlayersMarkers(gd, reversed);
      }
    }
    this.drawSoldiers(gd, reversed);
    this.drawFunction(gd, reversed);
    this.drawExplosion(gd, reversed);
  }

  private planeX(x: number, reversed: boolean): number {
    return reversed ? Constants.PLANE_LENGTH - x : x;
  }

  private funcXorTerrain(gd: GameData, reversed: boolean): boolean {
    return (gd.isFunctionReversed() || reversed) && !(gd.isFunctionReversed() && reversed);
  }

  private drawFunction(gd: GameData, reversed: boolean): void {
    if (gd.function === null || gd.simResult === null) return;
    if (!gd.drawingFunction && !gd.exploding) return;

    const ctx = this.ctx;
    const result = gd.simResult;
    const fadeTime = gd.exploding
      ? Date.now() - gd.timeStartedExploding
      : Date.now() - gd.timeStartedDrawingFunction;

    const alpha = gd.drawingFunction ? 1 : Math.max(0, 1 - fadeTime / Constants.FUNC_FADE_TIME);
    if (alpha <= 0) return;

    const numDrawSteps = gd.getCurrentFunctionPosition();
    const flip = this.funcXorTerrain(gd, reversed);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = gd.players[gd.currentTurn].color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < numDrawSteps; i++) {
      const x = this.planeX(toScreenX(result.valuesX[i]), flip);
      const y = toScreenY(result.valuesY[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawNextPlayersMarkers(gd: GameData, reversed: boolean): void {
    const img = getNextTeamSprite();
    if (img === null) return;
    const size = getSpriteSize(img);
    for (const player of gd.players) {
      if (gd.getCurrentTurnPlayer() === player) continue;
      const soldier = player.getNextTurnSoldier();
      if (soldier === null) continue;
      const x = this.planeX(soldier.x, reversed);
      const y = soldier.y;
      this.ctx.drawImage(img, x - size.width / 2, y - size.height / 2);
    }
  }

  private drawExplosion(gd: GameData, reversed: boolean): void {
    if (!gd.exploding || gd.simResult === null) return;
    const ctx = this.ctx;
    const result = gd.simResult;
    const x = this.planeX(result.lastX, this.funcXorTerrain(gd, reversed));
    const y = result.lastY;

    const time = gd.getTimeExploding();
    const img = getExplosionSprite(time);
    if (img === null) return;
    const size = getSpriteSize(img);
    ctx.drawImage(img, x - size.width / 2, y - size.height / 2);
  }

  private drawSoldiers(gd: GameData, reversed: boolean): void {
    let playerIndex = 0;
    for (const player of gd.players) {
      for (const soldier of player.soldiers) {
        if (!soldier.alive && !soldier.exploding) continue;
        this.drawSoldier(player, soldier, playerIndex, reversed);
      }
      playerIndex++;
    }
  }

  private drawSoldier(player: Player, soldier: Soldier, playerIndex: number, reversed: boolean): void {
    const ctx = this.ctx;
    const x = this.planeX(soldier.x, reversed);
    const y = soldier.y;

    const sprite = getSoldierSprite(player.color, soldier);
    if (sprite !== null) {
      ctx.save();
      ctx.globalAlpha = sprite.alpha;
      ctx.translate(x, y);
      const mirror =
        (player.team === Constants.TEAM2 || reversed) && !(player.team === Constants.TEAM2 && reversed);
      if (mirror) ctx.scale(-1, 1);
      const size = getSpriteSize(sprite.image);
      ctx.drawImage(sprite.image, -size.width / 2, -size.height / 2);
      ctx.restore();
      return;
    }

    // Fallback while sprites are not loaded (headless tests / first frames).
    ctx.beginPath();
    ctx.arc(x, y, Constants.SOLDIER_RADIUS + 2, 0, Math.PI * 2);
    ctx.fillStyle = player.color;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#000";
    ctx.stroke();
  }

  private drawCurrentMarker(gd: GameData, reversed: boolean): void {
    if (gd.currentTurn < 0 || gd.currentTurn >= gd.players.length) return;
    const player = gd.players[gd.currentTurn];
    const soldier = player.getCurrentTurnSoldier();
    if (!soldier.alive) return;

    const img = getCurrentMarkerSprite(Date.now() % 1850);
    if (img === null) return;
    const size = getSpriteSize(img);
    const x = this.planeX(soldier.x, reversed);
    const y = soldier.y;
    this.ctx.drawImage(img, x - size.width / 2, y - size.height / 2);
  }

  private drawPlayersNames(gd: GameData, reversed: boolean): void {
    const ctx = this.ctx;
    for (const player of gd.players) {
      for (const soldier of player.soldiers) {
        if (!soldier.alive && !soldier.exploding) continue;
        const x = this.planeX(soldier.x, reversed);
        let alpha = 1;
        if (soldier.exploding) {
          alpha = Math.max(0, 1 - soldier.getTimeExploding() / Constants.NAME_FADE_TIME);
        }
        this.paintPlayerName(player, x, soldier.y, alpha);
      }
    }
  }

  private paintPlayerName(player: Player, x: number, y: number, alpha: number): void {
    const ctx = this.ctx;
    const border = 3;
    ctx.font = "14px sans-serif";
    const nameLength = ctx.measureText(player.name).width;

    let borderX = x - nameLength / 2 - border;
    let borderY = y - 15 - 2 * Constants.SOLDIER_RADIUS;
    let textX = x - nameLength / 2;
    let textY = y - 2 - 2 * Constants.SOLDIER_RADIUS;

    if (borderY < 0) {
      borderY = y - 2 + 2 * Constants.SOLDIER_RADIUS;
      textY = y + 11 + 2 * Constants.SOLDIER_RADIUS;
    }
    if (borderX < 0) {
      textX = textX - borderX;
      borderX = 0;
    }
    if (borderX + nameLength + 2 * border > Constants.PLANE_LENGTH) {
      textX = textX - borderX + Constants.PLANE_LENGTH - nameLength - 2 * border;
      borderX = Constants.PLANE_LENGTH - nameLength - 2 * border;
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "rgba(255,255,255,0.67)";
    this.roundRect(ctx, borderX, borderY, nameLength + 2 * border, 15, 7);
    ctx.fill();
    ctx.strokeStyle = player.color;
    this.roundRect(ctx, borderX, borderY, nameLength + 2 * border, 15, 7);
    ctx.stroke();
    ctx.fillStyle = "#000";
    ctx.fillText(player.name, textX, textY);
    ctx.restore();
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number
  ): void {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arc(x + width - r, y + r, r, -Math.PI / 2, 0);
    ctx.arc(x + width - r, y + height - r, r, 0, Math.PI / 2);
    ctx.arc(x + r, y + height - r, r, Math.PI / 2, Math.PI);
    ctx.arc(x + r, y + r, r, Math.PI, (Math.PI * 3) / 2);
  }
}