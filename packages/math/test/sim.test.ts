import { describe, it, expect } from "vitest";
import {
  Constants,
  Obstacle,
  FunctionSim,
  PlayerSim,
  toScreenX,
  toScreenY,
  toGameX,
  toGameY,
  javaUrlEncode,
  javaUrlDecode,
} from "../src/index.js";

function emptyObstacle(): Obstacle {
  return new Obstacle(0, []);
}

function makePlayers(soldierPx: { x: number; y: number }[]): PlayerSim[] {
  return [
    {
      soldiers: soldierPx.map((s) => ({ x: s.x, y: s.y, alive: true })),
      numSoldiers: soldierPx.length,
      currentTurnSoldierIndex: 0,
    },
  ];
}

describe("coordinate conversion", () => {
  it("round-trips for the whole 770x450 grid", () => {
    for (let px = 0; px <= 770; px += 5) {
      for (let py = 0; py <= 450; py += 5) {
        expect(toScreenX(toGameX(px))).toBeCloseTo(px, 6);
        expect(toScreenY(toGameY(py))).toBeCloseTo(py, 6);
      }
    }
  });

  it("spot values", () => {
    expect(toScreenX(0)).toBeCloseTo(385, 6);
    expect(toScreenY(0)).toBeCloseTo(225, 6);
    expect(toScreenX(-25)).toBeCloseTo(0, 6);
    expect(toScreenY((225 * 50) / 770)).toBeCloseTo(0, 6);
    expect(toScreenY(-(225 * 50) / 770)).toBeCloseTo(450, 6);
  });
});

describe("url codec (Java-compatible)", () => {
  it("round-trips", () => {
    const samples = [
      "hello world",
      "a&b%c",
      "João 🎮 !~'()*",
      "x+y=z",
      "100%",
      "a/b\\c",
    ];
    for (const s of samples) {
      expect(javaUrlDecode(javaUrlEncode(s))).toBe(s);
    }
  });

  it("space → +, encodes !~'()", () => {
    expect(javaUrlEncode("a b")).toBe("a+b");
    expect(javaUrlEncode("!~'()")).toBe("%21%7E%27%28%29");
    expect(javaUrlEncode("*")).toBe("*");
  });

  it("protocol line split", async () => {
    const { buildMessage, splitMessage } = await import("../src/index.js");
    const line = buildMessage([16, "Lucas", 1, 2, 2]);
    const fields = splitMessage(line);
    expect(fields[0]).toBe("16");
    expect(fields[1]).toBe("Lucas");
    expect(fields[4]).toBe("2");
  });
});

describe("trajectory determinism", () => {
  it("y=0 fires straight and exits the right plane edge", () => {
    const obstacle = emptyObstacle();
    const players = makePlayers([{ x: 100, y: 225 }]);
    const f = new FunctionSim("0");
    const r1 = f.processFunctionRange(obstacle, players, 1, 0, false);
    const r2 = f.processFunctionRange(obstacle, players, 1, 0, false);
    expect(r1.numSteps).toBe(r2.numSteps);
    expect(r1.numSteps).toBeGreaterThan(0);
    expect(r1.numSteps).toBeLessThan(Constants.FUNC_MAX_STEPS);
    expect(r1.lastX).toBeGreaterThan(770 - 8);
    expect(r1.lastY).toBeCloseTo(225, 1);
    for (let i = 0; i < r1.numSteps; i++) {
      expect(r1.valuesX[i]).toBe(r2.valuesX[i]);
      expect(r1.valuesY[i]).toBe(r2.valuesY[i]);
    }
  });

  it("same function + terrain → identical trace every run", () => {
    const obstacle = emptyObstacle();
    const players = makePlayers([{ x: 385, y: 225 }]);
    const f = new FunctionSim("sin(x)+x/10");
    const a = f.processFunctionRange(obstacle, players, 1, 0, false);
    const b = f.processFunctionRange(obstacle, players, 1, 0, false);
    expect(a.numSteps).toBe(b.numSteps);
    expect(a.lastX).toBe(b.lastX);
    expect(a.lastY).toBe(b.lastY);
  });

  it("pole x=10 terminates via step halving", () => {
    const obstacle = emptyObstacle();
    const players = makePlayers([{ x: 300, y: 100 }]);
    const f = new FunctionSim("1/(x-10)");
    const r = f.processFunctionRange(obstacle, players, 1, 0, false);
    expect(r.numSteps).toBeLessThan(Constants.FUNC_MAX_STEPS);
    expect(r.numSteps).toBeGreaterThan(0);
  });

  it("sqrt(x-20) with NaN explodes early", () => {
    const obstacle = emptyObstacle();
    const players = makePlayers([{ x: 200, y: 200 }]);
    const f = new FunctionSim("sqrt(x-20)");
    const r = f.processFunctionRange(obstacle, players, 1, 0, false);
    expect(r.numSteps).toBeLessThan(Constants.FUNC_MAX_STEPS);
  });

  it("records every soldier hit along one line", () => {
    const obstacle = emptyObstacle();
    const players = makePlayers([
      { x: 100, y: 225 },
      { x: 400, y: 225 },
      { x: 500, y: 225 },
    ]);
    players[0].currentTurnSoldierIndex = 0;
    const f = new FunctionSim("0");
    const r = f.processFunctionRange(obstacle, players, 1, 0, false);
    expect(r.hits).toHaveLength(2);
    const soldiers = r.hits.map((h) => h.soldier).sort((a, b) => a - b);
    expect(soldiers).toEqual([1, 2]);
  });

  it("skips the shooter's own soldier", () => {
    const obstacle = emptyObstacle();
    const players = makePlayers([
      { x: 100, y: 225 },
      { x: 400, y: 225 },
    ]);
    players[0].currentTurnSoldierIndex = 0;
    const f = new FunctionSim("0");
    const r = f.processFunctionRange(obstacle, players, 1, 0, false);
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0].soldier).toBe(1);
  });
});

describe("terrain / erosion", () => {
  it("explosion erases a disc", () => {
    const obstacle = new Obstacle(1, [{ x: 385, y: 225, radius: 20 }]);
    expect(obstacle.collidePoint(385, 225)).toBe(true);
    obstacle.setExplosion(385, 225, Constants.EXPLOSION_RADIUS);
    obstacle.explodePoint();
    expect(obstacle.collidePoint(385, 225)).toBe(false);
    expect(obstacle.collidePoint(385 + 5, 225)).toBe(false);
    expect(obstacle.collidePoint(385 + 15, 225)).toBe(true);
  });

  it("terrain built from same params is deterministic", () => {
    const params = {
      numCircles: 10,
      circleInfo: Array.from({ length: 10 }, (_, i) => ({
        x: (i * 73) % 770,
        y: (i * 41) % 450,
        radius: 20 + (i % 4) * 10,
      })),
    };
    const a = new Obstacle(params.numCircles, params.circleInfo);
    const b = new Obstacle(params.numCircles, params.circleInfo);
    expect(a.whiteMap).toEqual(b.whiteMap);
  });
});

describe("ODE solvers", () => {
  it("FST_ODE y'=0 stays horizontal", () => {
    const obstacle = emptyObstacle();
    const players = makePlayers([{ x: 200, y: 300 }]);
    const f = new FunctionSim("0");
    const r = f.processRK4Range(obstacle, players, 1, 0, false);
    expect(r.numSteps).toBeGreaterThan(0);
    expect(r.numSteps).toBeLessThan(Constants.FUNC_MAX_STEPS);
    for (let i = 0; i < Math.min(r.numSteps, 500); i++) {
      expect(r.valuesY[i]).toBeCloseTo(r.valuesY[0], 3);
    }
  });

  it("FST_ODE y'=y tracks e^x", () => {
    const obstacle = emptyObstacle();
    const players = makePlayers([{ x: 200, y: 300 }]);
    const f = new FunctionSim("y");
    const r = f.processRK4Range(obstacle, players, 1, 0, false);
    const x0 = r.valuesX[0];
    const y0 = r.valuesY[0];
    for (let i = 1; i < Math.min(r.numSteps, 200); i++) {
      const expected = y0 * Math.exp(r.valuesX[i] - x0);
      expect(Math.abs(r.valuesY[i] - expected)).toBeLessThan(1e-3 * Math.max(1, Math.abs(expected)));
    }
  });

  it("SND_ODE y''=0 at 45deg is a straight line", () => {
    const obstacle = emptyObstacle();
    const players = makePlayers([{ x: 200, y: 200 }]);
    const f = new FunctionSim("0");
    const angle = Math.PI / 4;
    const r = f.processRK42Range(obstacle, players, 1, 0, angle, false);
    expect(r.numSteps).toBeGreaterThan(0);
    const x0 = r.valuesX[0];
    const y0 = r.valuesY[0];
    for (let i = 1; i < Math.min(r.numSteps, 300); i++) {
      expect(r.valuesY[i]).toBeCloseTo(y0 + (r.valuesX[i] - x0), 2);
      expect(r.valuesDY[i]).toBeCloseTo(1, 3);
    }
  });

  it("SND_ODE initial offset is SOLDIER_RADIUS px along angle", () => {
    const obstacle = emptyObstacle();
    const px = 200;
    const py = 200;
    const players = makePlayers([{ x: px, y: py }]);
    const f = new FunctionSim("0");
    const angle = Math.PI / 4;
    const r = f.processRK42Range(obstacle, players, 1, 0, angle, false);
    expect(toScreenX(r.valuesX[0])).toBeCloseTo(px + Constants.SOLDIER_RADIUS * Math.cos(angle), 3);
    expect(toScreenY(r.valuesY[0])).toBeCloseTo(py - Constants.SOLDIER_RADIUS * Math.sin(angle), 3);
  });
});