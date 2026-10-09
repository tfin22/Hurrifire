// A living sky: several raids, free hunts, other squadrons up besides
// yours, a controller that keeps you on one raid, and markers only for
// what you were sent after or could really see.

import { describe, expect, it } from 'vitest';
import { Vec3 } from '../src/core/math';
import { Rng } from '../src/core/rng';
import { worldMap } from '../src/content/world/map';
import { WorldObjects } from '../src/content/world/objects';
import { FighterBrain } from '../src/sim/ai/fighter';
import { SectorController, ControllerView } from '../src/sim/controller';
import { GroundModel } from '../src/sim/ground';
import { Raid, RaidSpec } from '../src/sim/raid';
import { planRaids, Sortie, SortieSpec } from '../src/sim/sortie';
import { OtherSquadron } from '../src/sim/squadrons';
import { generateWeather } from '../src/sim/weather';
import { World } from '../src/sim/world';
import { enemyGroups } from '../src/screens/spotting';
import { TUNING } from '../src/tuning';

const flat: GroundModel = { heightAt: () => 0, surfaceAt: () => 'pasture' };
const map = worldMap();
const objects = new WorldObjects(map);
const home = map.airfieldByName('Biggin Hill')!;

/** A raid heading north towards a target 60 km away. */
function raidSpec(name: string, x = 0, delay = 0, kind: RaidSpec['kind'] = 'airfield', far = 60000): RaidSpec {
  return {
    name, kind, targetName: 'x', target: new Vec3(x, 0, far), start: new Vec3(x, 4000, 0), entry: new Vec3(x, 4000, 20000),
    alt: 4000, speed: 90, delay,
    groups: kind === 'sweep'
      ? [{ type: 'bf109', count: 6, role: 'sweep', altOffset: 0, skill: 'experte' }]
      : [{ type: 'he111', count: 12, role: 'bomber', altOffset: 0, skill: 'average' }, { type: 'bf109', count: 4, role: 'closeEscort', altOffset: 500, skill: 'average' }],
  };
}

function worldWith(seed: number, ...specs: RaidSpec[]) {
  const w = new World(seed, flat);
  w.sun.set(0, 1, 0);
  const me = w.addPlane('spitfire', 'raf', 'Me');
  me.isPlayer = true;
  w.player = me;
  const raids = specs.map((s, i) => w.addRaid(new Raid(i + 1, s, new Rng(seed + i))));
  return { w, me, raids };
}

describe('the day\'s raids', () => {
  const plans = (phase: 'channel' | 'london', n = 60) => Array.from({ length: n }, (_, i) => planRaids(new Rng(100 + i), phase, home, map, false));

  it('September brings two or three raids at once more often than not; July mostly one', () => {
    const multi = (ps: RaidSpec[][]) => ps.filter((p) => p.filter((r) => r.name !== 'freehunt').length > 1).length / ps.length;
    expect(multi(plans('london'))).toBeGreaterThan(0.6);
    expect(multi(plans('channel'))).toBeLessThan(0.55);
    expect(plans('london').some((p) => p.filter((r) => r.name !== 'freehunt').length === 3)).toBe(true);
  });

  it('raids go for different targets and start minutes apart', () => {
    for (const p of plans('london', 30)) {
      const raids = p.filter((r) => r.name !== 'freehunt');
      expect(new Set(raids.map((r) => r.targetName)).size).toBe(raids.length);
      for (let i = 1; i < raids.length; i++) expect(raids[i].delay - raids[i - 1].delay).toBeGreaterThanOrEqual(TUNING.sky.raidGap[0]);
    }
  });

  it('now and then a free hunt of 109s roves over Kent, high and on its own', () => {
    const hunts = plans('london').flatMap((p) => p.filter((r) => r.name === 'freehunt'));
    expect(hunts.length).toBeGreaterThan(5);
    for (const h of hunts) {
      expect(h.kind).toBe('sweep');
      expect(h.alt).toBeGreaterThan(6000);
      expect(h.groups.every((g) => g.type === 'bf109' && g.role === 'sweep')).toBe(true);
    }
  });

  it('a raid works on its own copy of the plan, so losses out of sight never reach a replay', () => {
    const spec = raidSpec('r');
    const r = new Raid(1, spec, new Rng(1));
    r.loseUnseen();
    r.loseUnseen();
    expect(r.bombersLeft).toBe(10);
    expect(spec.groups[0].count).toBe(12);
  });
});

describe('other squadrons', () => {
  const sq = (raidId: number, base = new Vec3(30000, 50, 30000), seed = 7) =>
    new OtherSquadron({ callsign: 'Tiger', type: 'hurricane', count: 12, base, baseName: 'Somewhere', raidId, scrambleAt: 0, formation: 'vic' }, new Rng(seed));

  it('out of sight, they climb, intercept and fight the raid: bombers fall and the raid may turn back', () => {
    let turned = 0, kills = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const { w, me, raids } = worldWith(seed, raidSpec('r', 0, 0, 'airfield', 120000));
      me.fs.setAirborne(new Vec3(-90000, 3000, -90000), 0, 100); // far away: nothing becomes real
      const o = sq(raids[0].id, new Vec3(30000, 50, 15000), seed);
      const events: string[] = [];
      o.onEvent = (e) => events.push(e);
      for (let i = 0; i < 25 * 60 * 50 && o.state !== 'down'; i++) { w.step(null); o.step(TUNING.sim.dt, w, me, w.time); }
      expect(o.real).toBe(false);
      expect(events).toContain('airborne');
      expect(events).toContain('engaging');
      expect(o.fought.has(raids[0].id)).toBe(true);
      kills += o.unseenKills;
      expect(raids[0].bombersLeft).toBe(12 - o.unseenKills);
      if (raids[0].turnedBack) turned++;
    }
    expect(kills).toBeGreaterThan(6);
    expect(turned).toBeGreaterThan(0);
  });

  it('near you, they become real aircraft in formation, going for the raid', () => {
    const { w, me, raids } = worldWith(2, raidSpec('r'));
    const o = sq(raids[0].id, new Vec3(8000, 50, 0));
    me.fs.setAirborne(new Vec3(4000, 3000, 2000), 0, 100);
    for (let i = 0; i < 30 * 50 && !o.real; i++) { w.step(null); o.step(TUNING.sim.dt, w, me, w.time); }
    expect(o.real).toBe(true);
    expect(o.planes.length).toBe(12);
    expect(o.planes.every((p) => p.side === 'raf' && p.brain instanceof FighterBrain && p.home)).toBe(true);
    expect((o.planes[1].brain as FighterBrain).opts.leader).toBe(o.planes[0]);
    // Just off their airfield, they appear climbing out, clear of the ground.
    expect(Math.min(...o.planes.map((p) => p.pos.y))).toBeGreaterThanOrEqual(300);
    // They're after the raid.
    const leader = o.planes[0].brain as FighterBrain;
    expect(leader.opts.waypoint!.distTo(raids[0].plot)).toBeLessThan(1000);
  });

  it('their job done and out of sight, they are put down at their base', () => {
    const { w, me, raids } = worldWith(3, raidSpec('r'));
    const o = sq(raids[0].id, new Vec3(8000, 50, 0));
    me.fs.setAirborne(new Vec3(4000, 3000, 2000), 0, 100);
    for (let i = 0; i < 30 * 50 && !o.real; i++) { w.step(null); o.step(TUNING.sim.dt, w, me, w.time); }
    raids[0].turnedBack = true;
    raids[0].phase = 'outbound';
    me.fs.setAirborne(new Vec3(-80000, 3000, -80000), 0, 100);
    for (let i = 0; i < 5 * 50; i++) { w.step(null); o.step(TUNING.sim.dt, w, me, w.time); }
    expect(o.planes.every((p) => p.status === 'landed')).toBe(true);
    expect(Math.hypot(o.planes[0].pos.x - 8000, o.planes[0].pos.z)).toBeLessThan(1);
  });
});

describe('the controller keeps you on one raid', () => {
  const view = (w: World, raids: Raid[], pos: Vec3): ControllerView => ({
    time: w.time, pos, speed: 100, raids, engaged: false, wantsHome: false, fromSector: 0, overFrance: false, offMap: false, describe: () => 'near X',
  });

  it('stays on the raid it gave you though another comes nearer, until told otherwise', () => {
    const { w, raids } = worldWith(4, raidSpec('a', 0), raidSpec('b', 30000));
    for (let i = 0; i < 50; i++) w.step(null);
    const c = new SectorController('Gannet', 'Sapper', 1);
    c.step(view(w, raids, new Vec3(0, 3000, 30000)));
    expect(c.targetRaid).toBe(raids[0]);
    c.step(view(w, raids, new Vec3(30000, 3000, 30000)));
    expect(c.targetRaid).toBe(raids[0]);
    c.assign(raids[1], w.time);
    expect(c.targetRaid).toBe(raids[1]);
    expect(c.lastVector).toBeNull();
  });

  it('prefers a raid bringing bombs to a fighter sweep', () => {
    const { w, raids } = worldWith(5, raidSpec('sweep', 0, 0, 'sweep'), raidSpec('bombers', 30000));
    for (let i = 0; i < 50; i++) w.step(null);
    const c = new SectorController('Gannet', 'Sapper', 1);
    c.step(view(w, raids, new Vec3(0, 3000, 5000)));
    expect(c.targetRaid).toBe(raids[1]);
  });
});

describe('markers: what you were sent after, and what you could really see', () => {
  function spawned(seed: number, ...specs: RaidSpec[]) {
    const r = worldWith(seed, ...specs);
    for (let i = 0; i < 50; i++) r.w.step(null);
    for (const raid of r.raids) raid.spawn(r.w, new Rng(seed));
    return r;
  }

  it('the raid you were vectored on is marked far off; another formation only once it is close', () => {
    const { w, me, raids } = spawned(6, raidSpec('target', 0), raidSpec('other', 20000));
    me.fs.setAirborne(new Vec3(0, 4000, -20000), 0, 100);
    const units = (gs: ReturnType<typeof enemyGroups>) => new Set(gs.flatMap((g) => g.members.map((m) => m.unit)));
    let seen = units(enemyGroups(w, me, raids[0]));
    expect(seen.has('target')).toBe(true);
    expect(seen.has('other')).toBe(false);
    me.fs.setAirborne(new Vec3(20000, 4000, -5000), 0, 100);
    seen = units(enemyGroups(w, me, raids[0]));
    expect(seen.has('other')).toBe(true);
  });

  it('a formation up in the sun is not marked, however close', () => {
    const { w, me, raids } = spawned(7, raidSpec('target', 0), raidSpec('hunt', 20000, 0, 'sweep'));
    const hunt = raids[1].planes[0].pos;
    // Put ourselves below and down-sun of the hunt.
    w.sun.set(0, 1, 0);
    me.fs.setAirborne(new Vec3(hunt.x, hunt.y - 3000, hunt.z), 0, 100);
    const units = new Set(enemyGroups(w, me, raids[0]).flatMap((g) => g.members.map((m) => m.unit)));
    expect(units.has('hunt')).toBe(false);
  });

  it('only the vectored raid is reported from the radar', () => {
    const { w, me, raids } = worldWith(8, raidSpec('a', 0), raidSpec('b', 30000));
    me.fs.setAirborne(new Vec3(0, 4000, -60000), 0, 100); // out of range: the raids stay radar plots
    for (let i = 0; i < 50; i++) w.step(null);
    const reported = enemyGroups(w, me, raids[0]).filter((g) => g.reported);
    expect(reported.length).toBe(1);
    expect(reported[0].pos.x).toBeCloseTo(raids[0].plot.x, -2);
    // Without a controller (the 109 side) nothing changes: every radar plot near is shown.
    expect(enemyGroups(w, me).filter((g) => g.reported).length).toBe(2);
  });
});

describe('a sortie with others up', () => {
  function spec(seed: number, o: Partial<SortieSpec> = {}): SortieSpec {
    const rng = new Rng(seed);
    return {
      seed, month: 9, day: 15, hour: 13, weather: { ...generateWeather(rng, 9), cover: 0 }, phase: 'london',
      home: home.name, playerType: 'spitfire', playerName: 'P/O Test', squadron: 'Gannet', controller: 'Sapper',
      leading: true, others: [], raids: planRaids(rng, 'london', home, map, false, 2), start: 'readiness', convergenceM: 274,
      underAttack: false, fatigue: 0, assist: true, ...o,
    };
  }

  it('other squadrons are sent after the raids, never with our own callsign', () => {
    let total = 0, wings = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const s = new Sortie(spec(seed), map, objects);
      total += s.others.length;
      if (s.others.some((o) => o.spec.bigWing)) wings++;
      for (const o of s.others) {
        expect(o.spec.callsign).not.toBe('Gannet');
        expect(s.world.raids.some((r) => r.id === o.raidId && r.bombing)).toBe(true);
      }
    }
    expect(total).toBeGreaterThan(10);
    expect(wings).toBeGreaterThan(0);
  });

  it('can be switched off', () => {
    expect(new Sortie(spec(1, { otherSquadrons: false }), map, objects).others.length).toBe(0);
  });
});
