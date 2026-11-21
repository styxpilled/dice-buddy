import { describe, expect, it } from "vitest";
import { keep, parse, ParseError, Pmf, type Rng } from "../src/index.js";

const mean = (src: string) => parse(src).distribution().mean();
const prob = (src: string, value: number) => parse(src).distribution().pmf().get(value);

function seeded(seed: number): Rng {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bruteKeep(sides: number, n: number, k: number, highest: boolean): Map<number, number> {
  const out = new Map<number, number>();
  const total = sides ** n;
  for (let i = 0; i < total; i++) {
    const faces: number[] = [];
    for (let j = 0, x = i; j < n; j++, x = Math.floor(x / sides)) faces.push((x % sides) + 1);
    faces.sort((a, b) => (highest ? b - a : a - b));
    const sum = faces.slice(0, k).reduce((a, b) => a + b, 0);
    out.set(sum, (out.get(sum) ?? 0) + 1 / total);
  }
  return out;
}

describe("distribution", () => {
  it("handles basic dice", () => {
    expect(mean("d20")).toBeCloseTo(10.5);
    expect(prob("2d6", 7)).toBeCloseTo(6 / 36);
    expect(mean("3d6 + 2")).toBeCloseTo(12.5);
    expect(mean("d6 - d6")).toBeCloseTo(0);
    expect(mean("-d4")).toBeCloseTo(-2.5);
    expect(parse("d20").distribution().total()).toBeCloseTo(1);
  });

  it("follows precedence", () => {
    expect(mean("2 + 3 * 4")).toBe(14);
    expect(mean("(2 + 3) * 4")).toBe(20);
    expect(mean("7 / 2")).toBe(3);
    expect(mean("-7 / 2")).toBe(-4);
  });

  it("matches brute force for keep highest and lowest", () => {
    for (const [sides, n, k] of [[6, 4, 3], [4, 5, 2], [6, 3, 1], [3, 6, 4]] as const) {
      for (const highest of [true, false]) {
        const pmf = keep(Pmf.uniform(1, sides), n, k, highest);
        const expected = bruteKeep(sides, n, k, highest);
        for (const [v, p] of expected) expect(pmf.get(v)).toBeCloseTo(p, 12);
        expect(pmf.total()).toBeCloseTo(1, 12);
      }
    }
  });

  it("parses both keep forms", () => {
    expect(mean("4kh3d6")).toBeCloseTo(15869 / 1296, 10);
    expect(mean("4d6kh3")).toBeCloseTo(15869 / 1296, 10);
    expect(mean("2kh1d20")).toBeCloseTo(13.825);
    expect(mean("2kl1d20")).toBeCloseTo(7.175);
  });

  it("handles functions", () => {
    expect(mean("adv(d20)")).toBeCloseTo(13.825);
    expect(mean("dis(d20)")).toBeCloseTo(7.175);
    expect(mean("max(d6, 4)")).toBeCloseTo((4 * 4 + 5 + 6) / 6);
    expect(mean("min(d6, d6, d6)")).toBeCloseTo(mean("3kl1d6"));
  });

  it("rerolls once", () => {
    expect(mean("d20ro1")).toBeCloseTo(10.5 + 0.05 * 9.5);
    expect(mean("2d6ro<3")).toBeCloseTo(2 * (4 * 4.5 + 2 * 3.5) / 6);
    expect(mean("2d6ro<=2")).toBeCloseTo(mean("2d6ro<3"));
  });

  it("rolls a die for the dice count", () => {
    expect(mean("d4d6")).toBeCloseTo(2.5 * 3.5);
    expect(mean("(d4)d6")).toBeCloseTo(2.5 * 3.5);
    expect(prob("(d2 - 1)d6", 0)).toBeCloseTo(0.5);
  });

  it("compares", () => {
    expect(prob("d20 + 6 DC 15", 1)).toBeCloseTo(0.6);
    expect(prob("d20 + 6 dc 15", 0)).toBeCloseTo(0.4);
    expect(prob("d6 > d6", 1)).toBeCloseTo(15 / 36);
    expect(mean("3d6 = 10")).toBeCloseTo(27 / 216);
  });

  it("models an attack with a crit", () => {
    const d = parse("d20 + 5 AC 15 ? 1d8 + 3 crit 2d8 + 3").distribution();
    expect(d.mean()).toBeCloseTo(0.05 * 12 + 0.5 * 7.5);
    expect(d.parts.get("crit")!.total()).toBeCloseTo(0.05);
    expect(d.parts.get("fail")!.get(0)).toBeCloseTo(0.45);
    expect(mean("d20 + 5 AC 15 ? 1d8 + 3 : 0 crit[2] 2d8 + 3")).toBeCloseTo(0.1 * 12 + 0.45 * 7.5);
  });

  it("models a save for half damage", () => {
    expect(mean("d20 + 3 DC 15 ? 8d6 / 2 : 8d6")).toBeCloseTo(0.45 * 13.75 + 0.55 * 28);
  });

  it("keeps labels through later operations", () => {
    const d = parse("(d20 AC 11 ? 5 crit 10) + 1").distribution();
    expect(d.parts.get("crit")!.get(11)).toBeCloseTo(0.05);
    expect(d.parts.get("fail")!.get(1)).toBeCloseTo(0.5);
    expect(d.parts.get("")!.get(6)).toBeCloseTo(0.45);
  });

  it("handles large expressions", () => {
    const d = parse("40d20").distribution();
    expect(d.mean()).toBeCloseTo(420, 8);
    expect(d.total()).toBeCloseTo(1, 10);
    expect(parse("10kh5d20").distribution().total()).toBeCloseTo(1, 10);
  });
});

describe("parse errors", () => {
  it.each(["", "d", "2d", "d0", "4kh3", "(d6", "d6 +", "foo(1)", "adv(1, 2)", "d6 ? 1 crit 2", "2 $ 3", "kh1d6"])(
    "rejects %j",
    (src) => expect(() => parse(src)).toThrow(ParseError),
  );

  it("rejects division by zero", () => {
    expect(() => parse("d6 / (d2 - 1)").distribution()).toThrow(RangeError);
  });
});

describe("roll", () => {
  it("shows each die", () => {
    const r = parse("4kh3d6 + 2").roll(seeded(1));
    const m = r.text.match(/^4kh3d6 \[(.*)\] \+ 2$/)!;
    const dice = m[1]!.split(", ");
    expect(dice.filter((d) => d.startsWith("("))).toHaveLength(1);
    const kept = dice.filter((d) => !d.startsWith("(")).map(Number);
    expect(r.total).toBe(kept.reduce((a, b) => a + b) + 2);
  });

  it("shows the branch of a condition", () => {
    const r = parse("d20 + 5 AC 15 ? 1d8 + 3 crit 2d8 + 3").roll(seeded(3));
    expect(r.text).toMatch(/→ (crit|success|failure): /);
  });

  it("agrees with the distribution", () => {
    const exprs = [
      "4kh3d6 + 2",
      "adv(d20) + 3",
      "d20 + 5 AC 15 ? 1d8 + 3 : 1 crit[2] 2d8 + 3",
      "d20 + 3 DC 15 ? 8d6 / 2 : 8d6",
      "d4d6",
      "2d6ro<3",
      "max(d6, d8) - d4",
    ];
    for (const src of exprs) {
      const e = parse(src);
      const rng = seeded(42);
      const n = 20000;
      let sum = 0;
      for (let i = 0; i < n; i++) sum += e.roll(rng).total;
      const d = e.distribution();
      expect(Math.abs(sum / n - d.mean())).toBeLessThan((4 * d.stdev()) / Math.sqrt(n));
    }
  });
});
