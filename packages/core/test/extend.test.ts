import { expect, it } from "vitest";
import { defineFunction, defineOperator, parse, PRECEDENCE } from "../src/index.js";

it("accepts new operators and functions", () => {
  defineOperator("%", { symbol: "%", precedence: PRECEDENCE.multiplicative, apply: (a, b) => a % b });
  defineFunction("abs", {
    minArgs: 1,
    maxArgs: 1,
    distribution: ([x]) => x!.map((pmf) => pmf.map(Math.abs)),
    roll: ([x]) => {
      const r = x!();
      return { ...r, value: Math.abs(r.value), text: `abs(${r.text})` };
    },
  });
  expect(parse("1 + d6 % 2").distribution().pmf().get(2)).toBeCloseTo(0.5);
  expect(parse("abs(d6 - 7)").distribution().mean()).toBeCloseTo(3.5);
  expect(parse("abs(-3)").roll().text).toBe("abs(-3)");
});
