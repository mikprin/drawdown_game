/**
 * Seeded RNG (mulberry32). The whole generator state is one uint32 stored in
 * the game state, so saves are deterministic and replayable.
 */
export interface RngHolder {
  rng: number;
}

export function rand(h: RngHolder): number {
  let t = (h.rng = (h.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randRange(h: RngHolder, lo: number, hi: number): number {
  return lo + (hi - lo) * rand(h);
}

export function randInt(h: RngHolder, lo: number, hiExclusive: number): number {
  return lo + Math.floor(rand(h) * (hiExclusive - lo));
}

/** Standard normal via Box–Muller. */
export function randNormal(h: RngHolder): number {
  const u = Math.max(rand(h), 1e-12);
  const v = rand(h);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function randLogNormal(h: RngHolder, median: number, sigma: number): number {
  return median * Math.exp(sigma * randNormal(h));
}

export function pick<T>(h: RngHolder, arr: readonly T[]): T {
  return arr[Math.floor(rand(h) * arr.length)];
}
