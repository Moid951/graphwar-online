# Graphwar Online

**Play [Graphwar](https://graphwar.com) in your browser** — a faithful TypeScript/WebSocket port of the classic multiplayer math strategy game. No download, no install — just open a tab and play.

Graphwar is a real-time multiplayer game where players type mathematical functions to fire projectiles across a terrain of graph obstacles. Outsmart your opponents with calculus and coordinate geometry.

## Why?

Graphwar has been a beloved desktop and mobile game for years ([source code](https://github.com/catabriga/graphwar)). This project makes it **playable on any modern browser** so anyone can jump in without installing anything.

## Features

- **Real-time multiplayer** — up to 10 players per room via WebSocket
- **3 game modes** — Normal (y = f(x)), 1st ODE, 2nd ODE
- **Team-based combat** — 2 teams, soldiers with individual turns
- **AI opponents** — computer players with configurable difficulty
- **Private rooms** — password-protected for friends
- **Dark/Light theme** — built-in toggle
- **Cross-platform** — any browser, any device, no install

## Quick Start

```bash
npm install
npm run build
npm run start
# Open http://localhost:8080
```

## Development

```bash
npm run dev:server    # Server with hot reload
npm run dev:client    # Client with Vite HMR
npm run typecheck     # Typecheck all packages
npm test              # Unit tests (math + server)
npm run test:client   # Client tests
npm run test:e2e      # Browser e2e (requires server)
```

## Architecture

```
packages/
├── math/        # Function parser, obstacle generation, trajectory simulation
├── server/      # WebSocket relay, room management, lobby
└── client/      # Browser UI (TypeScript + Canvas 2D + Vite)
```

- **Client-authoritative** — each client simulates trajectories locally, server relays state
- **Protocol-compatible** — preserves the original Java wire format
- **Deterministic** — obstacle generation matches the original Java output

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Client | TypeScript, Canvas 2D, Vite |
| Server | TypeScript, ws (WebSocket) |
| Math | TypeScript (parser, RK4 integrator, obstacles) |
| Testing | Vitest, Playwright |

## How to Play

1. Enter your name → **Play** → join the lobby
2. Create or join a room
3. Host adds players (local/AI), balances teams, starts the game
4. On your turn, type a function: `sin(x)`, `x^2 - 4`, `y' = -y`
5. Press **Fire** — your projectile follows the function's curve
6. Eliminate all enemy soldiers to win!

### Supported Functions

| | |
|---|---|
| **Arithmetic** | `+`, `-`, `*`, `/`, `^` |
| **Trig** | `sin`, `cos`, `tan` |
| **Other** | `sqrt`, `log`, `abs`, `ln` |
| **Constants** | `e`, `pi` |
| **Variables** | `x`, `y`, `y'` (mode-dependent) |

## Credits

- Original game by [catabriga](https://github.com/catabriga/graphwar) — [graphwar.com](https://graphwar.com)
- Web port built with TypeScript, Vite, and WebSocket

## License

See the [original Graphwar project](https://github.com/catabriga/graphwar) for licensing.

## Contributing

Contributions welcome! Open issues or submit PRs.
