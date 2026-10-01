// Seeded, serialisable pseudo-random number generator.
//
// The whole simulation draws from instances of this so that any sortie can be
// replayed exactly from its seed plus the recorded control inputs. Never use
// Math.random() in simulation code.
//
// Algorithm: mulberry32 — a single 32-bit state word, which makes snapshots
// trivial and is plenty good enough for a game.

export class Rng {
  state: number;

  constructor(seed: number | string) {
    this.state = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    if (this.state === 0) this.state = 0x9e3779b9;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [a, b). */
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Approximately normal, mean 0, sd 1 (sum of uniforms, cheap and deterministic). */
  gauss(): number {
    return this.next() + this.next() + this.next() + this.next() - 2;
  }

  /** Signed uniform in [-1, 1). */
  signed(): number {
    return this.next() * 2 - 1;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }

  /** Derive an independent generator, so adding draws in one subsystem doesn't shift another. */
  fork(label: string | number): Rng {
    return new Rng((hashString(String(label)) ^ Math.imul(this.state, 0x85ebca6b)) >>> 0);
  }

  clone(): Rng {
    const r = new Rng(1);
    r.state = this.state;
    return r;
  }
}

/** FNV-1a 32-bit. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Stateless integer hash of up to three ints, for procedural world detail. */
export function hash3(a: number, b: number, c = 0): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** hash3 mapped to [0, 1). */
export function hash01(a: number, b: number, c = 0): number {
  return hash3(a, b, c) / 4294967296;
}
