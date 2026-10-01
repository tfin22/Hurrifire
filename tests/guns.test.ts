import { describe, expect, it } from 'vitest';
import { Quat, Vec3 } from '../src/core/math';
import { Rng } from '../src/core/rng';
import { AIRCRAFT } from '../src/content/aircraft';
import { Bullet, convergedDirection, hitZone, leadPoint, stepBullet, timeOfFlight } from '../src/sim/ballistics';
import { Armament, EYE } from '../src/sim/guns';

/** Fly a bullet until it has gone `range` metres forward; return its position. */
function flyTo(b: Bullet, range: number): Vec3 {
  for (let i = 0; i < 400 && b.pos.z < range; i++) stepBullet(b, 0.005);
  return b.pos.clone();
}

function shoot(gunPos: [number, number, number], dir: Vec3, muzzle: number): Bullet {
  const b = new Bullet(1, 'raf', 1, false, false);
  b.pos.set(...gunPos);
  b.prev.copy(b.pos);
  b.vel.copy(dir).scale(muzzle);
  return b;
}

describe('ballistics', () => {
  it('rounds slow down and drop under gravity', () => {
    const b = shoot([0, 0, 0], new Vec3(0, 0, 1), 745);
    for (let i = 0; i < 50; i++) stepBullet(b, 0.02);
    expect(b.vel.z).toBeLessThan(745);
    expect(b.vel.z).toBeGreaterThan(450);
    expect(b.pos.y).toBeLessThan(-3);
  });

  it('time of flight grows faster than linearly with range', () => {
    const t200 = timeOfFlight(200, 745), t400 = timeOfFlight(400, 745);
    expect(t400).toBeGreaterThan(2 * t200);
    expect(t200).toBeGreaterThan(200 / 745);
  });

  it('own aircraft velocity is added to the rounds', () => {
    const arm = new Armament(AIRCRAFT.spitfire, 274);
    const out: Bullet[] = [];
    arm.fire(new Vec3(), new Vec3(0, 0, 150), (v) => v, 1, 'raf', 0.25, new Rng(1), out);
    expect(out.length).toBeGreaterThan(0);
    for (const b of out) expect(b.vel.z).toBeGreaterThan(745 + 140);
  });
});

describe('convergence', () => {
  for (const yards of [250, 300, 400]) {
    const R = yards * 0.9144;
    it(`wing guns converge on the sight line at ${yards} yards`, () => {
      const t = AIRCRAFT.spitfire;
      const outer = t.guns[0].pos, inner = t.guns[3].pos;
      const pts = [outer, inner, t.guns[7].pos].map((g) => flyTo(shoot(g, convergedDirection(g, EYE, R, 745), 745), R + EYE[2]));
      for (const p of pts) {
        expect(Math.abs(p.x - EYE[0])).toBeLessThan(0.35);
        expect(Math.abs(p.y - EYE[1])).toBeLessThan(0.35);
      }
    });
  }

  it('hits ahead of the convergence point are scattered', () => {
    const t = AIRCRAFT.spitfire;
    const R = 400 * 0.9144;
    const spread = (dist: number) => {
      const xs = t.guns.map((g) => flyTo(shoot(g.pos, convergedDirection(g.pos, EYE, R, 745), 745), dist).x);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(spread(R * 0.4)).toBeGreaterThan(3);
    expect(spread(R)).toBeLessThan(0.7);
    expect(spread(R * 0.4)).toBeGreaterThan(spread(R * 0.8));
  });

  it('about 15 seconds of fire for eight Brownings', () => {
    const arm = new Armament(AIRCRAFT.spitfire, 274);
    const out: Bullet[] = [];
    let t = 0;
    const rng = new Rng(2);
    while (arm.rounds > 0 && t < 30) {
      arm.fire(new Vec3(), new Vec3(), (v) => v, 1, 'raf', 0.02, rng, out);
      t += 0.02;
    }
    expect(t).toBeGreaterThan(13);
    expect(t).toBeLessThan(18);
  });
});

describe('hit detection', () => {
  it('finds the first zone along the round path', () => {
    const zones = AIRCRAFT.bf109.zones;
    // A round from dead astern along the centreline hits the tail first.
    const h = hitZone(new Vec3(0, 0.3, -20), new Vec3(0, 0.3, 10), zones);
    expect(h).not.toBeNull();
    expect(['tail', 'elevator', 'rudder']).toContain(h!.zone.id);
  });

  it('misses when it passes wide', () => {
    expect(hitZone(new Vec3(20, 0, -20), new Vec3(20, 0, 20), AIRCRAFT.bf109.zones)).toBeNull();
  });

  it('lead point anticipates a crossing target', () => {
    const p = leadPoint(new Vec3(), new Vec3(0, 0, 100), new Vec3(0, 0, 300), new Vec3(100, 0, 100), 745);
    expect(p.x).toBeGreaterThan(20);
    expect(p.y).toBeGreaterThan(0); // aim up for drop
  });

  it('converged guns put rounds into a target at the convergence range', () => {
    const arm = new Armament(AIRCRAFT.spitfire, 274);
    const out: Bullet[] = [];
    const rng = new Rng(3);
    const q = new Quat();
    for (let i = 0; i < 25; i++) arm.fire(new Vec3(), new Vec3(0, 0, 120), (v) => q.rotate(v), 1, 'raf', 0.02, rng, out);
    // Target 109 sitting at the convergence range, on the sight line, flying the same way.
    const tgt = new Vec3(EYE[0], EYE[1], 274);
    let hits = 0;
    for (const b of out) {
      for (let k = 0; k < 40; k++) {
        stepBullet(b, 0.01);
        tgt.z += 1.2 * 0.01 * 100; // target moving at 120 m/s
        const rel0 = b.prev.clone().sub(tgt), rel1 = b.pos.clone().sub(tgt);
        if (hitZone(rel0, rel1, AIRCRAFT.bf109.zones)) { hits++; break; }
      }
      tgt.z = 274;
    }
    expect(hits / out.length).toBeGreaterThan(0.4);
  });
});
