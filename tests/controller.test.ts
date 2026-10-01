import { describe, expect, it } from 'vitest';
import { Vec3 } from '../src/core/math';
import { Rng } from '../src/core/rng';
import { interceptVector, reportedHeight } from '../src/sim/controller';

describe('controller vector', () => {
  it('steers straight at a stationary target', () => {
    const v = interceptVector(new Vec3(0, 0, 0), 100, new Vec3(0, 0, 10000), new Vec3());
    expect(v.heading).toBeCloseTo(0, 5);
    expect(v.time).toBeCloseTo(100, 3);
  });

  it('leads a crossing raid so both arrive at the intercept point together', () => {
    const own = new Vec3(0, 0, 0), raid = new Vec3(20000, 0, 20000), vel = new Vec3(-80, 0, 0);
    const v = interceptVector(own, 110, raid, vel);
    expect(v.feasible).toBe(true);
    const ourPos = new Vec3(Math.sin(v.heading) * 110 * v.time, 0, Math.cos(v.heading) * 110 * v.time);
    const raidPos = raid.clone().addScaled(vel, v.time);
    expect(ourPos.distTo(raidPos)).toBeLessThan(5);
    // Heading is ahead of the raid's current bearing (east of north-east... i.e. less than 45°).
    expect(v.heading).toBeLessThan(Math.PI / 4);
  });

  it('heads at the raid when it cannot be caught', () => {
    const v = interceptVector(new Vec3(), 50, new Vec3(0, 0, 5000), new Vec3(0, 0, 120));
    expect(v.feasible).toBe(false);
    expect(v.heading).toBeCloseTo(0, 5);
  });
});

describe('radar height error', () => {
  it('is bounded to a few thousand feet and fixed per raid', () => {
    const rng = new Rng(3);
    for (const err of [-1800, -600, 0, 900, 1800]) {
      const h = reportedHeight(5000, { heightError: err }, rng);
      expect(Math.abs(h - (5000 + err))).toBeLessThan(160);
    }
  });

  it('raids get errors of up to a few thousand feet', async () => {
    const { Raid } = await import('../src/sim/raid');
    const errs: number[] = [];
    for (let s = 1; s < 200; s++) {
      const r = new Raid(s, { name: 'x', kind: 'airfield', targetName: 't', target: new Vec3(), start: new Vec3(), entry: new Vec3(), alt: 4000, speed: 90, groups: [], delay: 0 }, new Rng(s));
      errs.push(r.heightError);
    }
    expect(Math.max(...errs.map(Math.abs))).toBeLessThan(1900);
    expect(errs.filter((e) => Math.abs(e) > 600).length).toBeGreaterThan(40);
    expect(errs.some((e) => e > 0) && errs.some((e) => e < 0)).toBe(true);
  });
});
