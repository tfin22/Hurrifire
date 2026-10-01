// Whole sorties, headless: the player's seat is flown by the fighter AI.

import { describe, expect, it } from 'vitest';
import { Vec3 } from '../src/core/math';
import { Rng } from '../src/core/rng';
import { worldMap } from '../src/content/world/map';
import { WorldObjects } from '../src/content/world/objects';
import { FighterBrain } from '../src/sim/ai/fighter';
import { flyApproach } from '../src/sim/ai/approach';
import { generateRaids, Sortie, SortieSpec } from '../src/sim/sortie';
import { generateWeather } from '../src/sim/weather';
import { skillFor } from '../src/sim/ai/types';
import { applySortie, newCampaign, nextSortieSpec } from '../src/campaign/campaign';

const map = worldMap();
const objects = new WorldObjects(map);

function spec(seed: number, o: Partial<SortieSpec> = {}): SortieSpec {
  const rng = new Rng(seed);
  const home = map.airfieldByName('Biggin Hill')!;
  return {
    seed, month: 8, day: 18, hour: 13, weather: { ...generateWeather(rng, 8), cover: 0.15 }, phase: 'airfields',
    home: home.name, playerType: 'spitfire', playerName: 'P/O Test', squadron: 'Gannet', controller: 'Sapper',
    leading: true, others: [{ name: 'Ashworth', skill: 'average', fatigue: 0 }, { name: 'Bellamy', skill: 'green', fatigue: 0 }],
    raids: generateRaids(rng, 'airfields', home, map, false, 1), start: 'air', convergenceM: 274, underAttack: false,
    fatigue: 0, assist: true, airStart: { pos: new Vec3(home.pos.x, 4500, home.pos.z), heading: 2.4 }, ...o,
  };
}

/** Fly the player's aircraft with the AI: vectors, tally-ho, fight, home and land. */
function autoplay(s: Sortie, maxMin = 50): void {
  const p = s.player;
  p.skill = skillFor('experte');
  const brain = new FighterBrain({ preferBombers: true });
  let landing = false;
  for (let i = 0; i < maxMin * 60 * 50 && !s.result; i++) {
    const ctx = s.world.aiContext;
    if (p.status === 'flying' && !p.fs.onGround) {
      const v = s.controller.lastVector;
      const pancake = s.phase === 'rtb' || p.fs.fuel < p.type.fuelCapacity * 0.2;
      if (pancake || landing) {
        landing = true;
        const b = s.base;
        const d = (b.dir * Math.PI) / 180;
        const tgt = { x: b.pos.x - Math.sin(d) * (b.half - 100), z: b.pos.z - Math.cos(d) * (b.half - 100), h: b.pos.y, dir: d };
        const far = Math.hypot(p.pos.x - tgt.x, p.pos.z - tgt.z) > 4000;
        if (far) { brain.opts.waypoint = new Vec3(tgt.x - Math.sin(d) * 3500, b.pos.y + 300, tgt.z - Math.cos(d) * 3500); brain.state = 'patrol'; brain.update(p, ctx); }
        else { p.fs.gearCmd = 1; p.fs.flapsCmd = 1; flyApproach(p.fs, tgt, p.ctl, {}); }
      } else {
        if (v && !s.engaged) brain.opts.waypoint = new Vec3(p.pos.x + Math.sin(v.heading) * 20000, 5000, p.pos.z + Math.cos(v.heading) * 20000);
        brain.update(p, ctx);
        if (!s.engaged && brain.contacts.ids().length) s.tallyHo();
      }
    } else if (p.fs.onGround) {
      flyApproach(p.fs, { x: 0, z: 0, h: 0, dir: p.fs.heading }, p.ctl, {});
    }
    s.step(null);
    if (process.env.SHOW && i % 1500 === 0) console.log('T', (i / 50).toFixed(0), s.phase, p.status, brain.label(), 'alt', p.pos.y.toFixed(0), 'agl', p.fs.agl.toFixed(0), 'hits', p.damage.hits, 'fired', p.armament.fired, 'raid', s.world.raids[0].plot.distTo(p.pos).toFixed(0), landing);
  }
  if (process.env.SHOW) console.log('END', p.status, p.landing.result?.kind, p.damage.pilot, p.fs.agl.toFixed(0), JSON.stringify(p.landing.contacts), 'onGround', p.fs.onGround, 'stopped', p.fs.stopped, 'sliding', p.fs.sliding, 'tas', p.fs.tas.toFixed(1), 'gear', p.fs.gear, 'engine', p.fs.engine, 'bailing', p.bailing, 'crew', p.crewAboard);
}

describe('a whole sortie', () => {
  it('runs from vectors to the debrief', () => {
    const s = new Sortie(spec(+(process.env.SEED ?? 3)), map, objects);
    autoplay(s);
    const texts = s.controller.log.map((m) => m.text).join('\n');
    expect(texts).toMatch(/Vector/);
    expect(s.world.raids[0].spawned).toBe(true);
    expect(s.result).not.toBeNull();
    const r = s.result!;
    if (process.env.SHOW) console.log(JSON.stringify({ ...r, rtLog: r.rtLog }, null, 1), s.world.planes.map((q) => `${q.type.short}:${q.status}:${q.brain?.label() ?? ''}`).join(' '));
    expect(r.logLine.length).toBeGreaterThan(10);
    expect(r.date).toBe('18 August 1940');
    expect(['landed', 'forced', 'belly', 'crashLanded', 'ditched', 'bailLand', 'bailSea', 'lostSea', 'killed', 'pow']).toContain(r.outcome.kind);
  }, 60000);

  it('a campaign sortie as a wingman: built from the roster, flown, and folded back in', () => {
    const c = newCampaign(31, { surname: 'Fenwick', home: 'Biggin Hill', aircraft: 'hurricane', ironman: true });
    const home = map.airfieldByName('Biggin Hill')!;
    const sp = { ...nextSortieSpec(c, map, { convergenceM: 230, assist: true }), start: 'air' as const, airStart: { pos: new Vec3(home.pos.x, 4500, home.pos.z), heading: 2.4 } };
    expect(sp.leading).toBe(false);
    const s = new Sortie(sp, map, objects);
    expect(s.formation[0]).not.toBe(s.player); // the CO leads
    autoplay(s);
    const r = s.result!;
    expect(r).not.toBeNull();
    expect(r.fates.length).toBe(sp.others.length);
    for (const f of r.fates) expect(c.roster.some((p) => p.id === f.id)).toBe(true);
    const before = c.roster.reduce((a, p) => a + p.sorties, 0);
    applySortie(c, r);
    if (!c.ended) {
      expect(c.player.sorties).toBe(1);
      expect(c.roster.reduce((a, p) => a + p.sorties, 0)).toBeGreaterThanOrEqual(before + sp.others.length);
    }
  }, 90000);

  it('replays identically from the same seed', () => {
    const a = new Sortie(spec(5), map, objects);
    const b = new Sortie(spec(5), map, objects);
    for (let i = 0; i < 50 * 240; i++) { a.step(null); b.step(null); }
    const sig = (s: Sortie) => s.world.planes.map((p) => `${p.pos.x.toFixed(3)},${p.pos.y.toFixed(3)},${p.status},${p.damage.hits}`).join('|');
    expect(sig(a)).toBe(sig(b));
    expect(a.controller.log.map((m) => m.text)).toEqual(b.controller.log.map((m) => m.text));
  }, 60000);

  it('starts at readiness: no start without priming; primer, mags, starter catches', () => {
    const s = new Sortie(spec(7, { start: 'readiness', airStart: undefined }), map, objects);
    expect(s.player.fs.engine).toBe('off');
    s.step({ ...blank(), cmds: ['mags', 'starter'] });
    for (let i = 0; i < 200; i++) s.step(blank());
    expect(s.player.fs.engine).toBe('off');
    s.step({ ...blank(), cmds: ['primer', 'starter'] });
    for (let i = 0; i < 200; i++) s.step(blank());
    expect(s.player.fs.engine).toBe('running');
    expect(s.phase).toBe('takeoff');
  });

  it('assist START does it all in under 15 seconds', () => {
    const s = new Sortie(spec(8, { start: 'readiness', airStart: undefined }), map, objects);
    s.step({ ...blank(), cmds: ['startAll'] });
    let t = 0;
    while (s.player.fs.engine !== 'running' && t < 20) { s.step(blank()); t += 0.02; }
    expect(t).toBeLessThan(15);
  });
});

function blank() {
  return { pitch: 0, roll: 0, yaw: 0, throttle: 0, fire: false, boost: false, brake: true, pump: false };
}
