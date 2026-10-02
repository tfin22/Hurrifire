// Big targets (player assist): enemies drawn larger at range are hit as large as they're drawn.

import { describe, expect, it } from 'vitest';
import { Vec3 } from '../src/core/math';
import { Rng } from '../src/core/rng';
import { worldMap } from '../src/content/world/map';
import { WorldObjects } from '../src/content/world/objects';
import { Bullet, targetScale } from '../src/sim/ballistics';
import { generateRaids, Sortie } from '../src/sim/sortie';
import { generateWeather } from '../src/sim/weather';
import { TUNING } from '../src/tuning';

const map = worldMap();
const objects = new WorldObjects(map);

function setup(big: boolean, range: number) {
  const rng = new Rng(3);
  const home = map.airfieldByName('Biggin Hill')!;
  const s = new Sortie({
    seed: 3, month: 8, day: 18, hour: 13, weather: { ...generateWeather(rng, 8), cover: 0 }, phase: 'airfields',
    home: home.name, playerType: 'spitfire', playerName: 'P/O Test', squadron: 'Gannet', controller: 'Sapper',
    leading: true, others: [], raids: generateRaids(rng, 'airfields', home, map, false, 1), start: 'air', convergenceM: 274,
    underAttack: false, fatigue: 0, assist: true, airStart: { pos: new Vec3(home.pos.x, 4000, home.pos.z), heading: 0 },
  }, map, objects);
  const w = s.world;
  w.bigTargets = big;
  const r = w.raids[0];
  r.spawn(w, w.rng);
  const q = w.planes.find((p) => p.side === 'lw')!;
  // The player sits `range` metres behind the target.
  const back = q.fs.forward(new Vec3()).scale(-range);
  s.player.fs.setAirborne(q.pos.clone().add(back), q.fs.heading, 120);
  return { s, w, q };
}

/** Drop a round of the player's straight down through a point `off` metres out along the target's right wing. */
function shootPast(big: boolean, range: number, off: number): boolean {
  const { s, w, q } = setup(big, range);
  const right = q.fs.right(new Vec3());
  const b = new Bullet(s.player.id, 'raf', 1, false, false);
  // One 20 ms step carries it from 8 m above the wing to 8 m below.
  b.pos.copy(q.pos).addScaled(right, off).add(new Vec3(0, 8, 0));
  b.vel.set(0, -800, 0);
  q.prevPos.copy(q.pos);
  const hitsBefore = q.damage.hits;
  // Only the hit test, nothing moving.
  b.life = 0;
  w.bullets.push(b);
  (w as unknown as { bulletsStep(dt: number): void }).bulletsStep(0.02);
  return q.damage.hits > hitsBefore;
}

describe('big targets', () => {
  it('true size close in, growing to full scale at range', () => {
    expect(targetScale(30)).toBe(1);
    expect(targetScale(TUNING.targets.far + 100)).toBeCloseTo(TUNING.targets.scale);
    expect(targetScale(180)).toBeGreaterThan(1);
  });

  it('a round just past the wingtip at 400 m misses at true size and hits a big target', () => {
    const { q } = setup(false, 400);
    const tip = Math.max(...q.type.zones.map((z) => Math.abs(z.pos[0]) + z.r));
    expect(shootPast(false, 400, tip + 1)).toBe(false);
    expect(shootPast(true, 400, tip + 1)).toBe(true);
  });
});
