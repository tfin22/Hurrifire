import { describe, expect, it } from 'vitest';
import { Vec3 } from '../src/core/math';
import { Rng } from '../src/core/rng';
import { GroundModel } from '../src/sim/ground';
import { Raid } from '../src/sim/raid';
import { World } from '../src/sim/world';
import { enemyGroups } from '../src/screens/spotting';
import { TUNING } from '../src/tuning';

const flat: GroundModel = { heightAt: () => 0, surfaceAt: () => 'pasture' };

describe('spotting groups', () => {
  it('gathers formations, keeps separate ones apart, and ignores friends and the far-off', () => {
    const w = new World(1, flat);
    const me = w.addPlane('spitfire', 'raf', 'Me');
    me.fs.setAirborne(new Vec3(0, 4000, 0), 0, 120);
    const at = (type: 'do17' | 'bf109' | 'hurricane', side: 'lw' | 'raf', x: number, z: number) => w.addPlane(type, side, 'x').fs.setAirborne(new Vec3(x, 4000, z), 0, 100);
    for (let i = 0; i < 6; i++) at('do17', 'lw', i * 60, 20000);
    for (let i = 0; i < 4; i++) at('bf109', 'lw', 9000 + i * 80, 9000);
    at('hurricane', 'raf', 100, 100);
    at('do17', 'lw', 0, TUNING.spotting.groupRange + 5000);
    const g = enemyGroups(w, me);
    expect(g.map((x) => x.members.length)).toEqual([4, 6]);
    expect(g[0].dist).toBeLessThan(g[1].dist);
  });

  it('a raid the radar has reported shows up before anyone can see it', () => {
    const w = new World(2, flat);
    const me = w.addPlane('spitfire', 'raf', 'Me');
    me.fs.setAirborne(new Vec3(0, 4000, 0), 0, 120);
    const r = w.addRaid(new Raid(1, {
      name: 'raid1', kind: 'airfield', targetName: 'Kenley', target: new Vec3(0, 0, 0), start: new Vec3(0, 0, 60000), entry: new Vec3(0, 0, 40000),
      alt: 4500, speed: 90, delay: 0, groups: [{ type: 'do17', count: 20, role: 'bomber', altOffset: 0, skill: 'average' }],
    }, new Rng(3)));
    w.raidSpawnRange = 0;
    for (let i = 0; i < 10; i++) w.step(null);
    const g = enemyGroups(w, me);
    expect(r.spawned).toBe(false);
    expect(g.length).toBe(1);
    expect(g[0].reported).toBe(true);
    expect(g[0].estimate).toBeGreaterThan(0);
    expect(g[0].pos.y).toBeCloseTo(4500 + r.heightError, 0); // the radar's height, errors and all
  });
});
