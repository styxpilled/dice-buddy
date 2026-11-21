import { alloc, Pmf } from "./pmf.js";

/**
 * Sum of the `k` highest (or lowest) of `n` independent rolls of `die`.
 *
 * Faces are visited from best to worst. For each face we choose how many of
 * the remaining dice show it; the first `k` dice placed are the kept ones.
 * State: dice placed so far, and the sum of the kept dice.
 * Cost is O(faces * n^2 * range) in place of O(faces^n).
 */
export function keep(die: Pmf, n: number, k: number, highest: boolean): Pmf {
  if (k >= n) return die.repeat(n);
  if (k <= 0) return Pmf.point(0);

  const faces = [...die.normalize()];
  if (highest) faces.reverse();

  const lo = Math.min(0, k * die.min);
  const size = Math.max(0, k * die.max) - lo + 1;
  const binom = binomials(n);

  let dp: (Float64Array | undefined)[] = [];
  dp[0] = alloc(size);
  dp[0][-lo] = 1;

  for (const [face, q] of faces) {
    const next: (Float64Array | undefined)[] = [];
    const powers = [1];
    for (let t = 1; t <= n; t++) powers[t] = powers[t - 1] * q;

    for (let placed = 0; placed <= n; placed++) {
      const row = dp[placed];
      if (!row) continue;
      for (let t = 0; placed + t <= n; t++) {
        const w = binom[n - placed][t] * powers[t];
        if (w === 0) break;
        const shift = (Math.min(placed + t, k) - Math.min(placed, k)) * face;
        const target = (next[placed + t] ??= alloc(size));
        const from = Math.max(0, -shift);
        const to = Math.min(size, size - shift);
        for (let s = from; s < to; s++) {
          const x = row[s];
          if (x !== 0) target[s + shift] += x * w;
        }
      }
    }
    dp = next;
  }

  return Pmf.fromArray(lo, dp[n] ?? alloc(0));
}

function binomials(n: number): number[][] {
  const rows: number[][] = [[1]];
  for (let i = 1; i <= n; i++) {
    const prev = rows[i - 1];
    const row = [1];
    for (let j = 1; j < i; j++) row[j] = prev[j - 1] + prev[j];
    row[i] = 1;
    rows.push(row);
  }
  return rows;
}
