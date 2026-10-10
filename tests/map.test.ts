// The ops-room map: every raid and every group of hostiles, and every
// squadron of ours that's up, as the ops room had them.

import { describe, expect, it } from 'vitest';
import { Vec3 } from '../src/core/math';
import { Rng } from '../src/core/rng';
import { GroundModel } from '../src/sim/ground';
import { Raid, RaidSpec } from '../src/sim/raid';
import { OtherSquadron, OtherSquadronSpec } from '../src/sim/squadrons';
import { World } from '../src/sim/world';
import { OpsPlot } from '../src/screens/mapView';
import { TUNING } from '../src/tuning';

const flat: GroundModel = { heightAt: () => 0, surfaceAt: () => 'pasture' };

function raidSpec(x: number): RaidSpec {
  return {
    name: 'r', kind: 'airfield', targetName: 'x', target: new Vec3(x, 0, 80000), start: new Vec3(x, 4000, 0), entry: new Vec3(x, 4000, 20000),
    alt: 4500, speed: 90, delay: 0,
    groups: [{ type: 'he111', count: 12, role: 'bomber', altOffset: 0, skill: 'average' }, { type: 'bf109', count: 6, role: 'closeEscort', altOffset: 500, skill: 'average' }],
  };
}

function setup(...xs: number[]) {
  const w = new World(3, flat);
  const me = w.addPlane('spitfire', 'raf', 'Me');
  me.isPlayer = true;
  w.player = me;
  me.fs.setAirborne(new Vec3(-90000, 3000, -90000), 0, 100);
  const raids = xs.map((x, i) => w.addRaid(new Raid(i + 1, raidSpec(x), new Rng(i + 1))));
  return { w, me, raids };
}

const squadron = (raidId: number, o: Partial<OtherSquadronSpec> = {}) =>
  new OtherSquadron({ callsign: 'Tiger', type: 'hurricane', count: 12, base: new Vec3(0, 50, 60000), baseName: 'Somewhere', raidId, scrambleAt: 0, formation: 'vic', ...o }, new Rng(1));

const run = (w: World, secs: number, others: OtherSquadron[] = []) => {
  for (let i = 0; i < secs * 50; i++) { w.step(null); for (const o of others) o.step(TUNING.sim.dt, w, w.player!, w.time); }
};

describe('the ops-room map', () => {
  it('every raid on its way in, and every squadron of ours that\'s up, with a line to its raid', () => {
    const { w, raids } = setup(0, 40000);
    const others = [squadron(raids[0].id), squadron(raids[1].id, { callsign: 'Kestrel', base: new Vec3(40000, 50, 60000) })];
    run(w, 20, others);
    const plot = new OpsPlot();
    plot.update(w.raids, w.planes, others, 'raf', w.time);
    const hostile = plot.counters.filter((c) => c.hostile);
    const ours = plot.counters.filter((c) => !c.hostile);
    expect(hostile).toHaveLength(2);
    for (const c of hostile) { expect(c.label).toMatch(/^\d+\+$/); expect(c.sub).toMatch(/^A\d+$/); }
    expect(ours.map((c) => c.label).sort()).toEqual(['Kestrel', 'Tiger']);
    for (const c of ours) { expect(c.sub).toBe('12'); expect(c.to).not.toBeNull(); }
  });

  it('a raid in sight is shown as the groups it\'s in: bombers, escort, and anyone off on their own', () => {
    const { w, raids } = setup(0);
    run(w, 5);
    const r = raids[0];
    r.spawn(w, new Rng(1));
    const stray = r.escorts[0];
    stray.fs.setAirborne(r.plot.clone().add(new Vec3(15000, 0, 0)), 0, 120);
    const plot = new OpsPlot();
    plot.update(w.raids, w.planes, [], 'raf', w.time);
    const hostile = plot.counters.filter((c) => c.hostile);
    expect(hostile.length).toBe(2);
    expect(hostile.some((c) => c.pos.distTo(stray.pos) < 3000)).toBe(true);
  });

  it('a big wing goes on the table as one counter', () => {
    const { w, raids } = setup(0);
    const wing = ['Mitre', 'Caribou', 'Lion'].map((callsign, i) =>
      squadron(raids[0].id, { callsign, bigWing: true, base: new Vec3(i * 300, 50, 90000), offset: new Vec3(i * 300, 0, 0) }));
    run(w, 30, wing);
    const plot = new OpsPlot();
    plot.update(w.raids, w.planes, wing, 'raf', w.time);
    const ours = plot.counters.filter((c) => !c.hostile);
    expect(ours).toHaveLength(1);
    expect(ours[0].label).toBe('WING');
    expect(ours[0].sub).toBe('36');
  });

  it('two squadrons together are one counter; on their way, a line to the raid', () => {
    const { w, raids } = setup(0, 3000);
    const two = [squadron(raids[0].id), squadron(raids[1].id, { callsign: 'Kestrel', base: new Vec3(2000, 50, 60000) })];
    run(w, 20, two);
    const plot = new OpsPlot();
    plot.update(w.raids, w.planes, two, 'raf', w.time);
    const ours = plot.counters.filter((c) => !c.hostile);
    expect(ours).toHaveLength(1);
    expect(ours[0].label).toBe('2 SQNS');
    expect(ours[0].sub).toBe('24');
    // Sent after different raids: no one line.
    expect(ours[0].to).toBeNull();
    // And the two raids, close together, are one counter too.
    expect(plot.counters.filter((c) => c.hostile)).toHaveLength(1);
  });

  it('squadrons still on the ground, and raids gone home, are not on it', () => {
    const { w, raids } = setup(0);
    const later = squadron(raids[0].id, { scrambleAt: 600 });
    run(w, 5, [later]);
    const plot = new OpsPlot();
    plot.update(w.raids, w.planes, [later], 'raf', w.time);
    expect(plot.counters.filter((c) => !c.hostile)).toHaveLength(0);
    raids[0].turnBack();
    raids[0].plot.copy(raids[0].home);
    plot.update(w.raids, w.planes, [later], 'raf', w.time + TUNING.map.every);
    expect(plot.counters).toHaveLength(0);
  });

  it('flying a 109, the raids are ours and the RAF in sight are the hostiles', () => {
    const { w, raids } = setup(0);
    run(w, 5);
    const spit = w.addPlane('spitfire', 'raf', 'Spit');
    spit.fs.setAirborne(raids[0].plot.clone().add(new Vec3(20000, 0, 0)), 0, 120);
    const plot = new OpsPlot();
    plot.update(w.raids, w.planes, [], 'lw', w.time);
    expect(plot.counters.filter((c) => !c.hostile)).toHaveLength(1);
    // The Spitfire is plotted as a hostile.
    expect(plot.counters.filter((c) => c.hostile).some((c) => c.pos.distTo(spit.pos) < 3000)).toBe(true);
  });

  it('renewed every so often, not continuously', () => {
    const { w } = setup(0);
    run(w, 5);
    const plot = new OpsPlot();
    plot.update(w.raids, w.planes, [], 'raf', w.time);
    const at = plot.counters[0].pos.clone();
    run(w, 10);
    plot.update(w.raids, w.planes, [], 'raf', w.time);
    expect(plot.counters[0].pos.distTo(at)).toBe(0);
    run(w, TUNING.map.every);
    plot.update(w.raids, w.planes, [], 'raf', w.time);
    expect(plot.counters[0].pos.distTo(at)).toBeGreaterThan(500);
  });
});
