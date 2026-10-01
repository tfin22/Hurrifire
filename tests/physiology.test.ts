import { describe, expect, it } from 'vitest';
import { Physiology } from '../src/sim/physiology';

const run = (p: Physiology, g: number, secs: number) => { for (let i = 0; i < secs * 50; i++) p.step(g, 0.02); };

describe('G effects', () => {
  it('1 g does nothing', () => {
    const p = new Physiology();
    run(p, 1, 30);
    expect(p.grey).toBe(0);
    expect(p.black).toBe(0);
  });
  it('sustained high G greys then blacks out, and recovers on release', () => {
    const p = new Physiology();
    run(p, 6.5, 1);
    expect(p.grey).toBeGreaterThan(0.2);
    expect(p.black).toBe(0);
    run(p, 6.5, 6);
    expect(p.black).toBeGreaterThan(0.9);
    run(p, 1, 6);
    expect(p.black).toBe(0);
    expect(p.grey).toBe(0);
  });
  it('a wounded pilot greys out sooner', () => {
    const a = new Physiology(), b = new Physiology();
    b.penalty = 0.8;
    run(a, 5, 3);
    run(b, 5, 3);
    expect(b.grey).toBeGreaterThan(a.grey);
  });
  it('negative G gives a brief redout', () => {
    const p = new Physiology();
    run(p, -3, 1);
    expect(p.red).toBeGreaterThan(0.3);
    run(p, 1, 3);
    expect(p.red).toBe(0);
  });
});
