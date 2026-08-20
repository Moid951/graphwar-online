import { Constants } from "./constants.js";
import { gaussian } from "./tokens.js";
import { intCast } from "./util.js";

export interface CircleInfo {
  x: number;
  y: number;
  radius: number;
}

function circleCoverage(dist: number, radius: number): number {
  const v = radius - dist + 0.7;
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

/**
 * Deterministic terrain bitmap, faithful to the Java Obstacle:
 * white background, black circles, collision = any pixel that is not pure white,
 * explosion erases a white disc. Antialiased circle edges are approximated with a
 * 1px analytic coverage falloff so every client (browser or node) builds the
 * identical bitmap from the same parameters.
 */
export class Obstacle {
  readonly width: number;
  readonly height: number;
  /** 1 = walkable (pure white), 0 = solid/black */
  whiteMap: Uint8Array;
  /** RGBA display buffer matching whiteMap */
  rgba: Uint8ClampedArray;
  numCircles: number;
  circleInfo: CircleInfo[];

  expX: number;
  expY: number;
  expRadius: number;

  constructor(numCircles: number, circleInfo: CircleInfo[]) {
    this.width = Constants.PLANE_LENGTH;
    this.height = Constants.PLANE_HEIGHT;
    this.numCircles = numCircles;
    this.circleInfo = circleInfo;
    this.whiteMap = new Uint8Array(this.width * this.height);
    this.rgba = new Uint8ClampedArray(this.width * this.height * 4);
    this.expX = 0;
    this.expY = 0;
    this.expRadius = 0;
    this.clearAll();
    for (const c of circleInfo) {
      this.fillCircle(c.x, c.y, c.radius, false);
    }
  }

  static getNumCircles(): number {
    let numCircles = intCast(
      gaussian() * Constants.NUM_CIRCLES_STANDARD_DEVIATION + Constants.NUM_CIRCLES_MEAN_VALUE
    );
    while (numCircles < 0) {
      numCircles = intCast(
        gaussian() * Constants.NUM_CIRCLES_STANDARD_DEVIATION + Constants.NUM_CIRCLES_MEAN_VALUE
      );
    }
    return numCircles;
  }

  static generateCircles(numCircles: number): CircleInfo[] {
    const circles: CircleInfo[] = [];
    for (let i = 0; i < numCircles; i++) {
      const x = Math.floor(Math.random() * Constants.PLANE_LENGTH);
      const y = Math.floor(Math.random() * Constants.PLANE_HEIGHT);
      let r = intCast(
        gaussian() * Constants.CIRCLE_STANDARD_DEVIATION + Constants.CIRCLE_MEAN_RADIUS
      );
      while (r < 0) {
        r = intCast(
          gaussian() * Constants.CIRCLE_STANDARD_DEVIATION + Constants.CIRCLE_MEAN_RADIUS
        );
      }
      circles.push({ x, y, radius: r });
    }
    return circles;
  }

  static generateAll(): { numCircles: number; circleInfo: CircleInfo[] } {
    const numCircles = Obstacle.getNumCircles();
    return { numCircles, circleInfo: Obstacle.generateCircles(numCircles) };
  }

  private clearAll(): void {
    this.whiteMap.fill(1);
    for (let i = 0; i < this.rgba.length; i += 4) {
      this.rgba[i] = 255;
      this.rgba[i + 1] = 255;
      this.rgba[i + 2] = 255;
      this.rgba[i + 3] = 255;
    }
  }

  private paintPixel(x: number, y: number, coverage: number): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const idx = y * this.width + x;
    if (coverage <= 0) {
      this.whiteMap[idx] = 1;
    } else {
      this.whiteMap[idx] = 0;
    }
    const rgbaIdx = idx * 4;
    const v = Math.round(255 * (1 - coverage));
    this.rgba[rgbaIdx] = v;
    this.rgba[rgbaIdx + 1] = v;
    this.rgba[rgbaIdx + 2] = v;
    this.rgba[rgbaIdx + 3] = 255;
  }

  /**
   * Explosion erasure: the white disc removes obstacles. Fully covered pixels
   * become walkable white; the antialiased rim is a partial blend of the white
   * disc over the terrain underneath, so a rim over black stays a solid gray
   * (Java fills white over black with SRC_OVER, leaving a gray still-solid edge).
   */
  private erasePixel(x: number, y: number, coverage: number): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const idx = y * this.width + x;
    if (coverage >= 1) {
      this.whiteMap[idx] = 1;
      const rgbaIdx = idx * 4;
      this.rgba[rgbaIdx] = 255;
      this.rgba[rgbaIdx + 1] = 255;
      this.rgba[rgbaIdx + 2] = 255;
      this.rgba[rgbaIdx + 3] = 255;
    } else if (this.whiteMap[idx] !== 1) {
      const rgbaIdx = idx * 4;
      const v = Math.round(255 * coverage);
      this.rgba[rgbaIdx] = v;
      this.rgba[rgbaIdx + 1] = v;
      this.rgba[rgbaIdx + 2] = v;
      this.rgba[rgbaIdx + 3] = 255;
    }
  }

  /** fillOval(x-r, y-r, 2r, 2r). white = erase, black = draw */
  private fillCircle(cx: number, cy: number, radius: number, erase: boolean): void {
    const r = radius;
    const minX = cx - r - 1;
    const maxX = cx + r + 1;
    const minY = cy - r - 1;
    const maxY = cy + r + 1;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dist = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
        const coverage = circleCoverage(dist, r);
        if (coverage > 0) {
          if (erase) {
            this.erasePixel(x, y, coverage);
          } else {
            this.paintPixel(x, y, coverage);
          }
        }
      }
    }
  }

  collidePoint(x: number, y: number): boolean {
    if (x < 0 || x >= Constants.PLANE_LENGTH) return true;
    if (y < 0 || y >= Constants.PLANE_HEIGHT) return true;
    return this.whiteMap[y * this.width + x] !== 1;
  }

  soldierCollides(x: number, y: number, radius: number): boolean {
    if (x + radius >= Constants.PLANE_LENGTH) return true;
    if (x - radius < 0) return true;
    if (y + radius >= Constants.PLANE_HEIGHT) return true;
    if (y - radius < 0) return true;

    if (this.whiteMap[y * this.width + x] === 1) {
      if (this.whiteMap[y * this.width + x + radius] === 1) {
        if (this.whiteMap[y * this.width + x - radius] === 1) {
          if (this.whiteMap[(y + radius) * this.width + x] === 1) {
            if (this.whiteMap[(y - radius) * this.width + x] === 1) {
              return false;
            }
          }
        }
      }
    }
    return true;
  }

  setExplosion(x: number, y: number, radius: number): void {
    this.expX = x;
    this.expY = y;
    this.expRadius = radius;
  }

  explodePoint(): void {
    this.fillCircle(this.expX, this.expY, this.expRadius, true);
  }
}