# Graphwar Online

Play [Graphwar](https://graphwar.com) in your browser. No download required.

Graphwar is an artillery game in which you must hit your enemies using mathematical functions. The trajectory of your shot is determined by the function you wrote, and your goal is to avoid the obstacles and your teammates and hit your enemies. The game takes place in a Cartesian Plane.

**[Play Now](https://graphwar-online-client-pink.vercel.app/)**

This is a TypeScript/WebSocket port of the [original Java game](https://github.com/catabriga/graphwar) by catabriga.

## Features

- Real-time multiplayer, up to 10 players per room
- 3 game modes: Normal, 1st Order ODE, 2nd Order ODE
- Team-based combat with individual soldier turns
- AI opponents with configurable difficulty
- Private rooms with password protection
- Dark and light themes
- Works on any modern browser

## Game Modes

### Normal Function

The Normal Function mode is the most basic mode. The function you type determines the trajectory of your shot, so the graph of your shot is the same as the graph of the function.

However, the function must be shot by your soldier, and there is no guarantee that the point where your soldier is standing belongs to the function. To solve this, the function is translated by adding a constant until the soldier's position is part of the function. So if you type y = f(x), the actual graph is y = f(x) + c.

### First Order Differential Equation

In this mode you enter a first order differential equation instead of a function. For example:

- y' = 3*sin(x)+2
- y' = -y/3
- y' = 1/(x+y)

No constant is added to your function. Instead, your soldier's position is used as the initial condition to solve the differential equation, and the graph fired is the actual solution.

### Second Order Differential Equation

This mode is similar to the first order mode, but now you enter a second order differential equation:

- y'' = -y + y' + 2*x - 1
- y'' = 4*sin(x) + 2^x
- y'' = 1.04^(-(x+y)^2)

To have a unique solution, a second order differential equation needs two initial conditions: the soldier's position and the firing angle. You can change the firing angle by pressing Up and Down on the keyboard. This is the only mode where the angle affects the function.

## Common Pitfalls

The translation of the function has some confusing consequences. First, any constant added to your function is irrelevant to the result. For example, y = 2*x + 3, y = 2*x - 8 and y = 2*x all produce the exact same graph in the game.

The x axis limits in the game are -25 to +25, and the y axis limits are -15 to 15. Functions can get very big very fast. For example, y = x^2 has the value 100 when x = 10, so it will hit the ceiling quickly. If your soldier is at x = -15, this function will appear as a steep straight line. Scale your functions appropriately, e.g. y = (x^2)/50 produces a nice parabola.

Your soldiers are always on negative x values (left side of the y axis), so functions like y = sqrt(x) will explode immediately. Use y = sqrt(abs(x)) instead.

Functions may explode spontaneously if they hit an invalid value (square root of a negative number, vertical asymptote) or if they exceed the maximum function length.

## Function Syntax

**Variables:** x, y, y'

**Operators:** +, -, *, /, ^

**Functions:** sqrt, log, ln, abs, sin, cos, tan, exp

**Examples:**
- y = ((x-3)^2)/20
- y = ln(abs(x))
- y = sin(x/20)*5
- y' = 1.2^x
- y'' = (1.2^(-(x+3)^2))*(20*(-y))

Use plenty of parentheses to avoid misinterpretation. For example, y = 1/x+2 is parsed as (1/x) + 2. Use 1/(x+2) if that is what you mean.

## Chat Commands

- **-skip** : If all players use this, the current map is skipped and a new one is generated.
- **-sayfunc** : Shows the function everyone else is using in your chat.
- **-stopsayfunc** : Stops functions from appearing in chat.
- **-shownext** : Highlights the next soldier to play for each player with a dark circle. Useful for planning ahead.
- **-stopshownext** : Stops highlighting the next soldier.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Client | TypeScript, Canvas 2D, Vite |
| Server | TypeScript, ws (WebSocket) |
| Math | TypeScript (parser, RK4 integrator, obstacle generation) |
| Testing | Vitest, Playwright |

## Quick Start

```bash
npm install
npm run build
npm run start
# Open http://localhost:8080
```

## Development

```bash
npm run dev:server
npm run dev:client
npm run typecheck
npm test
npm run test:client
npm run test:e2e
```

## Credits

Original game by [catabriga](https://github.com/catabriga/graphwar) - [graphwar.com](https://graphwar.com)

## License

See the [original Graphwar project](https://github.com/catabriga/graphwar) for licensing.
