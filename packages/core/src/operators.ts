import { Distribution, mergeLabels, type Label } from "./distribution.js";
import { Pmf } from "./pmf.js";

export interface BinaryOperator {
  /** Text used when a roll is shown. */
  symbol: string;
  /** Higher binds tighter. */
  precedence: number;
  comparison?: boolean;
  apply(a: number, b: number): number;
  /** Optional fast path for distributions. */
  pmf?(a: Pmf, b: Pmf): Pmf;
}

export interface Rolled {
  value: number;
  label: Label;
  text: string;
}

export interface DiceFunction {
  minArgs: number;
  maxArgs: number;
  distribution(args: Distribution[]): Distribution;
  /** Each argument is a function that rolls that argument again. */
  roll(args: (() => Rolled)[]): Rolled;
}

export const PRECEDENCE = { comparison: 1, additive: 2, multiplicative: 3 } as const;

/** Binary operators by token. Identifiers such as `ac` are lowercase. */
export const operators = new Map<string, BinaryOperator>();

/** Functions by lowercase name. */
export const functions = new Map<string, DiceFunction>();

export function defineOperator(token: string, op: BinaryOperator): void {
  operators.set(token.toLowerCase(), op);
}

export function defineFunction(name: string, fn: DiceFunction): void {
  functions.set(name.toLowerCase(), fn);
}

defineOperator("+", {
  symbol: "+",
  precedence: PRECEDENCE.additive,
  apply: (a, b) => a + b,
  pmf: (a, b) => a.add(b),
});
defineOperator("-", {
  symbol: "-",
  precedence: PRECEDENCE.additive,
  apply: (a, b) => a - b,
  pmf: (a, b) => a.add(b.negate()),
});
defineOperator("*", {
  symbol: "*",
  precedence: PRECEDENCE.multiplicative,
  apply: (a, b) => a * b,
});
defineOperator("/", {
  symbol: "/",
  precedence: PRECEDENCE.multiplicative,
  apply: (a, b) => {
    if (b === 0) throw new RangeError("division by zero");
    return Math.floor(a / b);
  },
});

const comparisons: [string[], string, (a: number, b: number) => boolean][] = [
  [[">="], ">=", (a, b) => a >= b],
  [["ac"], "AC", (a, b) => a >= b],
  [["dc"], "DC", (a, b) => a >= b],
  [[">"], ">", (a, b) => a > b],
  [["<="], "<=", (a, b) => a <= b],
  [["<"], "<", (a, b) => a < b],
  [["=", "=="], "=", (a, b) => a === b],
  [["!="], "!=", (a, b) => a !== b],
];
for (const [tokens, symbol, test] of comparisons) {
  for (const token of tokens) {
    defineOperator(token, {
      symbol,
      precedence: PRECEDENCE.comparison,
      comparison: true,
      apply: (a, b) => (test(a, b) ? 1 : 0),
    });
  }
}

function pick(name: string, choose: (a: number, b: number) => number): DiceFunction {
  return {
    minArgs: 1,
    maxArgs: Infinity,
    distribution: (args) =>
      args.reduce((a, b) => Distribution.combine(a, b, (x, y) => Pmf.map2(x, y, choose))),
    roll: (args) => rollPick(name, args.map((r) => r()), choose),
  };
}

function twice(name: string, choose: (a: number, b: number) => number): DiceFunction {
  return {
    minArgs: 1,
    maxArgs: 1,
    distribution: ([a]) => Distribution.combine(a!, a!, (x, y) => Pmf.map2(x, y, choose)),
    roll: ([r]) => rollPick(name, [r!(), r!()], choose),
  };
}

function rollPick(name: string, rolls: Rolled[], choose: (a: number, b: number) => number): Rolled {
  const best = rolls.reduce((a, b) => (choose(a.value, b.value) === a.value ? a : b));
  const label = rolls.reduce<Label>((l, r) => mergeLabels(l, r.label), "");
  return { value: best.value, label, text: `${name}(${rolls.map((r) => r.text).join(", ")})` };
}

defineFunction("max", pick("max", Math.max));
defineFunction("min", pick("min", Math.min));
defineFunction("adv", twice("adv", Math.max));
defineFunction("dis", twice("dis", Math.min));
