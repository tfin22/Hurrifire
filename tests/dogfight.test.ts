// Fighter against fighter, both flown by the AI: the fight ends in someone
// being shot down, not in two aircraft circling for ever or flying into the
// ground on their own.

import { describe, expect, it } from 'vitest';
import { Quat, Vec3 } from '../src/core/math';
import { cornerSpeed, FighterBrain, pullOutHeight, turnEdge } from '../src/sim/ai/fighter';
import { skillFor, SkillLevel } from '../src/sim/ai/types';
import { World } from '../src/sim/world';

const flat = { heightAt: () => 0, surfaceAt: () => 'pasture' as const };

function duel(seed: number, level: SkillLevel, secs = 180) {
  const w = new World(seed, flat);
  w.sun.set(0, 1, 0);
  const a = w.addPlane('spitfire', 'raf', 'S');
  const b = w.addPlane('bf109', 'lw', 'B');
  a.skill = skillFor(level);
  b.skill = skillFor(level);
  a.fs.setAirborne(new Vec3(0, 4000, 0), 0, 120);
  b.fs.setAirborne(new Vec3(600, 4100, 1500), Math.PI + 0.4, 120);
  a.brain = new FighterBrain({});
  b.brain = new FighterBrain({});
  let hits = 0;
  for (let i = 0; i < secs * 50 && a.alive && b.alive; i++) {
    w.step(null);
    for (const e of w.events) if (e.kind === 'hit') hits++;
    w.events.length = 0;
  }
  return { a, b, hits };
}

describe('AI against AI', () => {
  it('fights end: in three minutes most duels have a winner, shot down', () => {
    let decided = 0, fired = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const { a, b, hits } = duel(seed, 'average');
      fired += a.armament.fired + b.armament.fired;
      if (!a.alive || !b.alive) {
        decided++;
        expect(hits).toBeGreaterThan(0);
      }
    }
    expect(decided).toBeGreaterThanOrEqual(5);
    expect(fired).toBeGreaterThan(300);
  }, 60000);

  it('nobody flies into the ground on their own', () => {
    for (const level of ['average', 'experte'] as const) {
      for (let seed = 1; seed <= 8; seed++) {
        const { a, b } = duel(seed, level);
        for (const p of [a, b]) if (!p.alive) expect(p.damage.hits).toBeGreaterThan(0);
      }
    }
  }, 120000);
});

describe('who turns better, and fights accordingly', () => {
  it('the Spitfire and Hurricane out-turn the 109 slow: lighter on the wing, lower corner speed', () => {
    const w = new World(1, flat);
    const spit = w.addPlane('spitfire', 'raf', 'S'), hurri = w.addPlane('hurricane', 'raf', 'H'), bf = w.addPlane('bf109', 'lw', 'B');
    for (const p of [spit, hurri, bf]) p.skill = skillFor('average');
    expect(turnEdge(spit, bf)).toBeGreaterThan(1.1);
    expect(turnEdge(hurri, bf)).toBeGreaterThan(1.1);
    expect(turnEdge(bf, spit)).toBeLessThan(1 / 1.1);
    expect(cornerSpeed(spit)).toBeLessThan(cornerSpeed(bf));
  });

  it('side by side, at the same height and speed, the Spitfire wins the turning fight more often than the 109', () => {
    let spit = 0, bf = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const w = new World(seed, flat);
      w.sun.set(0, 1, 0);
      const a = w.addPlane('spitfire', 'raf', 'S'), b = w.addPlane('bf109', 'lw', 'B');
      a.skill = skillFor('average');
      b.skill = skillFor('average');
      a.fs.setAirborne(new Vec3(0, 4000, 0), 0, 120);
      b.fs.setAirborne(new Vec3(800, 4000, 0), 0, 120);
      a.brain = new FighterBrain({});
      b.brain = new FighterBrain({});
      for (let i = 0; i < 240 * 50 && a.alive && b.alive; i++) w.step(null);
      if (!b.alive) spit++;
      if (!a.alive) bf++;
    }
    expect(spit).toBeGreaterThan(bf);
  }, 120000);
});

describe('pulling out of a dive', () => {
  it('needs more room fast, steep and upside down; none in level flight', () => {
    const w = new World(1, flat);
    const p = w.addPlane('bf109', 'lw', 'B');
    p.skill = skillFor('average');
    p.fs.setAirborne(new Vec3(0, 3000, 0), 0, 120);
    expect(pullOutHeight(p)).toBeLessThan(1);
    p.fs.setAirborne(new Vec3(0, 3000, 0), 0, 120, -0.3);
    const gentle = pullOutHeight(p);
    p.fs.setAirborne(new Vec3(0, 3000, 0), 0, 240, -1.2);
    const steep = pullOutHeight(p);
    expect(steep).toBeGreaterThan(gentle * 5);
    expect(steep).toBeGreaterThan(800);
  });

  it('caught upside down in a steep dive, a Spitfire recovers from 2,000 m, a 109 (heavier at speed) from 3,000 m', () => {
    for (const [type, alt] of [['spitfire', 2000], ['bf109', 3000]] as const) for (let seed = 1; seed <= 4; seed++) {
      const w = new World(seed, flat);
      const p = w.addPlane(type, 'lw', 'B');
      p.skill = skillFor('average');
      p.fs.setAirborne(new Vec3(0, alt, 0), 0, 200, -1.1);
      // Half-rolled: upside down.
      p.fs.q = Quat.fromEuler(0, -1.1, Math.PI);
      p.brain = new FighterBrain({ waypoint: new Vec3(0, alt, 30000) });
      let lowest = Infinity;
      for (let i = 0; i < 30 * 50 && p.status === 'flying'; i++) { w.step(null); lowest = Math.min(lowest, p.pos.y); }
      expect(p.status).toBe('flying');
      expect(lowest).toBeGreaterThan(50);
    }
  });
});

describe("the 109's heavy elevator", () => {
  /** Full back stick from a shallow dive at about `mph` IAS: the most G in the first 0.6 s, and after a further `hold` seconds. */
  function pull(type: 'spitfire' | 'bf109', mph: number, hold = 0) {
    const w = new World(1, flat);
    const p = w.addPlane(type, 'raf', 'T');
    p.isPlayer = true;
    w.player = p;
    p.fs.setAirborne(new Vec3(0, 3000, 0), 0, (mph / 2.237) * 1.15, -0.4);
    let first = 0, later = 0;
    for (let i = 0; i < (1.5 + hold) * 50; i++) {
      w.step({ pitch: 1, roll: 0, yaw: 0, throttle: 0.3, fire: false, boost: false, brake: false, pump: false });
      // The first moments, before any trim is wound in; then what holding it gets.
      if (i < 30) first = Math.max(first, p.fs.nz);
      else if (i >= 75) later = Math.max(later, p.fs.nz);
    }
    return { first, later };
  }

  it('at 400 mph the 109 pilot can pull only about 4 g; the Spitfire pilot can pull until he blacks out', () => {
    expect(pull('bf109', 400).first).toBeGreaterThan(3.5);
    expect(pull('bf109', 400).first).toBeLessThan(4.8);
    expect(pull('spitfire', 400).first).toBeGreaterThan(7);
    // Slower, the 109 pulls as hard as anyone.
    expect(pull('bf109', 270).first).toBeGreaterThan(7);
  });

  it('held hard back, the 109 pilot winds in trim and slowly gets more', () => {
    const r = pull('bf109', 430, 2.5);
    expect(r.later).toBeGreaterThan(r.first + 0.5);
  });

  it('a Spitfire with a 109 a kilometre behind dives for the deck; the 109 has to pull out higher, and a green one may not', async () => {
    const { TUNING } = await import('../src/tuning');
    const keep = TUNING.ai.diveOutChance;
    (TUNING.ai as { diveOutChance: number }).diveOutChance = 1;
    try {
      let dove = 0, spitLow = 0, bfLow = 0, hit = 0;
      for (let seed = 1; seed <= 8; seed++) {
        const w = new World(seed, flat);
        w.sun.set(0, 1, 0);
        const s = w.addPlane('spitfire', 'raf', 'S'), b = w.addPlane('bf109', 'lw', 'B');
        s.skill = skillFor('average');
        b.skill = skillFor('average');
        s.fs.setAirborne(new Vec3(0, 3000, 0), 0, 130);
        b.fs.setAirborne(new Vec3(0, 3050, -1000), 0, 150);
        const sb = new FighterBrain({ holdFire: true, waypoint: new Vec3(0, 3000, 40000) });
        s.brain = sb;
        b.brain = new FighterBrain({});
        let lowS = 1e9, lowB = 1e9, d = false;
        for (let i = 0; i < 60 * 50 && s.alive && b.alive; i++) {
          w.step(null);
          lowS = Math.min(lowS, s.pos.y);
          if (b.alive) lowB = Math.min(lowB, b.pos.y);
          if (sb.state === 'diveOut') d = true;
        }
        if (d) dove++;
        spitLow += lowS;
        bfLow += lowB;
        if (s.damage.hits > 0) hit++;
      }
      expect(dove).toBeGreaterThan(4);
      expect(hit).toBe(0);
      expect(bfLow).toBeGreaterThan(spitLow);
    } finally {
      (TUNING.ai as { diveOutChance: number }).diveOutChance = keep;
    }
  }, 120000);
});
