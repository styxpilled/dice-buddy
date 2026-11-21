export type Node =
  | { type: "num"; value: number }
  | { type: "group"; expr: Node }
  | { type: "neg"; expr: Node }
  | DiceNode
  | BinaryNode
  | { type: "call"; name: string; args: Node[] }
  | CondNode;

export interface DiceNode {
  type: "dice";
  /** `null` when the count is omitted, as in `d20`. */
  count: Node | null;
  sides: number;
  keep: { highest: boolean; count: number } | null;
  /** Reroll a die once when `op(face, value)` is true. */
  reroll: { op: string; value: number } | null;
}

export interface BinaryNode {
  type: "binary";
  op: string;
  left: Node;
  right: Node;
}

export interface CondNode {
  type: "cond";
  test: Node;
  then: Node;
  else: Node | null;
  /** The `top` highest values of the left side of `test` always take this branch. */
  crit: { top: number; expr: Node } | null;
}
