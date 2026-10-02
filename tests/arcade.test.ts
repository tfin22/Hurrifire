// Arcade mode: the player's aircraft is quicker and tougher, never blacks out,
// and the sortie starts in the air near the raid.

import { describe, expect, it } from 'vitest';
import { Vec3 } from '../src/core/math';
import { Rng } from '../src/core/rng';
import { worldMap } from '../src/content/world/map';
import { WorldObjects } from '../src/content/world/objects';
import { arcadeSpec, generateRaids, Sortie, SortieSpec } from '../src/sim/sortie';
import { generateWeather } from '../src/sim/weather';
import { Bullet } from '../src/sim/ballistics';
import type { ControlFrame } from '../src/input/input';
import { TUNING } from '../src/tuning';

const map = worldMap();
const objects = new WorldObjects(map);

function spec(seed: number, o: Partial<SortieSpec> = {}): SortieSpec {
  const rng = new Rng(seed);
  const home = map.airfieldByName('Biggin Hill')!;
  return {
    seed, month: 8, day: 18, hour: 13, weather: { ...generateWeather(rng, 8), cover: 0 }, phase: 'airfields',
    home: home.name, playerType: 'spitfire', playerName: 'P/O Test', squadron: 'Gannet', controller: 'Sapper',
    leading: true, others: [], raids: generateRaids(rng, 'airfields', home, map, false, 1), start: 'readiness', convergenceM: 274,
    underAttack: false, fatigue: 0, assist: true, ...o,
  };
}

const pull = (pitch: number): ControlFrame => ({ pitch, roll: 0, yaw: 0, throttle: 1, fire: false, boost: false, brake: false, pump: false });

/** Full back stick from 300 mph: returns the worst blackout, whether it stalled, and whether it came round. */
function loop(arcade: boolean) {
  const home = map.airfieldByName('Biggin Hill')!;
  const s = new Sortie(spec(2, { start: 'air', airStart: { pos: new Vec3(home.pos.x, 3000, home.pos.z), heading: 0 } }), map, objects);
  s.world.arcade = arcade;
  s.world.stallGuard = true;
  const p = s.player;
  p.fs.setAirborne(p.pos.clone(), 0, 135);
  let black = 0, grey = 0, stalled = false, inverted = false, round = false;
  for (let t = 0; t < 25 && !round; t += TUNING.sim.dt) {
    s.step(pull(1));
    black = Math.max(black, p.pilot.black);
    grey = Math.max(grey, p.pilot.grey);
    if (p.fs.events.includes('stall')) stalled = true;
    if (Math.abs(p.fs.roll) > 2.5 && p.fs.pitch > -0.3) inverted = true;
    if (inverted && Math.abs(p.fs.roll) < 0.5 && Math.abs(p.fs.pitch) < 0.2) round = true;
  }
  return { black, grey, stalled, round };
}

describe('arcade mode', () => {
  it('a full-stick loop goes all the way round without greying, blacking out or stalling', () => {
    const r = loop(true);
    expect(r.round).toBe(true);
    expect(r.grey).toBe(0);
    expect(r.black).toBe(0);
    expect(r.stalled).toBe(false);
  });

  it('the same loop with real limits greys the pilot out', () => {
    expect(loop(false).grey).toBeGreaterThan(0.3);
  });

  it('starts in the air near the raid, against a less skilled enemy', () => {
    const base = spec(4);
    const a = arcadeSpec(base);
    expect(a.start).toBe('air');
    expect(a.raids[0].delay).toBe(0);
    const r = a.raids[0];
    // Within a few miles of where the raid starts.
    const A = TUNING.arcade;
    expect(Math.hypot(a.airStart!.pos.x - r.start.x, a.airStart!.pos.z - r.start.z)).toBeCloseTo(Math.hypot(A.startAhead, A.startAside), 0);
    expect(a.airStart!.pos.y).toBeGreaterThan(r.alt);
    const order = { green: 0, average: 1, experte: 2 };
    base.raids[0].groups.forEach((g, i) => expect(order[a.raids[0].groups[i].skill]).toBeLessThanOrEqual(order[g.skill]));
    expect(a.raids[0].groups.some((g) => g.skill === 'experte')).toBe(false);
    // The original spec is untouched (a replay rebuilds from it).
    expect(base.start).toBe('readiness');
  });

  it("the player's rounds hit harder, and enemy rounds hit the player softer", () => {
    const run = (arcade: boolean, playerShoots: boolean) => {
      const s = new Sortie(spec(6, { start: 'air', airStart: { pos: new Vec3(0, 3000, 0), heading: 0 } }), map, objects);
      const w = s.world;
      w.arcade = arcade;
      w.raids[0].spawn(w, w.rng);
      const q = w.planes.find((p) => p.side === 'lw')!;
      const target = playerShoots ? q : s.player;
      const owner = playerShoots ? s.player.id : q.id;
      if (!playerShoots) s.player.pos.copy(q.pos).add(new Vec3(0, 0, 500));
      const b = new Bullet(owner, 'x', 4, false, false);
      // Down through the inner wing.
      b.pos.copy(target.pos).addScaled(target.fs.right(new Vec3()), 2.5).add(new Vec3(0, 6, 0));
      b.vel.set(0, -600, 0);
      target.prevPos.copy(target.pos);
      w.bullets.push(b);
      (w as unknown as { bulletsStep(dt: number): void }).bulletsStep(0.02);
      const d = target.damage;
      expect(d.hits).toBe(1);
      return Object.values(d.hp).reduce((a, v) => a + (v ?? 0), 0);
    };
    // Less HP left after an arcade hit by the player; more left after an arcade hit on the player.
    expect(run(true, true)).toBeLessThan(run(false, true));
    expect(run(true, false)).toBeGreaterThan(run(false, false));
  });
});
