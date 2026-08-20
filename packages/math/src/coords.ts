import { Constants } from "./constants.js";

export function toScreenX(gameX: number): number {
  return (Constants.PLANE_LENGTH * gameX) / Constants.PLANE_GAME_LENGTH + Constants.PLANE_LENGTH / 2;
}

export function toScreenY(gameY: number): number {
  return (-Constants.PLANE_LENGTH * gameY) / Constants.PLANE_GAME_LENGTH + Constants.PLANE_HEIGHT / 2;
}

export function toGameX(screenX: number): number {
  return (
    (Constants.PLANE_GAME_LENGTH * (screenX - Constants.PLANE_LENGTH / 2)) / Constants.PLANE_LENGTH
  );
}

export function toGameY(screenY: number): number {
  return (
    (Constants.PLANE_GAME_LENGTH * (Constants.PLANE_HEIGHT / 2 - screenY)) / Constants.PLANE_LENGTH
  );
}

export function gameCoordinateRadius(radius: number): number {
  return (Constants.PLANE_GAME_LENGTH * radius) / Constants.PLANE_LENGTH;
}