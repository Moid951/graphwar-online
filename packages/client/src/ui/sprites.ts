import type { Soldier } from "../models.js";

const TILE = 20;

interface SrcFrame {
  name: string;
  dur: number;
}

interface Frame {
  img: HTMLImageElement;
  dur: number;
}

const SOLDIERS_BASE = "rsc/soldiers/";
const EXPLOSIONS_BASE = "rsc/explosions/";

/** soldier.txt: 3 animations; frames + per-frame durations. */
const SOLDIER_ANIMS_SRC: SrcFrame[][] = [
  [
    { name: "soldier1", dur: 40 },
    { name: "soldier2", dur: 40 },
    { name: "soldier3", dur: 40 },
    { name: "soldier4", dur: 40 },
    { name: "soldier5", dur: 500 },
    { name: "soldier4", dur: 40 },
    { name: "soldier3", dur: 40 },
    { name: "soldier2", dur: 40 },
    { name: "soldier1", dur: 40 },
  ],
  [
    { name: "soldier8", dur: 100 },
    { name: "soldier9", dur: 800 },
    { name: "soldier8", dur: 100 },
  ],
  [
    { name: "soldier6", dur: 100 },
    { name: "soldier7", dur: 800 },
    { name: "soldier6", dur: 100 },
  ],
];

/** soldierDeath.txt: 5 frames + fade. */
const DEATH_SRC: SrcFrame[] = [
  { name: "soldierExplosion1Small", dur: 25 },
  { name: "soldierExplosion2Small", dur: 25 },
  { name: "soldierExplosion3Small", dur: 25 },
  { name: "soldierExplosion4Small", dur: 25 },
  { name: "soldierExplosion5Small", dur: 4000 },
];
const DEATH_FADE_TIME = 1000;

/** currentPlayerMarker.txt: 4 frames (all currentPlayer1.png). */
const CURRENT_SRC: SrcFrame[] = [
  { name: "currentPlayer1", dur: 50 },
  { name: "currentPlayer1", dur: 150 },
  { name: "currentPlayer1", dur: 50 },
  { name: "currentPlayer1", dur: 1600 },
];

/** explosion.txt: 7 frames. */
const EXPLOSION_SRC: SrcFrame[] = [
  { name: "explosion0", dur: 15 },
  { name: "explosion1", dur: 15 },
  { name: "explosion2", dur: 15 },
  { name: "explosion3", dur: 15 },
  { name: "explosion4", dur: 15 },
  { name: "explosion5", dur: 15 },
  { name: "blank", dur: 1000 },
];

function load(name: string, base: string): HTMLImageElement | null {
  if (typeof Image === "undefined") return null;
  const img = new Image();
  img.src = base + name + ".png";
  return img;
}

function buildFrames(src: SrcFrame[], base: string): Frame[] | null {
  const frames: Frame[] = [];
  for (const f of src) {
    const img = load(f.name, base);
    if (img === null) return null;
    frames.push({ img, dur: f.dur });
  }
  return frames;
}

interface Loaded {
  soldierNormal: HTMLImageElement;
  helmet: HTMLImageElement;
  helmetMask: HTMLImageElement;
  anims: Frame[][];
  deaths: Frame[];
  current: Frame[];
  explosion: Frame[];
  nextTeam: HTMLImageElement;
}

let pending: Loaded | null = null;
let pendingReady = false;

function loadAll(): Loaded | null {
  const soldierNormal = load("soldierNormal", SOLDIERS_BASE);
  const helmet = load("helmet", SOLDIERS_BASE);
  const helmetMask = load("helmetMask", SOLDIERS_BASE);
  if (soldierNormal === null || helmet === null || helmetMask === null) return null;

  const anims: Frame[][] = [];
  for (const anim of SOLDIER_ANIMS_SRC) {
    const frames = buildFrames(anim, SOLDIERS_BASE);
    if (frames === null) return null;
    anims.push(frames);
  }
  const deaths = buildFrames(DEATH_SRC, SOLDIERS_BASE);
  const current = buildFrames(CURRENT_SRC, SOLDIERS_BASE);
  const explosion = buildFrames(EXPLOSION_SRC, EXPLOSIONS_BASE);
  const nextTeam = load("nextTeam", SOLDIERS_BASE);
  if (deaths === null || current === null || explosion === null || nextTeam === null) return null;

  return { soldierNormal, helmet, helmetMask, anims, deaths, current, explosion, nextTeam };
}

function imageReady(img: HTMLImageElement): boolean {
  return img.complete && img.naturalWidth > 0;
}

function allLoaded(l: Loaded): boolean {
  if (!imageReady(l.soldierNormal) || !imageReady(l.helmet) || !imageReady(l.helmetMask)) {
    return false;
  }
  for (const anim of l.anims) {
    for (const f of anim) {
      if (!imageReady(f.img)) return false;
    }
  }
  for (const f of l.deaths) {
    if (!imageReady(f.img)) return false;
  }
  for (const f of l.current) {
    if (!imageReady(f.img)) return false;
  }
  for (const f of l.explosion) {
    if (!imageReady(f.img)) return false;
  }
  if (!imageReady(l.nextTeam)) return false;
  return true;
}

function getLoaded(): Loaded | null {
  if (pendingReady) return pending;
  if (pending === null) pending = loadAll();
  if (pending === null) return null;
  if (allLoaded(pending)) {
    pendingReady = true;
    return pending;
  }
  return null;
}

/** Java addHelmet(): helmet mask SRC_IN-filled with player color, helmet detail on top. */
function tintSoldier(
  soldier: HTMLImageElement,
  helmet: HTMLImageElement,
  helmetMask: HTMLImageElement,
  color: string
): HTMLCanvasElement | null {
  const helmCanvas = document.createElement("canvas");
  helmCanvas.width = TILE;
  helmCanvas.height = TILE;
  const hg = helmCanvas.getContext("2d");
  if (hg === null) return null;
  hg.drawImage(helmetMask, 0, 0);
  hg.globalCompositeOperation = "source-in";
  hg.fillStyle = color;
  hg.fillRect(0, 0, TILE, TILE);
  hg.globalCompositeOperation = "source-over";
  hg.drawImage(helmet, 0, 0);

  const canvas = document.createElement("canvas");
  canvas.width = TILE;
  canvas.height = TILE;
  const g = canvas.getContext("2d");
  if (g === null) return null;
  g.drawImage(soldier, 0, 0);
  g.drawImage(helmCanvas, 0, 0);
  return canvas;
}

interface Tinted {
  def: HTMLCanvasElement;
  anims: HTMLCanvasElement[][];
}

const tintCache = new Map<string, Tinted>();

function getTinted(color: string): Tinted | null {
  const cached = tintCache.get(color);
  if (cached !== undefined) return cached;

  const l = getLoaded();
  if (l === null) return null;

  const def = tintSoldier(l.soldierNormal, l.helmet, l.helmetMask, color);
  if (def === null) return null;

  const anims: HTMLCanvasElement[][] = [];
  for (const anim of l.anims) {
    const frames: HTMLCanvasElement[] = [];
    for (const f of anim) {
      const tinted = tintSoldier(f.img, l.helmet, l.helmetMask, color);
      if (tinted === null) return null;
      frames.push(tinted);
    }
    anims.push(frames);
  }

  const t: Tinted = { def, anims };
  tintCache.set(color, t);
  return t;
}

function pickFrame(frames: Frame[], time: number): Frame | null {
  for (const f of frames) {
    if (time > f.dur) {
      time -= f.dur;
      continue;
    }
    return f;
  }
  return null;
}

export interface SpriteResult {
  image: CanvasImageSource;
  alpha: number;
}

export function spritesReady(): boolean {
  return getLoaded() !== null;
}

export function getSoldierSprite(color: string, soldier: Soldier): SpriteResult | null {
  const l = getLoaded();
  const tinted = getTinted(color);
  if (l === null || tinted === null) return null;

  if (soldier.exploding) {
    const time = soldier.getTimeExploding();
    const frame = pickFrame(l.deaths, time);
    if (frame !== null) return { image: frame.img, alpha: 1 };
    const fadeTime = time - DEATH_SRC.reduce((sum, f) => sum + f.dur, 0);
    if (fadeTime < DEATH_FADE_TIME) {
      const last = l.deaths[l.deaths.length - 1];
      return { image: last.img, alpha: Math.max(0, 1 - fadeTime / DEATH_FADE_TIME) };
    }
    return null;
  }

  if (soldier.isAnimating()) {
    const animNum = soldier.getAnimationNum() % tinted.anims.length;
    const anim = l.anims[animNum];
    const time = soldier.getAnimationTime();
    const frame = pickFrame(anim, time);
    if (frame !== null) {
      return { image: tinted.anims[animNum][l.anims[animNum].indexOf(frame)], alpha: 1 };
    }
    soldier.endAnimation();
  }

  return { image: tinted.def, alpha: 1 };
}

export function getExplosionSprite(time: number): CanvasImageSource | null {
  const l = getLoaded();
  if (l === null) return null;
  const frame = pickFrame(l.explosion, time);
  return frame === null ? null : frame.img;
}

export function getCurrentMarkerSprite(time: number): CanvasImageSource | null {
  const l = getLoaded();
  if (l === null) return null;
  const frame = pickFrame(l.current, time);
  return frame === null ? null : frame.img;
}

export function getNextTeamSprite(): CanvasImageSource | null {
  const l = getLoaded();
  return l === null ? null : l.nextTeam;
}

export function getSpriteSize(img: CanvasImageSource): { width: number; height: number } {
  if (img instanceof HTMLImageElement) return { width: img.naturalWidth, height: img.naturalHeight };
  const dims = img as unknown as { width?: number; height?: number };
  return { width: dims.width ?? 20, height: dims.height ?? 20 };
}