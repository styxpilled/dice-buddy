import type { BinaryNode, CondNode, DiceNode, Node } from "./ast.js";
import { Distribution, type Label } from "./distribution.js";
import { keep } from "./keep.js";
import { functions, operators, type BinaryOperator } from "./operators.js";
import { Pmf } from "./pmf.js";

export const MAX_DICE = 10_000;

export interface Options {
  /** For AC, a natural 1 always misses and a natural 20 always hits. Default true. */
  naturalRolls?: boolean;
}

interface Range {
  lo: number;
  hi: number;
}

export class Evaluator {
  private readonly cache = new Map<Node, Distribution>();

  constructor(readonly options: Options = {}) {}

  /** The range of the left side when natural roll rules apply to `op`, else null. */
  naturalRange(op: BinaryOperator, left: Node): Range | null {
    if (!op.natural || this.options.naturalRolls === false) return null;
    const { min: lo, max: hi } = this.dist(left).pmf();
    return lo < hi ? { lo, hi } : null;
  }

  dist(node: Node): Distribution {
    let d = this.cache.get(node);
    if (!d) this.cache.set(node, (d = this.compute(node)));
    return d;
  }

  private compute(node: Node): Distribution {
    switch (node.type) {
      case "num":
        return Distribution.constant(node.value);
      case "group":
        return this.dist(node.expr);
      case "neg":
        return this.dist(node.expr).map((p) => p.negate());
      case "binary": {
        const op = operatorOf(node);
        const left = this.dist(node.left);
        const range = this.naturalRange(op, node.left);
        let f = op.pmf ?? ((a: Pmf, b: Pmf) => Pmf.map2(a, b, op.apply));
        if (range) f = (a, b) => compare(op, a, b, range);
        return Distribution.combine(left, this.dist(node.right), f);
      }
      case "call":
        return functions.get(node.name)!.distribution(node.args.map((a) => this.dist(a)));
      case "dice":
        return this.dice(node);
      case "cond":
        return this.cond(node);
    }
  }

  private dice(node: DiceNode): Distribution {
    const die = dieOf(node);
    const memo = new Map<number, Pmf>();
    const sumOf = (n: number): Pmf => {
      let pmf = memo.get(n);
      if (!pmf) {
        checkCount(n);
        pmf = node.keep ? keep(die, n, node.keep.count, node.keep.highest) : die.repeat(n);
        memo.set(n, pmf);
      }
      return pmf;
    };
    if (!node.count) return Distribution.of(sumOf(1));

    const items: [Distribution, number][] = [];
    for (const [label, counts] of this.dist(node.count).parts) {
      for (const [n, p] of counts) items.push([Distribution.of(sumOf(n), label), p]);
    }
    return Distribution.mix(items);
  }

  private cond(node: CondNode): Distribution {
    const branches: [Distribution, number, Label][] = [];
    let truth: Pmf;
    if (node.crit) {
      const test = node.test as BinaryNode;
      const op = operatorOf(test);
      const left = this.dist(test.left).pmf();
      const threshold = critThreshold(left, node.crit.top);
      const critWeight = left.filter((v) => v >= threshold).total();
      if (critWeight) branches.push([this.dist(node.crit.expr), critWeight, "crit"]);
      const rest = left.filter((v) => v < threshold);
      truth = compare(op, rest, this.dist(test.right).pmf(), this.naturalRange(op, test.left));
    } else {
      truth = this.dist(node.test).pmf();
    }
    const pFalse = truth.get(0);
    const pTrue = truth.total() - pFalse;
    if (pTrue) branches.push([this.dist(node.then), pTrue, ""]);
    if (pFalse) branches.push([node.else ? this.dist(node.else) : Distribution.constant(0), pFalse, "fail"]);
    return Distribution.mix(branches);
  }
}

function compare(op: BinaryOperator, a: Pmf, b: Pmf, range: Range | null): Pmf {
  if (!range) return Pmf.map2(a, b, op.apply);
  const { lo, hi } = range;
  return Pmf.mix([
    [Pmf.map2(a.filter((v) => v !== lo && v !== hi), b, op.apply), 1],
    [Pmf.point(0), a.get(lo) * b.total()],
    [Pmf.point(1), a.get(hi) * b.total()],
  ]);
}

/** Result of `op` for one roll, with natural roll rules. */
export function applyNatural(op: BinaryOperator, l: number, r: number, range: Range | null): number {
  if (range && l === range.lo) return 0;
  if (range && l === range.hi) return 1;
  return op.apply(l, r);
}

export function operatorOf(node: BinaryNode): BinaryOperator {
  return operators.get(node.op)!;
}

export function dieOf(node: DiceNode): Pmf {
  const die = Pmf.uniform(1, node.sides);
  if (!node.reroll) return die;
  const { op, value } = node.reroll;
  const test = operators.get(op)!.apply;
  const rerolled = die.filter((v) => test(v, value) === 1).total();
  return Pmf.mix([
    [die.filter((v) => test(v, value) === 0), 1],
    [die, rerolled],
  ]);
}

/** The lowest of the `top` highest values. */
export function critThreshold(pmf: Pmf, top: number): number {
  const values = [...pmf].map(([v]) => v);
  return values[Math.max(0, values.length - top)] ?? pmf.min;
}

export function checkCount(n: number): void {
  if (n < 0) throw new RangeError("dice count can not be negative");
  if (n > MAX_DICE) throw new RangeError(`dice count can not be more than ${MAX_DICE}`);
}
