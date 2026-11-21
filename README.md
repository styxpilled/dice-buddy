# dice-buddy

`dice-buddy` is a dice expression library which parses dice expressions (`8d6`,
`4kh3d6`, `d20 + 6 DC 15`), allows you to roll them and builds bar charts with
possible results, without using a naive, brute-force approach.

## Usage

```ts
import { parse } from "dice-buddy";

const attack = parse("d20 + 5 AC 15 ? 1d8 + 3 crit 2d8 + 3");

attack.distribution().mean(); // 4.35
attack.distribution().outcomes(); // [{ value, probability, byLabel: { "", fail, crit } }, ...]
attack.roll(); // { total: 9, label: "", text: "d20 [14] + 5 AC 15 → success: 1d8 [6] + 3" }
```

## Syntax

Operators have standard precedence: comparisons are lowest, then `+ -`, then
`* /`.

| Syntax                                       | Meaning                                                                     |
| -------------------------------------------- | --------------------------------------------------------------------------- |
| `d20`, `3d6`, `(d4)d6`                       | Dice. The count can be a roll.                                              |
| `4kh3d6`, `4d6kh3`, `2kl1d20`                | Keep the highest or lowest dice.                                            |
| `d20ro1`, `2d6ro<3`                          | Reroll a die once when it matches.                                          |
| `+ - * /`                                    | Arithmetic. `/` rounds down.                                                |
| `AC DC >= > <= < = !=`                       | Comparison. 1 when true, 0 when false. `AC` and `DC` mean `>=`.             |
| `test ? a : b`                               | `a` when the test is not 0, else `b`. Without `: b`, else 0.                |
| `test ? a crit x`, `crit[2] x`               | `x` when the left side of the test rolls its highest (or 2 highest) values. |
| `adv(x)`, `dis(x)`, `max(a, b)`, `min(a, b)` | Functions.                                                                  |

Outcomes from a `crit` branch have the label `crit`. Outcomes from a failed test
have the label `fail`. Labels stay on the outcomes through later operations, so
a chart can show them in a different color.

## Extending

Operators and functions come from registries. The parser reads them, so a new
entry is available at once:

```ts
import {
  defineFunction,
  defineOperator,
  Distribution,
  Pmf,
  PRECEDENCE,
} from "dice-buddy";

defineOperator("%", {
  symbol: "%",
  precedence: PRECEDENCE.multiplicative,
  apply: (a, b) => a % b,
});

defineFunction("abs", {
  minArgs: 1,
  maxArgs: 1,
  distribution: ([x]) => x.map((pmf) => pmf.map(Math.abs)),
  roll: ([x]) => {
    const r = x();
    return { ...r, value: Math.abs(r.value), text: `abs(${r.text})` };
  },
});
```

## How it is fast

- Distributions are dense arrays of float probabilities, so they do not
  overflow.
- `NdX` uses repeated doubling of the convolution.
- Keep highest and lowest use dynamic programming over faces, in O(faces × n² ×
  range) time in place of O(facesⁿ).

## Development

```sh
pnpm install
pnpm test      # core tests
pnpm dev       # website at http://localhost:4321
pnpm build     # library and website
```

The website deploys to GitHub Pages from `main`
(`.github/workflows/deploy.yml`). Set Pages to use GitHub Actions in the
repository settings.
