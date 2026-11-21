import { Pmf } from "./pmf.js";

/** Outcome labels, from lowest to highest priority. "" is a plain outcome. */
export const LABELS = ["", "fail", "crit"] as const;
export type Label = (typeof LABELS)[number];

export function mergeLabels(a: Label, b: Label): Label {
  return LABELS.indexOf(a) >= LABELS.indexOf(b) ? a : b;
}

export interface Outcome {
  value: number;
  probability: number;
  /** Probability of this value per label. */
  byLabel: Partial<Record<Label, number>>;
}

/** A probability distribution over integers. Each label holds a part of it. */
export class Distribution {
  constructor(readonly parts: ReadonlyMap<Label, Pmf>) {}

  static of(pmf: Pmf, label: Label = ""): Distribution {
    return new Distribution(new Map([[label, pmf]]));
  }

  static constant(value: number): Distribution {
    return Distribution.of(Pmf.point(value));
  }

  /** Weighted sum of distributions. A label, if given, is merged into each part. */
  static mix(items: Iterable<readonly [Distribution, number, Label?]>): Distribution {
    const acc = new Map<Label, [Pmf, number][]>();
    for (const [dist, w, label = ""] of items) {
      for (const [l, pmf] of dist.parts) {
        const key = mergeLabels(l, label);
        let list = acc.get(key);
        if (!list) acc.set(key, (list = []));
        list.push([pmf, w]);
      }
    }
    return Distribution.build(acc);
  }

  /** Combines every part of `a` with every part of `b`. */
  static combine(a: Distribution, b: Distribution, f: (x: Pmf, y: Pmf) => Pmf): Distribution {
    const acc = new Map<Label, [Pmf, number][]>();
    for (const [la, pa] of a.parts) {
      for (const [lb, pb] of b.parts) {
        const key = mergeLabels(la, lb);
        let list = acc.get(key);
        if (!list) acc.set(key, (list = []));
        list.push([f(pa, pb), 1]);
      }
    }
    return Distribution.build(acc);
  }

  private static build(acc: Map<Label, [Pmf, number][]>): Distribution {
    const parts = new Map<Label, Pmf>();
    for (const label of LABELS) {
      const list = acc.get(label);
      if (!list) continue;
      const pmf = list.length === 1 && list[0]![1] === 1 ? list[0]![0] : Pmf.mix(list);
      if (!pmf.isEmpty) parts.set(label, pmf);
    }
    return new Distribution(parts);
  }

  map(f: (pmf: Pmf) => Pmf): Distribution {
    const parts = new Map<Label, Pmf>();
    for (const [l, pmf] of this.parts) {
      const r = f(pmf);
      if (!r.isEmpty) parts.set(l, r);
    }
    return new Distribution(parts);
  }

  /** All parts as one PMF. */
  pmf(): Pmf {
    if (this.parts.size === 1) return this.parts.values().next().value!;
    return Pmf.mix([...this.parts.values()].map((p) => [p, 1] as const));
  }

  get min(): number {
    return this.pmf().min;
  }

  get max(): number {
    return this.pmf().max;
  }

  total(): number {
    return this.pmf().total();
  }

  mean(): number {
    let sum = 0;
    for (const [v, p] of this.pmf()) sum += v * p;
    return sum;
  }

  stdev(): number {
    const mean = this.mean();
    let sum = 0;
    for (const [v, p] of this.pmf()) sum += (v - mean) ** 2 * p;
    return Math.sqrt(sum);
  }

  /** Probability of each possible value, in ascending order. */
  outcomes(): Outcome[] {
    const result: Outcome[] = [];
    for (const [value, probability] of this.pmf()) {
      const byLabel: Partial<Record<Label, number>> = {};
      for (const [l, pmf] of this.parts) {
        const p = pmf.get(value);
        if (p) byLabel[l] = p;
      }
      result.push({ value, probability, byLabel });
    }
    return result;
  }
}
