import type { CondNode, DiceNode, Node } from "./ast.js";
import { functions, operators } from "./operators.js";

export class ParseError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(`${message} at position ${position + 1}`);
    this.name = "ParseError";
  }
}

type TokenType = "num" | "ident" | "punct" | "end";
interface Token {
  type: TokenType;
  text: string;
  pos: number;
}

const PUNCT = ["(", ")", "?", ":", ",", "[", "]"];

function punctuation(): string[] {
  const symbols = [...operators.keys()].filter((t) => !/^[a-z]+$/.test(t));
  return [...PUNCT, ...symbols].sort((x, y) => y.length - x.length);
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  const punct = punctuation();
  const re = /\s+|(\d+)|([a-z]+)/y;
  let pos = 0;
  outer: while (pos < src.length) {
    re.lastIndex = pos;
    const m = re.exec(src);
    if (m) {
      if (m[1]) tokens.push({ type: "num", text: m[1], pos });
      else if (m[2]) tokens.push({ type: "ident", text: m[2], pos });
      pos = re.lastIndex;
      continue;
    }
    for (const p of punct) {
      if (src.startsWith(p, pos)) {
        tokens.push({ type: "punct", text: p, pos });
        pos += p.length;
        continue outer;
      }
    }
    throw new ParseError(`unexpected "${src[pos]}"`, pos);
  }
  tokens.push({ type: "end", text: "", pos });
  return tokens;
}

const REROLL_OPS = new Set(["<", "<=", ">", ">=", "=", "=="]);

class Parser {
  private i = 0;
  constructor(private readonly tokens: Token[]) {}

  private get peek(): Token {
    return this.tokens[this.i]!;
  }

  private next(): Token {
    return this.tokens[this.i++]!;
  }

  private is(text: string): boolean {
    return this.peek.type !== "num" && this.peek.text === text;
  }

  private eat(text: string): boolean {
    if (!this.is(text)) return false;
    this.i++;
    return true;
  }

  private expect(text: string): void {
    if (!this.eat(text)) this.fail(`expected "${text}"`);
  }

  private fail(message: string): never {
    const t = this.peek;
    throw new ParseError(t.type === "end" ? `${message}, found end of input` : `${message}, found "${t.text}"`, t.pos);
  }

  private int(): number {
    if (this.peek.type !== "num") this.fail("expected a number");
    return Number(this.next().text);
  }

  parseAll(): Node {
    const node = this.expr();
    if (this.peek.type !== "end") this.fail("unexpected input");
    return node;
  }

  private expr(): Node {
    const test = this.binary(0);
    if (!this.eat("?")) return test;
    const node: CondNode = { type: "cond", test, then: this.expr(), else: null, crit: null };
    for (;;) {
      if (!node.else && this.eat(":")) {
        node.else = this.expr();
      } else if (!node.crit && this.is("crit")) {
        const pos = this.next().pos;
        const isCompare = test.type === "binary" && operators.get(test.op)?.comparison;
        if (!isCompare) throw new ParseError("crit needs a comparison such as AC or DC", pos);
        let top = 1;
        if (this.eat("[")) {
          top = this.int();
          this.expect("]");
          if (top < 1) throw new ParseError("crit range must be at least 1", pos);
        }
        node.crit = { top, expr: this.expr() };
      } else {
        return node;
      }
    }
  }

  private binary(minPrec: number): Node {
    let left = this.unary();
    for (;;) {
      const t = this.peek;
      const op = t.type === "num" ? undefined : operators.get(t.text);
      if (!op || op.precedence < minPrec) return left;
      this.i++;
      const right = this.binary(op.precedence + 1);
      left = { type: "binary", op: t.text, left, right };
    }
  }

  private unary(): Node {
    if (this.eat("-")) return { type: "neg", expr: this.unary() };
    if (this.eat("+")) return this.unary();
    return this.dice();
  }

  private dice(): Node {
    let left: Node | null = this.is("d") ? null : this.atom();
    for (;;) {
      let keep: DiceNode["keep"] = null;
      if (left && (this.is("kh") || this.is("kl"))) keep = this.keep();
      if (!this.is("d")) {
        if (keep) this.fail('expected "d"');
        return left!;
      }
      this.i++;
      const sidesPos = this.peek.pos;
      const sides = this.int();
      if (sides < 1) throw new ParseError("a die needs at least 1 side", sidesPos);
      const node: DiceNode = { type: "dice", count: left, sides, keep, reroll: null };
      for (;;) {
        if (!node.keep && (this.is("kh") || this.is("kl"))) {
          node.keep = this.keep();
        } else if (!node.reroll && this.eat("ro")) {
          let op = "=";
          if (this.peek.type === "punct" && REROLL_OPS.has(this.peek.text)) op = this.next().text;
          node.reroll = { op, value: this.int() };
        } else {
          break;
        }
      }
      left = node;
    }
  }

  private keep(): NonNullable<DiceNode["keep"]> {
    const highest = this.next().text === "kh";
    return { highest, count: this.int() };
  }

  private atom(): Node {
    const t = this.peek;
    if (t.type === "num") {
      this.i++;
      return { type: "num", value: Number(t.text) };
    }
    if (this.eat("(")) {
      const expr = this.expr();
      this.expect(")");
      return { type: "group", expr };
    }
    if (t.type === "ident" && this.tokens[this.i + 1]?.text === "(") {
      const fn = functions.get(t.text);
      if (!fn) throw new ParseError(`unknown function "${t.text}"`, t.pos);
      this.i += 2;
      const args: Node[] = [];
      if (!this.is(")")) {
        do args.push(this.expr());
        while (this.eat(","));
      }
      this.expect(")");
      if (args.length < fn.minArgs || args.length > fn.maxArgs) {
        throw new ParseError(`wrong number of arguments for "${t.text}"`, t.pos);
      }
      return { type: "call", name: t.text, args };
    }
    this.fail("expected a number, a die or \"(\"");
  }
}

export function parseNode(src: string): Node {
  return new Parser(tokenize(src.toLowerCase())).parseAll();
}
