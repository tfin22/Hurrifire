import { describe, expect, it } from 'vitest';
import { Rng, hash3 } from '../src/core/rng';

describe('Rng', () => {
  it('is deterministic for a seed', () => {
    const a = new Rng(1234), b = new Rng(1234);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it('differs between seeds', () => {
    expect(new Rng(1).next()).not.toBe(new Rng(2).next());
  });
  it('stays in range and is roughly uniform', () => {
    const r = new Rng('x');
    let sum = 0;
    for (let i = 0; i < 10000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / 10000).toBeCloseTo(0.5, 1);
  });
  it('forks independently and clones exactly', () => {
    const r = new Rng(9);
    const c = r.clone();
    const f = r.fork('ai');
    expect(r.next()).toBe(c.next());
    expect(f.next()).not.toBe(c.next());
  });
  it('hash3 is stable', () => {
    expect(hash3(1, 2, 3)).toBe(hash3(1, 2, 3));
    expect(hash3(1, 2, 3)).not.toBe(hash3(3, 2, 1));
  });
});
