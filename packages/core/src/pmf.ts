export const MAX_RANGE = 10_000_000;

/**
 * Weights over a contiguous range of integers, starting at `min`.
 * Weights need not sum to 1: a part of a mixture holds only its own share.
 */
export class Pmf {
  private constructor(
    readonly min: number,
    readonly weights: Float64Array,
  ) {}

  static readonly empty = new Pmf(0, new Float64Array(0));

  static point(value: number, weight = 1): Pmf {
    return new Pmf(value, Float64Array.of(weight));
  }

  static uniform(lo: number, hi: number): Pmf {
    const w = alloc(hi - lo + 1);
    w.fill(1 / w.length);
    return new Pmf(lo, w);
  }

  /** Takes ownership of `weights` and trims zero weights at both ends. */
  static fromArray(min: number, weights: Float64Array): Pmf {
    let lo = 0;
    let hi = weights.length - 1;
    while (lo <= hi && weights[lo] === 0) lo++;
    while (hi >= lo && weights[hi] === 0) hi--;
    if (lo > hi) return Pmf.empty;
    if (lo === 0 && hi === weights.length - 1) return new Pmf(min, weights);
    return new Pmf(min + lo, weights.slice(lo, hi + 1));
  }

  static fromMap(map: Map<number, number>): Pmf {
    if (!map.size) return Pmf.empty;
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of map.keys()) {
      if (!Number.isSafeInteger(v)) throw new RangeError(`non-integer result: ${v}`);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const w = alloc(hi - lo + 1);
    for (const [v, p] of map) w[v - lo] += p;
    return Pmf.fromArray(lo, w);
  }

  /** Weighted sum of several PMFs. */
  static mix(items: Iterable<readonly [Pmf, number]>): Pmf {
    const list = [...items].filter(([pmf, w]) => w !== 0 && !pmf.isEmpty);
    if (!list.length) return Pmf.empty;
    const lo = Math.min(...list.map(([p]) => p.min));
    const hi = Math.max(...list.map(([p]) => p.max));
    const out = alloc(hi - lo + 1);
    for (const [pmf, w] of list) {
      const off = pmf.min - lo;
      for (let i = 0; i < pmf.weights.length; i++) out[off + i] += pmf.weights[i] * w;
    }
    return Pmf.fromArray(lo, out);
  }

  /** Applies `f` to every pair of values, as for two independent rolls. */
  static map2(a: Pmf, b: Pmf, f: (x: number, y: number) => number): Pmf {
    const out = new Map<number, number>();
    for (const [x, px] of a) {
      for (const [y, py] of b) {
        const v = f(x, y);
        out.set(v, (out.get(v) ?? 0) + px * py);
      }
    }
    return Pmf.fromMap(out);
  }

  get max(): number {
    return this.min + this.weights.length - 1;
  }

  get isEmpty(): boolean {
    return this.weights.length === 0;
  }

  /** Non-zero entries in ascending order of value. */
  *[Symbol.iterator](): IterableIterator<[number, number]> {
    for (let i = 0; i < this.weights.length; i++) {
      const w = this.weights[i];
      if (w !== 0) yield [this.min + i, w];
    }
  }

  get(value: number): number {
    return this.weights[value - this.min] ?? 0;
  }

  total(): number {
    let t = 0;
    for (const w of this.weights) t += w;
    return t;
  }

  scale(k: number): Pmf {
    return Pmf.fromArray(this.min, this.weights.map((w) => w * k));
  }

  normalize(): Pmf {
    const t = this.total();
    return t ? this.scale(1 / t) : this;
  }

  /** Keeps only the weight of the values that match `pred`. */
  filter(pred: (value: number) => boolean): Pmf {
    const w = this.weights.map((x, i) => (pred(this.min + i) ? x : 0));
    return Pmf.fromArray(this.min, w);
  }

  map(f: (value: number) => number): Pmf {
    const out = new Map<number, number>();
    for (const [v, p] of this) {
      const r = f(v);
      out.set(r, (out.get(r) ?? 0) + p);
    }
    return Pmf.fromMap(out);
  }

  /** Sum of two independent rolls (convolution). */
  add(b: Pmf): Pmf {
    if (this.isEmpty || b.isEmpty) return Pmf.empty;
    const a = this.weights;
    const bw = b.weights;
    const out = alloc(a.length + bw.length - 1);
    for (let i = 0; i < a.length; i++) {
      const x = a[i];
      if (x === 0) continue;
      for (let j = 0; j < bw.length; j++) out[i + j] += x * bw[j];
    }
    return Pmf.fromArray(this.min + b.min, out);
  }

  negate(): Pmf {
    return Pmf.fromArray(-this.max, this.weights.slice().reverse());
  }

  /** Sum of `n` independent rolls, by repeated doubling. */
  repeat(n: number): Pmf {
    let result = Pmf.point(0);
    let base: Pmf = this;
    while (n > 0) {
      if (n & 1) result = result.add(base);
      n >>>= 1;
      if (n) base = base.add(base);
    }
    return result;
  }
}

export function alloc(length: number): Float64Array {
  if (length > MAX_RANGE) throw new RangeError("result range is too large");
  return new Float64Array(length);
}
