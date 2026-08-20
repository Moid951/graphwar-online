import { describe, it, expect } from "vitest";
import {
  parseFunctionString,
  evaluateTokens,
  TokenType,
  FunctionToken,
  createRegularNotationTokens,
  getStringFunction,
  MalformedFunction,
  getValuesNeeded,
} from "../src/index.js";

function rpn(input: string): string[] {
  return parseFunctionString(input).map((t) => {
    switch (t.type) {
      case TokenType.VARIABLE1:
        return "x";
      case TokenType.VARIABLE2:
        return "y";
      case TokenType.VARIABLE3:
        return "y'";
      case TokenType.VALUE:
        return String(t.value);
      case TokenType.ADD:
        return "+";
      case TokenType.SUBTRACT:
        return "-";
      case TokenType.MULTIPLY:
        return "*";
      case TokenType.DIVIDE:
        return "/";
      case TokenType.POW:
        return "^";
      case TokenType.SQRT:
        return "sqrt";
      case TokenType.LOG:
        return "log";
      case TokenType.ABS:
        return "abs";
      case TokenType.SIN:
        return "sin";
      case TokenType.COS:
        return "cos";
      case TokenType.TAN:
        return "tan";
      case TokenType.LN:
        return "ln";
      default:
        return "?";
    }
  });
}

describe("parser conformance", () => {
  it("sin(x)^2 → (sin x)^2", () => {
    expect(rpn("sin(x)^2")).toEqual(["^", "sin", "x", "2"]);
  });

  it("x^x^x → x^(x^x) right-assoc pow", () => {
    expect(rpn("x^x^x")).toEqual(["^", "x", "^", "x", "x"]);
    expect(evaluateTokens(parseFunctionString("2^3^2"), 0, 0, 0)).toBe(512);
  });

  it("x/x/x → x/(x/x) right-assoc divide", () => {
    expect(rpn("x/x/x")).toEqual(["/", "x", "/", "x", "x"]);
    expect(evaluateTokens(parseFunctionString("8/4/2"), 0, 0, 0)).toBe(4);
  });

  it("x-x → x+(-x)", () => {
    expect(rpn("x-x")).toEqual(["+", "x", "-", "x"]);
    expect(evaluateTokens(parseFunctionString("8-4-2"), 0, 0, 0)).toBe(2);
  });

  it("implicit multiplication", () => {
    expect(rpn("2x")).toEqual(["*", "2", "x"]);
    expect(rpn("2(x+1)")).toEqual(["*", "2", "+", "x", "1"]);
    expect(rpn("x sin(x)")).toEqual(["*", "x", "sin", "x"]);
    expect(rpn("pi x")).toEqual(["*", String(Math.PI), "x"]);
    expect(rpn("3pi")).toEqual(["*", "3", String(Math.PI)]);
  });

  it("unary minus binds to x^2", () => {
    expect(rpn("-x^2")).toEqual(["+", "0", "-", "^", "x", "2"]);
    expect(evaluateTokens(parseFunctionString("-2^2"), 0, 0, 0)).toBe(-4);
  });

  it("exp(x) → e^x", () => {
    expect(rpn("exp(x)")).toEqual(["^", String(Math.E), "x"]);
    expect(evaluateTokens(parseFunctionString("exp(0)"), 0, 0, 0)).toBe(1);
  });

  it("1e3 → 1*e*3 (not scientific)", () => {
    expect(rpn("1e3")).toEqual(["*", "1", "*", String(Math.E), "3"]);
    const v = evaluateTokens(parseFunctionString("1e3"), 0, 0, 0);
    expect(v).toBeCloseTo(1 * Math.E * 3, 12);
    expect(v).not.toBeCloseTo(1000, 12);
  });

  it("aliases sen/tg/log/ln", () => {
    expect(rpn("sen(x)")).toEqual(["sin", "x"]);
    expect(rpn("tg(x)")).toEqual(["tan", "x"]);
    expect(evaluateTokens(parseFunctionString("log(100)"), 0, 0, 0)).toBe(2);
    expect(evaluateTokens(parseFunctionString("ln(e)"), 0, 0, 0)).toBe(1);
  });

  it("decimal comma ≡ decimal point", () => {
    expect(rpn("1,5*x")).toEqual(["*", "1.5", "x"]);
    expect(rpn("1.5*x")).toEqual(["*", "1.5", "x"]);
  });

  it("valid / invalid arity", () => {
    expect(rpn("x")).toEqual(["x"]);
    expect(rpn("x+1")).toEqual(["+", "x", "1"]);
    expect(rpn("sin(x)")).toEqual(["sin", "x"]);
    expect(() => parseFunctionString("x+")).toThrow(MalformedFunction);
    expect(() => parseFunctionString("")).toThrow(MalformedFunction);
    expect(() => parseFunctionString("+")).toThrow(MalformedFunction);
    expect(() => parseFunctionString("sin x^")).toThrow(MalformedFunction);
  });

  it("unbalanced brackets handled without crash", () => {
    expect(rpn("sin(x")).toEqual(["sin", "x"]);
    const quirk = parseFunctionString("sin x)");
    expect(getValuesNeeded(quirk)).toBe(0);
    expect(evaluateTokens(quirk, 1, 0, 0)).toBe(Math.sin(1));
  });

  it("NaN outcomes", () => {
    expect(evaluateTokens(parseFunctionString("sqrt(-1)"), 0, 0, 0)).toBeNaN();
    expect(evaluateTokens(parseFunctionString("log(-1)"), 0, 0, 0)).toBeNaN();
    expect(evaluateTokens(parseFunctionString("ln(0)"), 0, 0, 0)).toBe(-Infinity);
  });

  it("evaluate maps x,y,y'", () => {
    const f = parseFunctionString("x+y+y'");
    expect(evaluateTokens(f, 1, 2, 3)).toBe(6);
    const f2 = parseFunctionString("x*y");
    expect(evaluateTokens(f2, 3, 4, 0)).toBe(12);
  });

  it("getStringFunction round-trips", () => {
    const f = parseFunctionString("sin(x)^2");
    expect(getStringFunction(f)).toBe("(sin(x)^2.00)");
  });

  it("tokenizer drops unknown tokens (z)", () => {
    const tokens = createRegularNotationTokens("x+z");
    expect(tokens.some((t) => t.type === TokenType.VARIABLE1)).toBe(true);
  });
});