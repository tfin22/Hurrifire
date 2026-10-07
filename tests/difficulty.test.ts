// Enemy difficulty: flight school, normal, and Spanish Civil War veterans.

import { describe, expect, it } from 'vitest';
import { Vec3 } from '../src/core/math';
import { FighterBrain } from '../src/sim/ai/fighter';
import { enemySkill, skillFor } from '../src/sim/ai/types';
import { GroundModel } from '../src/sim/ground';
import { World } from '../src/sim/world';
import { TUNING } from '../src/tuning';

const flat: GroundModel = { heightAt: () => 0, surfaceAt: () => 'pasture' };

describe('enemy difficulty', () => {
  it('normal leaves pilots as history had them', () => {
    for (const g of ['green', 'average', 'experte'] as const) expect(enemySkill(skillFor(g), 'normal')).toEqual(skillFor(g));
  });

  it('flight school: a grade greener, and worse than green at the bottom', () => {
    expect(enemySkill(skillFor('experte'), 'school').level).toBe('average');
    expect(enemySkill(skillFor('average'), 'school').level).toBe('green');
    const g = enemySkill(skillFor('green'), 'school');
    expect(g.level).toBe('green');
    expect(g.aim).toBeLessThan(skillFor('green').aim);
    expect(g.spot).toBeLessThan(skillFor('green').spot);
    expect(g.think).toBeGreaterThan(skillFor('green').think);
  });

  it('veterans: a grade sharper, and better than experte at the top', () => {
    expect(enemySkill(skillFor('green'), 'veteran').level).toBe('average');
    expect(enemySkill(skillFor('average'), 'veteran').level).toBe('experte');
    const e = enemySkill(skillFor('experte'), 'veteran');
    expect(e.level).toBe('experte');
    expect(e.aim).toBeGreaterThan(skillFor('experte').aim);
    expect(e.aim).toBeLessThanOrEqual(0.95);
    expect(e.spot).toBeGreaterThan(skillFor('experte').spot);
    expect(e.gLimit).toBeGreaterThan(skillFor('experte').gLimit);
  });

  it('the world applies it to the enemy only, once, and only to the enemy of whoever is the player', () => {
    for (const [level, want] of [['school', 'green'], ['veteran', 'experte']] as const) {
      const w = new World(1, flat);
      w.enemyLevel = level;
      const me = w.addPlane('spitfire', 'raf', 'Red 1');
      me.isPlayer = true;
      w.player = me;
      const wing = w.addPlane('spitfire', 'raf', 'Red 2');
      const bandit = w.addPlane('bf109', 'lw', 'Gelb 1');
      for (const [p, x] of [[me, 0], [wing, 60], [bandit, 3000]] as const) p.fs.setAirborne(new Vec3(x, 3000, 0), 0, 110);
      wing.brain = new FighterBrain({});
      bandit.brain = new FighterBrain({});
      w.step(null);
      w.step(null);
      expect(bandit.skill.level).toBe(want);
      expect(wing.skill).toEqual(skillFor('average'));
    }
    // Flying the 109, the RAF is the enemy.
    const w = new World(2, flat);
    w.enemyLevel = 'veteran';
    const me = w.addPlane('bf109', 'lw', 'Gelb 1');
    me.isPlayer = true;
    w.player = me;
    const spit = w.addPlane('spitfire', 'raf', 'Red 1');
    spit.fs.setAirborne(new Vec3(0, 3000, 3000), 0, 110);
    me.fs.setAirborne(new Vec3(0, 3000, 0), 0, 110);
    spit.brain = new FighterBrain({});
    w.step(null);
    expect(spit.skill.level).toBe('experte');
  });

  it('every level has its tuning', () => {
    for (const l of ['school', 'normal', 'veteran'] as const) expect(TUNING.ai.enemy[l]).toBeDefined();
  });
});
