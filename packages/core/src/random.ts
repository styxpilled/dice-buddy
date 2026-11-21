const TWO_32 = 2 ** 32;
const TWO_53 = 2 ** 53;

/**
 * A uniform integer in [1, sides], with no bias. Values in the last partial
 * block of the source range are rejected and drawn again, so each face gets
 * exactly the same share. `next` returns a uniform unsigned 32-bit integer.
 */
export function uniformDie(sides: number, next: () => number): number {
  if (sides <= TWO_32) {
    const limit = TWO_32 - (TWO_32 % sides);
    let x: number;
    do x = next();
    while (x >= limit);
    return 1 + (x % sides);
  }
  const limit = TWO_53 - (TWO_53 % sides);
  let x: number;
  do x = (next() >>> 11) * TWO_32 + next();
  while (x >= limit);
  return 1 + (x % sides);
}

const buffer = new Uint32Array(256);
let index = buffer.length;

/** Unsigned 32-bit integers from the platform's cryptographic generator. */
export function cryptoUint32(): number {
  if (index === buffer.length) {
    if (typeof globalThis.crypto?.getRandomValues !== "function") {
      throw new Error("no crypto.getRandomValues in this runtime; pass an rng to roll()");
    }
    globalThis.crypto.getRandomValues(buffer);
    index = 0;
  }
  return buffer[index++]!;
}
