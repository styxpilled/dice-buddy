import type { CondNode, DiceNode, Node } from "./ast.js";
import { mergeLabels, type Label } from "./distribution.js";
import { checkCount, critThreshold, operatorOf, type Evaluator } from "./evaluate.js";
import { functions, operators, type Rolled } from "./operators.js";

export type Rng = () => number;

export class Roller {
  constructor(
    private readonly rng: Rng,
    private readonly evaluator: Evaluator,
  ) {}

  roll(node: Node): Rolled {
    switch (node.type) {
      case "num":
        return { value: node.value, label: "", text: String(node.value) };
      case "group": {
        const r = this.roll(node.expr);
        return { ...r, text: `(${r.text})` };
      }
      case "neg": {
        const r = this.roll(node.expr);
        return { ...r, value: -r.value, text: `-${r.text}` };
      }
      case "binary": {
        const op = operatorOf(node);
        const l = this.roll(node.left);
        const r = this.roll(node.right);
        return {
          value: op.apply(l.value, r.value),
          label: mergeLabels(l.label, r.label),
          text: `${l.text} ${op.symbol} ${r.text}`,
        };
      }
      case "call":
        return functions.get(node.name)!.roll(node.args.map((a) => () => this.roll(a)));
      case "dice":
        return this.dice(node);
      case "cond":
        return this.cond(node);
    }
  }

  private die(sides: number): number {
    return 1 + Math.floor(this.rng() * sides);
  }

  private dice(node: DiceNode): Rolled {
    const count = node.count ? this.roll(node.count) : null;
    const n = count ? count.value : 1;
    checkCount(n);

    const rolls: { value: number; first?: number; kept: boolean }[] = [];
    const rerollTest = node.reroll && operators.get(node.reroll.op)!.apply;
    for (let i = 0; i < n; i++) {
      const value = this.die(node.sides);
      if (rerollTest && rerollTest(value, node.reroll!.value)) {
        rolls.push({ value: this.die(node.sides), first: value, kept: true });
      } else {
        rolls.push({ value, kept: true });
      }
    }
    if (node.keep) {
      const { highest, count: k } = node.keep;
      const order = rolls.map((_, i) => i).sort((a, b) => (rolls[b]!.value - rolls[a]!.value) * (highest ? 1 : -1));
      for (const i of order.slice(k)) rolls[i]!.kept = false;
    }

    const value = rolls.reduce((sum, r) => sum + (r.kept ? r.value : 0), 0);
    const shown = rolls.map((r) => {
      const v = r.kept ? String(r.value) : `(${r.value})`;
      return r.first === undefined ? v : `(${r.first}) ${v}`;
    });

    let prefix = "";
    if (count && node.count) {
      prefix = node.count.type === "num" || node.count.type === "group" ? count.text : `(${count.text})`;
    }
    const keepText = node.keep ? `${node.keep.highest ? "kh" : "kl"}${node.keep.count}` : "";
    const rerollText = node.reroll ? `ro${node.reroll.op === "=" ? "" : node.reroll.op}${node.reroll.value}` : "";
    return {
      value,
      label: count?.label ?? "",
      text: `${prefix}${keepText}d${node.sides}${rerollText} [${shown.join(", ")}]`,
    };
  }

  private cond(node: CondNode): Rolled {
    let testText: string;
    let outcome: "crit" | "success" | "failure";
    if (node.crit && node.test.type === "binary") {
      const op = operatorOf(node.test);
      const l = this.roll(node.test.left);
      const r = this.roll(node.test.right);
      testText = `${l.text} ${op.symbol} ${r.text}`;
      const threshold = critThreshold(this.evaluator.dist(node.test.left).pmf(), node.crit.top);
      if (l.value >= threshold) outcome = "crit";
      else outcome = op.apply(l.value, r.value) ? "success" : "failure";
    } else {
      const t = this.roll(node.test);
      testText = t.text;
      outcome = t.value !== 0 ? "success" : "failure";
    }

    const branch = outcome === "crit" ? node.crit!.expr : outcome === "success" ? node.then : node.else;
    const b: Rolled = branch ? this.roll(branch) : { value: 0, label: "", text: "0" };
    const label: Label = outcome === "crit" ? "crit" : outcome === "failure" ? "fail" : "";
    return {
      value: b.value,
      label: mergeLabels(b.label, label),
      text: `${testText} → ${outcome}: ${b.text}`,
    };
  }
}
