# Graphwar Web — Porting Report

Behavior-compatible TypeScript migration of the Java desktop Graphwar
(single codebase `D:\Users\Admin\Desktop\graphwar`) to a browser multiplayer
game. Three workspaces: `packages/math`, `packages/server`, `packages/client`.

## Architecture

- **Client-authoritative simulation** preserved. Each client runs the full
  `FunctionSim` trajectory locally; the relay only validates ownership and
  game state, mirroring the Java `GraphServer` role. No server-authoritative
  switch.
- One protocol message per WebSocket frame, `&`-separated fields, first field
  is an int code. Java codec preserved on the wire: `space -> '+'`, encodes
  `!~'()`, leaves `*`. Server passes raw; clients encode/decode.
- Rooms co-located in-process (no TCP port relay). Paths:
  `/` and `/lobby` = global lobby, `/room/<id>` = relay. Virtual port
  `20000 + roomID` retained for protocol compat (`CREATE_ROOM` port field
  ignored, matching Java). Three public rooms spawned at startup.
  `MAX_PLAYERS = 10`.

## Spec compliance

Source of truth: `spec/B..I_TEST_SPEC.md`. Discrepancies (code wins):

- **I_TEST_SPEC §1**: "2+ valid functions" claim is wrong — Java
  `PolishNotationFunction` throws `MalformedFunction` on a single valid
  function. TS `FunctionSim` matches the code.
- **DUMMY_NAME**: sent RAW from the room dummy client
  (`RoomServer/GlobalClient.java:74`, "This is not encoded because the dummy
  name constants is already encoded"). `LobbyPlayer.run` compares raw.
  Server-created public room names ARE javaUrlEncoded.
- **RNG order**: deterministic obstacle generation relies on exact
  `Math.random()` call ordering from Java `Obstacle.fillCircle`; preserved in
  `packages/math`.
- **antialias / Java2D**: Swing rendering hints (`RenderingHints`) don't
  transfer to Canvas 2D; minor visual variance expected.
- **Math**: `max(numSteps, ...)` etc. use JS `Math.max` (no integer
  truncation difference on these inputs). `simResult` is kept alongside the
  parsed function because `FunctionSim` doesn't expose
  `getNumSteps/lastX/lastY` — the UI reads trajectory from `SimResult`.

## Verification

- `npm run typecheck` — clean (tsc -b, all workspaces).
- Unit tests: **math 33, server 23, client 28** — all pass.
- Browser e2e `packages/client/test/browser.mjs` (Playwright, chromium):
  main menu → global lobby → room list → create room → pre-game → add local
  player → ready → countdown → game screen → function fire → quit. 10/10,
  run 8x consecutively with no flakes (requires the server running on 8080).
- Browser e2e `packages/client/test/browser2.mjs`: two-browser multiplayer
  game (A creates room, B joins via room list, computer player added, teams
  balanced via the pre-game Switch button, START_GAME with real terrain,
  ArrowUp SET_ANGLE broadcast verified on the other client, live fires /
  NEXT_TURN / GAME_FINISHED, both quit back to menu). 19/19, run 5x
  consecutively with no flakes. The room is switched to SND_ODE ("2nd ODE")
  via the Mode button before starting, because arrow-key angle control is
  gated to SND_ODE (matching Java `GameScreen.keyPressed`). The angle test is
  deterministic despite the server's random starting player: pageB fires on
  its turn so the cycle advances to pageA's turn quickly, while pageA only
  presses arrows. Angle step otherwise mirrors Java (balance teams with the
  pre-game Switch button and fire `100*x` for quick, low-risk turns).
- Node WS e2e verified full protocol round trip (lobby join, room create,
  START_GAME with real terrain, FIRE_FUNC echo, chat).

## Known behavioral notes

- UI overhaul (minimalist Swiss, light mode default with dark toggle):
  - Styles split out of `index.html` into `packages/client/src/styles/`
    (`tokens.css` theme variables, `base.css` resets, `components.css`).
  - Game canvas now renders the OG `rsc/` sprites: soldier.png tinted per
    player via helmet mask, soldier1-9 aim animations, soldierExplosion
    death frames + fade, explosion0-5 impact frames, currentPlayer turn
    marker (all durations from the Java `.txt` files). Fallback to circles
    while sprites load / in headless tests.
  - Terrain switched from cream/navy to the Java OG white-background /
    black-obstacle bitmap (`Obstacle.rgba`) + mid crosshair lines.
  - `window.prompt()` replaced by a custom modal (`ui.prompt`, `#modalInput`);
    e2e harnesses updated to fill the modal instead of accepting dialogs.
  - Player rows are flex with ellipsis; angle display rounds to degrees
    (`Angle: 12°`); Ready button has a fixed min-width.
  - Pre-game player board: Switch / +Soldier / -Soldier / Remove buttons are
    shown for the player's own rows and the leader's rows only (audit M11/M12,
    deviating from Java which shows all buttons grayed out).
  - Quit (in-game and pre-game) uses a `confirm` modal; after quitting, the
    game returns to the global room screen if the global client is still
    connected, otherwise to the main menu. Kick / disconnect messages show in
    a game-screen message panel with an OK button.
  - ArrowUp/ArrowDown angle control only active in SND_ODE ("2nd ODE") game
    mode, matching Java (`GraphGameScreen` gates on `SND_ODE`). The browser2
    e2e switches the room to SND_ODE via the Mode button before starting.
  - Trajectory and explosion drawing flip horizontally by
    `isFunctionReversed() XOR isTerrainReversed()` (Java
    `drawFunctionImage`/`drawExplosion`), not by `isTerrainReversed()` alone;
    the explosion also uses the sim's `lastX/lastY` directly (already screen
    coords) instead of re-converting them. Fixes the mirrored fire origin and
    the trajectory visually crossing obstacles for TEAM2 shooters.
  - The terrain image itself is mirrored when `isTerrainReversed()` (Java
    `drawBackground:272`); without this the obstacles stayed fixed while
    soldiers/trajectories flipped, making the whole world mirrored relative to
    the terrain when the local player is on TEAM2.

- `wireRelay` bug fixed during e2e: room-client messages were never routed to
  `relay.handleMessage` (lobby routed; relay didn't). Unit tests called
  `handleMessage` directly so it went unnoticed.
- Room lifecycle: hiding/closing a room (`CLOSE_ROOM`, sent by the room
  creator when a game starts) removes it from the lobby list but keeps the
  relay alive while clients are connected; the relay shuts itself down after
  5s with no clients **only after the room is removed from the lobby**
  (`RoomServer.detached`, set by `GlobalServer.removeRoom`). Public rooms
  are never detached and persist for the server's lifetime. Matches Java
  (room thread ends when connections close).
- Keepalive ticker fires on 1000ms boundaries with strict `>` comparison;
  tests advance `TIMEOUT_KEEPALIVE + 1000`.

## Running

```sh
npm install
npm run build
npm start                 # server on 8080 (also serves client/dist)
# http://127.0.0.1:8080   — production
npm run dev:client        # vite on 5173, proxies ws to 8080 — dev
npm run test:e2e          # Playwright browser e2e (needs server running)
```
