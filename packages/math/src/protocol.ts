export const NetworkProtocol = {
  NO_INFO: 10,
  ALL_INFO: 11,
  SET_NAME: 12,
  CHANGE_MODE: 13,
  CHAT_MSG: 14,
  CLOSE_CONNECTION: 15,
  ADD_PLAYER: 16,
  ADD_SOLDIER: 17,
  SET_SOLDIER: 18,
  REMOVE_SOLDIER: 19,
  SET_TEAM: 20,
  SET_READY: 21,
  START_GAME: 22,
  CHANGE_GAME_TYPE: 23,
  FIRE_FUNC: 24,
  NEXT_TURN: 25,
  SEND_FUNC: 26,
  READY_NEXT_TURN: 27,
  SET_ANGLE: 28,
  REMOVE_PLAYER: 29,
  END_GAME: 30,
  NEXT_MODE: 31,
  PREVIOUS_MODE: 32,
  SET_MODE: 33,
  CHANGE_ANGLE: 34,
  KILL_PLAYER: 35,
  CONNECTION_ACCEPTED: 36,
  TIME_UP: 37,
  GAME_FULL: 38,
  DISCONNECT: 39,
  GAME_FINISHED: 40,
  NEW_LEADER: 41,
  START_COUNTDOWN: 42,
  REORDER: 43,
  FUNCTION_PREVIEW: 44,
  KEY: 45,
  KEY_DENIED: 46,
  KICK: 47,
  KICKED: 48,
  TRANSFER_LEADER: 49,
  SET_LEADER: 50,
  CANCEL_START: 51,

  JOIN: 101,
  SAY_CHAT: 102,
  LIST_PLAYERS: 103,
  LIST_ROOMS: 104,
  ROOM_STATUS: 105,
  QUIT: 106,
  CLOSE_ROOM: 107,
  CREATE_ROOM: 108,
  ROOM_INVALID: 109,
  NAME_CHANGE: 110,
} as const;

/** Live room-protocol codes the relay must understand. */
export function isLiveRoomCode(code: number): boolean {
  return (
    code === 10 ||
    code === 14 ||
    code === 16 ||
    code === 17 ||
    code === 19 ||
    code === 20 ||
    code === 21 ||
    code === 22 ||
    code === 24 ||
    code === 25 ||
    code === 27 ||
    code === 28 ||
    code === 29 ||
    code === 31 ||
    code === 33 ||
    code === 37 ||
    code === 38 ||
    code === 39 ||
    code === 40 ||
    code === 41 ||
    code === 42 ||
    code === 43 ||
    code === 44 ||
    code === 45 ||
    code === 46 ||
    code === 47 ||
    code === 48 ||
    code === 49 ||
    code === 50 ||
    code === 51
  );
}