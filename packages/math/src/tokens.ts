export class MalformedFunction extends Error {
  constructor() {
    super("Malformed function");
  }
}

export const TokenType = {
  ADD: 1,
  SUBTRACT: 2,
  MULTIPLY: 3,
  DIVIDE: 4,
  POW: 5,
  SQRT: 6,
  LOG: 7,
  ABS: 8,
  SIN: 9,
  COS: 10,
  TAN: 11,
  LN: 12,
  VARIABLE1: 13, // x
  VARIABLE2: 14, // y
  VARIABLE3: 15, // y'
  VALUE: 16,
  LEFT_BRACKET: 17,
  RIGHT_BRACKET: 18,
} as const;

export type TokenTypeValue = (typeof TokenType)[keyof typeof TokenType];

export interface FunctionToken {
  type: TokenTypeValue;
  value: number;
}

export function makeToken(type: TokenTypeValue, value = 0): FunctionToken {
  return { type, value };
}

export function makeValueToken(value: number): FunctionToken {
  return { type: TokenType.VALUE, value };
}

export function tokenToString(t: FunctionToken): string {
  switch (t.type) {
    case TokenType.VARIABLE1:
      return "x";
    case TokenType.VARIABLE2:
      return "y";
    case TokenType.VARIABLE3:
      return "y'";
    case TokenType.VALUE: {
      return t.value.toFixed(2);
    }
    case TokenType.ADD:
      return "+";
    case TokenType.SUBTRACT:
      return "-";
    case TokenType.MULTIPLY:
      return "*";
    case TokenType.DIVIDE:
      return "/";
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
    case TokenType.POW:
      return "^";
    case TokenType.LN:
      return "ln";
    default:
      return "";
  }
}

export function isOperation(type: TokenTypeValue): boolean {
  return type >= 1 && type <= 12;
}

export function getNumParam(type: TokenTypeValue): number {
  if (type === TokenType.SUBTRACT) return 1;
  if (type >= TokenType.ADD && type <= TokenType.POW) return 2;
  if (type >= TokenType.SQRT && type <= TokenType.LN) return 1;
  return 0;
}

function precedes(t0: number, t1: number): boolean {
  return t0 < t1;
}

export function cloneToken(t: FunctionToken): FunctionToken {
  return { type: t.type, value: t.value };
}

export function copyTokens(tokens: FunctionToken[]): FunctionToken[] {
  return tokens.map(cloneToken);
}

export function clonePolishFunction(function_: FunctionToken[]): FunctionToken[] {
  return copyTokens(function_);
}

export function tokensEqual(a: FunctionToken[], b: FunctionToken[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].type !== b[i].type || a[i].value !== b[i].value) return false;
  }
  return true;
}

// ---- reorder (recursive descent producing Polish notation) ----

function reorderRec(out: FunctionToken[], funcTokens: FunctionToken[], start: number, end: number): boolean {
  if (start > end || start >= funcTokens.length) {
    return false;
  }

  let next = -1;
  let nextNest = Number.MAX_SAFE_INTEGER;
  let nest = 0;

  for (let i = start; i <= end; i++) {
    const t = funcTokens[i];
    if (t.type === TokenType.LEFT_BRACKET) {
      nest++;
    } else if (t.type === TokenType.RIGHT_BRACKET) {
      nest--;
    } else if (
      nest < nextNest ||
      (nest === nextNest && (next === -1 || precedes(t.type, funcTokens[next].type)))
    ) {
      next = i;
      nextNest = nest;
    }
  }

  if (next === -1) {
    return false;
  }

  const param = getNumParam(funcTokens[next].type);
  if (param === 0) {
    out.push(funcTokens[next]);
  } else if (param === 1) {
    out.push(funcTokens[next]);
    reorderRec(out, funcTokens, next + 1, end);
  } else {
    out.push(funcTokens[next]);
    const leftExists = reorderRec(out, funcTokens, start, next - 1);
    if (funcTokens[next].type === TokenType.ADD && !leftExists) {
      out.push(makeValueToken(0));
    }
    reorderRec(out, funcTokens, next + 1, end);
  }

  return true;
}

// ---- implicit multiplication ----

function isImplicit(type1: TokenTypeValue, type2: TokenTypeValue): boolean {
  if (
    type1 === TokenType.VALUE ||
    type1 === TokenType.VARIABLE1 ||
    type1 === TokenType.VARIABLE2 ||
    type1 === TokenType.VARIABLE3 ||
    type1 === TokenType.RIGHT_BRACKET
  ) {
    if (
      type2 === TokenType.VALUE ||
      type2 === TokenType.VARIABLE1 ||
      type2 === TokenType.VARIABLE2 ||
      type2 === TokenType.VARIABLE3 ||
      type2 === TokenType.LEFT_BRACKET ||
      getNumParam(type2) === 1
    ) {
      return true;
    }
  }
  return false;
}

function adjustImplicitMultiplications(tokens: FunctionToken[]): FunctionToken[] {
  if (tokens.length === 0) return tokens;
  const out: FunctionToken[] = [tokens[0]];
  for (let i = 1; i < tokens.length; i++) {
    const prev = tokens[i - 1];
    const cur = tokens[i];
    if (isImplicit(prev.type, cur.type)) {
      out.push(makeToken(TokenType.MULTIPLY));
    }
    out.push(cur);
  }
  return out;
}

// ---- tokenizer ----

const TOKENIZER_REGEX = /[0-9]*\.?[0-9]+|\(|\)|x|y'|y|\+|\*|\/|\^|sqrt|log|abs|sin|sen|cos|tan|tg|-|ln|e|pi/g;

export function createRegularNotationTokens(argStr: string): FunctionToken[] {
  let funcStr = argStr.toLowerCase();

  funcStr = funcStr.replace(/-/g, "+-");
  funcStr = funcStr.replace(/exp/g, "e^");
  funcStr = funcStr.replace(/,/g, ".");

  const normalNotation: FunctionToken[] = [];

  TOKENIZER_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKENIZER_REGEX.exec(funcStr)) !== null) {
    const token = m[0];
    const value = Number(token);
    if (!Number.isNaN(value) && /^[0-9]*\.?[0-9]+$/.test(token)) {
      normalNotation.push(makeValueToken(value));
      continue;
    }
    switch (token) {
      case "x":
        normalNotation.push(makeToken(TokenType.VARIABLE1));
        break;
      case "y":
        normalNotation.push(makeToken(TokenType.VARIABLE2));
        break;
      case "y'":
        normalNotation.push(makeToken(TokenType.VARIABLE3));
        break;
      case "+":
        normalNotation.push(makeToken(TokenType.ADD));
        break;
      case "-":
        normalNotation.push(makeToken(TokenType.SUBTRACT));
        break;
      case "*":
        normalNotation.push(makeToken(TokenType.MULTIPLY));
        break;
      case "/":
        normalNotation.push(makeToken(TokenType.DIVIDE));
        break;
      case "sqrt":
        normalNotation.push(makeToken(TokenType.SQRT));
        break;
      case "log":
        normalNotation.push(makeToken(TokenType.LOG));
        break;
      case "abs":
        normalNotation.push(makeToken(TokenType.ABS));
        break;
      case "sin":
      case "sen":
        normalNotation.push(makeToken(TokenType.SIN));
        break;
      case "cos":
        normalNotation.push(makeToken(TokenType.COS));
        break;
      case "tan":
      case "tg":
        normalNotation.push(makeToken(TokenType.TAN));
        break;
      case "^":
        normalNotation.push(makeToken(TokenType.POW));
        break;
      case "ln":
        normalNotation.push(makeToken(TokenType.LN));
        break;
      case "e":
        normalNotation.push(makeValueToken(Math.E));
        break;
      case "pi":
        normalNotation.push(makeValueToken(Math.PI));
        break;
      case "(":
        normalNotation.push(makeToken(TokenType.LEFT_BRACKET));
        break;
      case ")":
        normalNotation.push(makeToken(TokenType.RIGHT_BRACKET));
        break;
      default:
        break;
    }
  }

  return adjustImplicitMultiplications(normalNotation);
}

export function reorderTokensToPolishNotation(funcTokens: FunctionToken[]): FunctionToken[] {
  const out: FunctionToken[] = [];
  reorderRec(out, funcTokens, 0, funcTokens.length - 1);
  return out;
}

// ---- arity / validity ----

export function getValuesNeeded(function_: FunctionToken[]): number {
  let valuesNeeded = 1;
  for (let i = 0; i < function_.length; i++) {
    if (isOperation(function_[i].type)) {
      valuesNeeded += getNumParam(function_[i].type) - 1;
    } else {
      valuesNeeded--;
    }
    if (valuesNeeded === 0 && i + 1 < function_.length) {
      return -1;
    }
  }
  return valuesNeeded;
}

export function parseFunctionString(funcStr: string): FunctionToken[] {
  const normalNotation = createRegularNotationTokens(funcStr);
  const polish = reorderTokensToPolishNotation(normalNotation);
  if (getValuesNeeded(polish) !== 0) {
    throw new MalformedFunction();
  }
  return polish;
}

// ---- evaluation ----

export function evaluateTokens(
  function_: FunctionToken[],
  var1: number,
  var2: number,
  var3: number
): number {
  let readLocation = 0;

  function evaluateToken(t: FunctionToken, param1: number, param2: number): number {
    switch (t.type) {
      case TokenType.VARIABLE1:
        return var1;
      case TokenType.VARIABLE2:
        return var2;
      case TokenType.VARIABLE3:
        return var3;
      case TokenType.VALUE:
        return t.value;
      case TokenType.ADD:
        return param1 + param2;
      case TokenType.SUBTRACT:
        return -param1;
      case TokenType.MULTIPLY:
        return param1 * param2;
      case TokenType.DIVIDE:
        return param1 / param2;
      case TokenType.SQRT:
        return Math.sqrt(param1);
      case TokenType.LOG:
        return Math.log10(param1);
      case TokenType.ABS:
        return Math.abs(param1);
      case TokenType.SIN:
        return Math.sin(param1);
      case TokenType.COS:
        return Math.cos(param1);
      case TokenType.TAN:
        return Math.tan(param1);
      case TokenType.POW:
        return Math.pow(param1, param2);
      case TokenType.LN:
        return Math.log(param1);
      default:
        return 0;
    }
  }

  function evaluateRec(): number {
    const currentToken = function_[readLocation];
    readLocation++;
    switch (currentToken.type) {
      case TokenType.VARIABLE1:
        return var1;
      case TokenType.VARIABLE2:
        return var2;
      case TokenType.VARIABLE3:
        return var3;
      case TokenType.VALUE:
        return currentToken.value;
      case TokenType.ADD:
        return evaluateRec() + evaluateRec();
      case TokenType.SUBTRACT:
        return -evaluateRec();
      case TokenType.MULTIPLY:
        return evaluateRec() * evaluateRec();
      case TokenType.DIVIDE:
        return evaluateRec() / evaluateRec();
      case TokenType.SQRT:
        return Math.sqrt(evaluateRec());
      case TokenType.LOG:
        return Math.log10(evaluateRec());
      case TokenType.ABS:
        return Math.abs(evaluateRec());
      case TokenType.SIN:
        return Math.sin(evaluateRec());
      case TokenType.COS:
        return Math.cos(evaluateRec());
      case TokenType.TAN:
        return Math.tan(evaluateRec());
      case TokenType.POW:
        return Math.pow(evaluateRec(), evaluateRec());
      case TokenType.LN:
        return Math.log(evaluateRec());
      default:
        return 0;
    }
  }

  return evaluateRec();
}

// ---- string / simplification (used by AI) ----

export function getStringFunction(function_: FunctionToken[]): string {
  let readLocation = 0;

  function makeString(): string {
    let functionString = "";
    const currentToken = function_[readLocation];
    readLocation++;
    const type = currentToken.type;
    if (isOperation(type)) {
      if (getNumParam(type) === 2) {
        functionString += "(" + makeString();
        functionString += tokenToString(currentToken);
        functionString += makeString() + ")";
      } else {
        if (type === TokenType.SUBTRACT) {
          functionString += "(" + tokenToString(currentToken);
          functionString += "(" + makeString() + "))";
        } else {
          functionString += tokenToString(currentToken);
          functionString += "(" + makeString() + ")";
        }
      }
    } else {
      if (type === TokenType.VALUE && currentToken.value < 0) {
        functionString += "(" + tokenToString(currentToken) + ")";
      } else {
        functionString += tokenToString(currentToken);
      }
    }
    return functionString;
  }

  return makeString();
}

function simplifyRec(
  function_: FunctionToken[],
  state: { readLocation: number }
): FunctionToken[] {
  const tokens: FunctionToken[] = [];
  const currentToken = function_[state.readLocation];
  state.readLocation++;

  if (getNumParam(currentToken.type) === 2) {
    const list1 = simplifyRec(function_, state);
    const list2 = simplifyRec(function_, state);
    if (list1.length === 1 && list2.length === 1) {
      const p1 = list1[0];
      const p2 = list2[0];
      if (p1.type === TokenType.VALUE && p2.type === TokenType.VALUE) {
        const value = evaluateTokenValue(currentToken, p1.value, p2.value);
        tokens.push(makeValueToken(value));
        return tokens;
      }
    }
    tokens.push(currentToken);
    tokens.push(...list1);
    tokens.push(...list2);
    return tokens;
  } else if (getNumParam(currentToken.type) === 1) {
    const list1 = simplifyRec(function_, state);
    if (list1.length === 1) {
      const p1 = list1[0];
      if (p1.type === TokenType.VALUE) {
        const value = evaluateTokenValue(currentToken, p1.value, 0);
        tokens.push(makeValueToken(value));
        return tokens;
      }
    }
    tokens.push(currentToken);
    tokens.push(...list1);
    return tokens;
  } else {
    tokens.push(currentToken);
    return tokens;
  }
}

function evaluateTokenValue(t: FunctionToken, param1: number, param2: number): number {
  switch (t.type) {
    case TokenType.ADD:
      return param1 + param2;
    case TokenType.SUBTRACT:
      return -param1;
    case TokenType.MULTIPLY:
      return param1 * param2;
    case TokenType.DIVIDE:
      return param1 / param2;
    case TokenType.SQRT:
      return Math.sqrt(param1);
    case TokenType.LOG:
      return Math.log10(param1);
    case TokenType.ABS:
      return Math.abs(param1);
    case TokenType.SIN:
      return Math.sin(param1);
    case TokenType.COS:
      return Math.cos(param1);
    case TokenType.TAN:
      return Math.tan(param1);
    case TokenType.POW:
      return Math.pow(param1, param2);
    case TokenType.LN:
      return Math.log(param1);
    default:
      return 0;
  }
}

export function simplifyFunction(function_: FunctionToken[]): FunctionToken[] {
  const state = { readLocation: 0 };
  return simplifyRec(function_, state);
}

export function makeRandomTokens(gameMode: number): FunctionToken[] {
  const newSize = Math.floor(Math.abs(gaussian()) * 10);
  const function_: FunctionToken[] = new Array(newSize);
  for (let i = 0; i < newSize; i++) {
    function_[i] = getRandomToken(gameMode);
  }
  return adjustFunction(function_, gameMode);
}

function adjustFunction(function_: FunctionToken[], gameMode: number): FunctionToken[] {
  let valuesNeeded = 1;
  let cut = -1;
  for (let i = 0; i < function_.length; i++) {
    if (isOperation(function_[i].type)) {
      valuesNeeded += getNumParam(function_[i].type) - 1;
    } else {
      valuesNeeded--;
    }
    if (valuesNeeded === 0) {
      cut = i + 1;
      break;
    }
  }

  let result: FunctionToken[];
  if (cut !== -1) {
    result = function_.slice(0, cut);
  } else {
    const oldSize = function_.length;
    const newSize = oldSize + valuesNeeded;
    result = function_.slice(0);
    for (let i = oldSize; i < newSize; i++) {
      result.push(getRandomValueToken(gameMode));
    }
  }
  return result;
}

function getRandomValueToken(gameMode: number): FunctionToken {
  let token: FunctionToken;
  if (Math.random() < 0.5) {
    switch (gameMode) {
      case 0:
        token = makeToken(TokenType.VARIABLE1);
        break;
      case 1:
        token = Math.random() < 0.5 ? makeToken(TokenType.VARIABLE1) : makeToken(TokenType.VARIABLE2);
        break;
      default:
        if (Math.floor(Math.random() * 3) === 0) {
          token = makeToken(TokenType.VARIABLE1);
        } else if (Math.random() < 0.5) {
          token = makeToken(TokenType.VARIABLE2);
        } else {
          token = makeToken(TokenType.VARIABLE3);
        }
        break;
    }
  } else {
    token = makeValueToken(gaussian() * 10.2);
  }
  return token;
}

function getRandomToken(gameMode: number): FunctionToken {
  if (Math.random() < 0.5) {
    return getRandomValueToken(gameMode);
  }
  return makeToken(getRandomOperator());
}

function getRandomOperator(): TokenTypeValue {
  switch (Math.floor(Math.random() * 19)) {
    case 0:
      return TokenType.SQRT;
    case 1:
      return TokenType.LOG;
    case 2:
      return TokenType.ABS;
    case 3:
      return TokenType.SIN;
    case 4:
      return TokenType.COS;
    case 5:
      return TokenType.TAN;
    case 6:
      return TokenType.LN;
    case 7:
    case 8:
    case 9:
    case 10:
      return TokenType.ADD;
    case 11:
    case 12:
    case 13:
      return TokenType.MULTIPLY;
    case 14:
    case 15:
    case 16:
      return TokenType.DIVIDE;
    default:
      return TokenType.POW;
  }
}

export function mutateFunction(function1: FunctionToken[], gameMode: number): FunctionToken[] {
  if (Math.random() < 0.5) {
    return mutateFineTune(function1, gameMode);
  }
  return mutateRegion(function1, gameMode);
}

function mutateRegion(function1: FunctionToken[], gameMode: number): FunctionToken[] {
  const lengthOut = Math.floor(Math.abs(gaussian()) * 5);
  const lengthIn = Math.floor(Math.abs(gaussian()) * 5);
  const len1 = function1.length;
  const outLocMax = lengthOut > len1 ? len1 : lengthOut;
  const newSize = len1 - outLocMax + lengthIn;
  const outLocation = Math.floor(Math.random() * (len1 - outLocMax + 1));
  const function_: FunctionToken[] = new Array(newSize);
  for (let i = 0; i < outLocation; i++) {
    function_[i] = cloneToken(function1[i]);
  }
  for (let i = 0; i < lengthIn; i++) {
    function_[outLocation + i] = getRandomToken(gameMode);
  }
  for (let i = 0; i < len1 - outLocMax - outLocation; i++) {
    function_[outLocation + lengthIn + i] = cloneToken(function1[outLocation + outLocMax + i]);
  }
  return adjustFunction(function_, gameMode);
}

function mutateFineTune(function1: FunctionToken[], gameMode: number): FunctionToken[] {
  const newFunction = clonePolishFunction(function1);
  let numValues = 0;
  for (const t of newFunction) {
    if (t.type === TokenType.VALUE) numValues++;
  }
  if (numValues === 0) {
    return makeRandomTokens(gameMode);
  }
  let mutatedValue = Math.floor(Math.random() * numValues);
  for (let i = 0; i < newFunction.length; i++) {
    if (newFunction[i].type === TokenType.VALUE) {
      if (mutatedValue === 0) {
        if (Math.random() < 0.5) {
          newFunction[i] = makeValueToken(gaussian() * 10.2);
        } else {
          newFunction[i] = makeValueToken(newFunction[i].value * (gaussian() + 1));
        }
        break;
      }
      mutatedValue--;
    }
  }
  return newFunction;
}

export function crossoverFunctions(
  function1: FunctionToken[],
  function2: FunctionToken[],
  gameMode: number
): FunctionToken[] {
  let f1 = function1;
  let f2 = function2;
  if (Math.random() < 0.5) {
    const temp = f1;
    f1 = f2;
    f2 = temp;
  }
  const lengthCopy1 = Math.floor(Math.abs(gaussian()) * 5);
  const lengthCopy2 = Math.floor(Math.abs(gaussian()) * 5);
  const length1 = f1.length;
  const length2 = f2.length;
  const lc1 = lengthCopy1 > length1 ? length1 : lengthCopy1;
  const lc2 = lengthCopy2 > length2 ? length2 : lengthCopy2;
  const copyLocation1 = Math.floor(Math.random() * (length1 - lc1 + 1));
  const copyLocation2 = Math.floor(Math.random() * (length2 - lc2 + 1));
  const newSize = length1 - lc1 + lc2;
  const function_: FunctionToken[] = new Array(newSize);
  for (let i = 0; i < copyLocation1; i++) {
    function_[i] = cloneToken(f1[i]);
  }
  for (let i = 0; i < lc2; i++) {
    function_[copyLocation1 + i] = cloneToken(f2[copyLocation2 + i]);
  }
  for (let i = 0; i < length1 - lc1 - copyLocation1; i++) {
    function_[copyLocation1 + lc2 + i] = cloneToken(f1[copyLocation1 + lc1 + i]);
  }
  return adjustFunction(function_, gameMode);
}

export function gaussian(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}