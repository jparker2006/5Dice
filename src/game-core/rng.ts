import type { Rng } from "./types";

/** Roll one die (1–6) from a [0,1) random source. */
export function rollDie(rng: Rng): number {
  return Math.floor(rng() * 6) + 1;
}

/**
 * A deterministic, well-distributed PRNG (mulberry32). Use on the server for
 * reproducible games and in tests. Not cryptographically secure — dice rolls
 * don't need to be, and the server being the only roller is what prevents
 * cheating.
 */
export function makeSeededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
