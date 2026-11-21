import type { Node } from "./ast.js";
import type { Distribution, Label } from "./distribution.js";
import { Evaluator, type Options } from "./evaluate.js";
import { parseNode } from "./parser.js";
import { Roller, type Rng } from "./roll.js";

export interface RollResult {
  total: number;
  label: Label;
  /** The expression with each die result, e.g. `4kh3d6 [6, 4, 3, (1)] + 2`. */
  text: string;
}

export class Expression {
  private readonly evaluator: Evaluator;

  constructor(
    readonly source: string,
    readonly ast: Node,
    options: Options = {},
  ) {
    this.evaluator = new Evaluator(options);
  }

  distribution(): Distribution {
    return this.evaluator.dist(this.ast);
  }

  roll(rng: Rng = Math.random): RollResult {
    const r = new Roller(rng, this.evaluator).roll(this.ast);
    return { total: r.value, label: r.label, text: r.text };
  }
}

export function parse(source: string, options: Options = {}): Expression {
  return new Expression(source, parseNode(source), options);
}

export type { Node } from "./ast.js";
export type { Options } from "./evaluate.js";
export { Distribution, LABELS, type Label, type Outcome } from "./distribution.js";
export { ParseError } from "./parser.js";
export { Pmf } from "./pmf.js";
export { keep } from "./keep.js";
export type { Rng } from "./roll.js";
export {
  defineFunction,
  defineOperator,
  functions,
  operators,
  PRECEDENCE,
  type BinaryOperator,
  type DiceFunction,
  type Rolled,
} from "./operators.js";
