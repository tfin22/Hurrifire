// The other side: a 109 escort sortie, flown headless by the fighter AI.

import { describe, expect, it } from 'vitest';
import { Vec3 } from '../src/core/math';
import { Rng } from '../src/core/rng';
import { worldMap } from '../src/content/world/map';
import { WorldObjects } from '../src/content/world/objects';
import { isFrance } from '../src/content/world/describe';
import { FighterBrain } from '../src/sim/ai/fighter';
import { skillFor } from '../src/sim/ai/types';
import { EscortSortie, EscortSpec } from '../src/sim/escort';
import { generateWeather } from '../src/sim/weather';
import { TUNING } from '../src/tuning';

const map = worldMap();
const objects = new WorldObjects(map);

function spec(seed: number): EscortSpec {
  return { seed, month: 9, day: 15, hour: 12, weather: { ...generateWeather(new Rng(seed), 9), cover: 0.2 }, playerName: 'Lt Brandt', colour: 'Gelb', convergenceM: 300, assist: true };
}

/** Stay with the bombers, fight what comes, go home on the red light. */
function autoplay(s: EscortSortie, maxMin = 70): { redAt: number; maxEnemy: number } {
  const p = s.player;
  p.skill = skillFor('experte');
  const brain = new FighterBrain({});
  let redAt = -1, maxEnemy = 0;
  const marquise = map.airfieldByName('Marquise')!;
  for (let i = 0; i < maxMin * 3000 && !s.result; i++) {
    if (p.status === 'flying') {
      const low = p.fs.fuel < p.type.fuelCapacity * TUNING.escort.redLight;
      if (low && redAt < 0) redAt = s.time;
      brain.opts.waypoint = low ? marquise.pos.clone().add(new Vec3(0, 1500, 0)) : s.raid.plot.clone().add(new Vec3(0, 500, 0));
      if (low && brain.state !== 'evade') brain.state = 'patrol';
      brain.update(p, s.world.aiContext);
      const f = { pitch: p.ctl.pitch, roll: p.ctl.roll, yaw: p.ctl.yaw, throttle: p.ctl.throttle, fire: p.trigger, boost: false, brake: false, pump: false };
      s.step(!s.engaged && brain.state === 'attack' ? { ...f, cmds: ['tallyHo'] } : f);
    } else s.step(null);
    if (i % 250 === 0) maxEnemy = Math.max(maxEnemy, s.world.planes.filter((q) => q.side === 'raf' && q.alive).length);
  }
  return { redAt, maxEnemy };
}

describe('the 109 escort sortie', () => {
  it('starts over Cap Gris Nez with the bombers, a Schwarm of four, and the fuel already down', () => {
    const s = new EscortSortie(spec(1), map, objects);
    expect(isFrance(s.player.pos.x, s.player.pos.z)).toBe(true);
    expect(s.schwarm.length).toBe(4);
    expect(s.player.type.id).toBe('bf109');
    expect(s.raid.bombers.length).toBeGreaterThanOrEqual(12);
    expect(s.player.fs.fuel).toBeCloseTo(s.player.type.fuelCapacity * TUNING.escort.startFuel, 0);
    expect(s.player.pos.distTo(s.raid.leader()!.pos)).toBeLessThan(1200);
  });

  it('runs to the end: RAF squadrons come up, the fuel runs down, and there is a debrief', () => {
    const s = new EscortSortie(spec(+(process.env.SEED ?? 2)), map, objects);
    const { redAt, maxEnemy } = autoplay(s);
    if (process.env.SHOW) console.log(JSON.stringify(s.result, null, 1), redAt, maxEnemy, s.controller.log.map((m) => m.text).join('\n'));
    expect(maxEnemy).toBeGreaterThanOrEqual(12);
    expect(s.result).not.toBeNull();
    const r = s.result!;
    expect(r.date).toBe('15 September 1940');
    expect(r.raidNotes.join(' ')).toMatch(/bombers/);
    expect(r.fates.length).toBe(3);
    expect(['landed', 'forced', 'belly', 'crashLanded', 'ditched', 'bailLand', 'bailSea', 'lostSea', 'killed', 'pow']).toContain(r.outcome.kind);
    // London and back is at the edge of the 109's range: most of the fuel goes.
    if (process.env.SHOW) console.log('fuel left', s.player.fs.fuel / s.player.type.fuelCapacity, 'ammo', s.player.armament.frac, 'red at', redAt);
    if (r.outcome.kind === 'landed') expect(s.player.fs.fuel).toBeLessThan(s.player.type.fuelCapacity * 0.45);
  }, 120000);

  it('replays identically from the same seed', () => {
    const a = new EscortSortie(spec(5), map, objects);
    const b = new EscortSortie(spec(5), map, objects);
    for (let i = 0; i < 50 * 700; i++) { a.step(null); b.step(null); }
    const sig = (s: EscortSortie) => s.world.planes.map((p) => `${p.pos.x.toFixed(3)},${p.pos.y.toFixed(3)},${p.status}`).join('|');
    expect(a.world.planes.length).toBeGreaterThan(40);
    expect(sig(a)).toBe(sig(b));
  }, 120000);
});
