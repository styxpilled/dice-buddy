import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "../src/index.js";
import { uniformDie } from "../src/random.js";

function source(values: number[]): () => number {
  return () => values.shift()!;
}

/** Upper critical value of chi-squared at p = 0.0001 (Wilson-Hilferty). */
function chiSquaredLimit(dof: number): number {
  const z = 3.719;
  return dof * (1 - 2 / (9 * dof) + z * Math.sqrt(2 / (9 * dof))) ** 3;
}

describe("uniformDie", () => {
  it("rejects values in the last partial block", () => {
    // 2^32 % 3 = 1, so 2^32 - 1 is the only rejected value.
    expect(uniformDie(3, source([2 ** 32 - 1, 5]))).toBe(3);
    expect(uniformDie(3, source([2 ** 32 - 2]))).toBe(3);
    // d6 rejects the top 2^32 % 6 = 4 values.
    expect(uniformDie(6, source([2 ** 32 - 4, 2 ** 32 - 1, 0]))).toBe(1);
  });

  it("uses 53 bits for very large dice", () => {
    expect(uniformDie(2 ** 40, source([0, 7]))).toBe(8);
    expect(uniformDie(2 ** 40, source([2 ** 32 - 1, 2 ** 32 - 1]))).toBe(2 ** 40);
  });
});

describe("default rolls", () => {
  it.each([6, 20, 100])("give each face of a d%i the same share", (sides) => {
    const e = parse(`d${sides}`);
    const n = 2000 * sides;
    const counts = new Array<number>(sides + 1).fill(0);
    for (let i = 0; i < n; i++) counts[e.roll().total]!++;
    expect(counts[0]).toBe(0);
    const expected = n / sides;
    const chi = counts.slice(1).reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
    expect(chi).toBeLessThan(chiSquaredLimit(sides - 1));
  });
});

describe("without crypto", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("throws a clear error, and a custom rng still works", async () => {
    vi.stubGlobal("crypto", undefined);
    vi.resetModules();
    const { parse: freshParse } = await import("../src/index.js");
    expect(() => freshParse("d6").roll()).toThrow("pass an rng to roll()");
    expect(freshParse("d6").roll(() => 0.5).total).toBe(4);
    expect(freshParse("2d6").distribution().mean()).toBeCloseTo(7);
  });
});
