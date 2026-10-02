// Getting home and getting down: the R/T homing, airfield markings, switching
// off after landing, and the reprimand for a needless forced landing.

import { describe, expect, it } from 'vitest';
import { Vec3 } from '../src/core/math';
import { Rng } from '../src/core/rng';
import { worldMap } from '../src/content/world/map';
import { WorldObjects } from '../src/content/world/objects';
import { airfieldMarking } from '../src/render/worldLayer';
import { evaluateTouchdown } from '../src/sim/landing';
import { generateRaids, homingTo, Sortie, SortieSpec } from '../src/sim/sortie';
import { generateWeather } from '../src/sim/weather';
import { applySortie, newCampaign } from '../src/campaign/campaign';
import type { ControlFrame, SimCmd } from '../src/input/input';
import { TUNING } from '../src/tuning';

const map = worldMap();
const objects = new WorldObjects(map);

function spec(seed: number, o: Partial<SortieSpec> = {}): SortieSpec {
  const rng = new Rng(seed);
  const home = map.airfieldByName('Biggin Hill')!;
  return {
    seed, month: 8, day: 18, hour: 13, weather: { ...generateWeather(rng, 8), cover: 0.15 }, phase: 'airfields',
    home: home.name, playerType: 'spitfire', playerName: 'P/O Test', squadron: 'Gannet', controller: 'Sapper',
    leading: true, others: [], raids: generateRaids(rng, 'airfields', home, map, false, 1), start: 'air', convergenceM: 274,
    underAttack: false, fatigue: 0, assist: true, airStart: { pos: new Vec3(home.pos.x + 15000, 2000, home.pos.z + 9000), heading: 0 }, ...o,
  };
}

const frame = (o: Partial<ControlFrame> = {}, cmds?: SimCmd[]): ControlFrame =>
  ({ pitch: 0, roll: 0, yaw: 0, throttle: 0.7, fire: false, boost: false, brake: false, pump: false, ...o, ...(cmds ? { cmds } : {}) });

/** Put the player down rolling in the middle of a big field away from any airfield. */
function rollingInField(s: Sortie, speed: number): void {
  const p = s.player, fs = p.fs;
  const home = s.base.pos;
  // The longest pasture or stubble field in a few km of the start.
  let best: { x: number; z: number; len: number; dir: number } | null = null;
  for (let i = 0; i < 400; i++) {
    const x = home.x + 6000 + (i % 20) * 400, z = home.z + 4000 + Math.floor(i / 20) * 400;
    const f = map.fieldAt(x, z);
    if (f.surface !== 'pasture' && f.surface !== 'stubble') continue;
    if (map.airfieldAt(x, z)) continue;
    const lx = f.x1 - f.x0, lz = f.z1 - f.z0, len = Math.max(lx, lz);
    if (!best || len > best.len) best = { x: (f.x0 + f.x1) / 2, z: (f.z0 + f.z1) / 2, len, dir: lx > lz ? Math.PI / 2 : 0 };
  }
  expect(best!.len).toBeGreaterThan(250);
  // Start at the near end and roll along the long axis.
  const sx = best!.x - Math.sin(best!.dir) * (best!.len / 2 - 40), sz = best!.z - Math.cos(best!.dir) * (best!.len / 2 - 40);
  fs.setOnGround(new Vec3(sx, map.heightAt(sx, sz) + p.type.gearHeight, sz), best!.dir);
  fs.engine = 'running';
  fs.vel.set(Math.sin(best!.dir) * speed, 0, Math.cos(best!.dir) * speed);
  p.landing.result = evaluateTouchdown({ sinkRate: 1, airspeed: 40, stallSpeed: 33, groundSpeed: 40, bank: 0, pitch: p.type.groundAttitude, drift: 0, gear: 'down', surface: 'pasture', threePoint: p.type.groundAttitude, fire: 0, luck: 0.5 });
  p.landing.field = map.fieldAt(sx, sz);
}

describe('homing', () => {
  it('the controller answers with a course to the nearest RAF field, and a landing direction into the wind', () => {
    const s = new Sortie(spec(4), map, objects);
    s.step(frame({}, ['homing']));
    expect(s.homing).toBeNull();
    for (let t = 0; t < TUNING.sortie.homingDelay + 1; t += TUNING.sim.dt) s.step(frame());
    expect(s.homing).not.toBeNull();
    const h = s.homing!;
    expect(h.field.kind).not.toBe('luftwaffe');
    const me = s.player.pos;
    const nearest = map.nearestAirfield(me.x, me.z, true);
    expect(h.field).toBe(nearest);
    const log = s.controller.log.map((m) => m.text).join('\n');
    expect(log).toMatch(/Request homing/);
    expect(log).toMatch(new RegExp(`Steer .* for ${h.field.name}`));
    // Into wind: the landing direction has the wind against it.
    const w = s.world.weather.wind;
    if (Math.hypot(w.x, w.z) > 0.5) expect(Math.sin(h.landDir) * w.x + Math.cos(h.landDir) * w.z).toBeLessThanOrEqual(0);
  });

  it('a 109 gets one of its own fields', () => {
    const [x, z] = [map.airfieldByName('Marquise')!.pos.x + 5000, map.airfieldByName('Marquise')!.pos.z];
    const h = homingTo(map, new Vec3(x, 2000, z), false, new Vec3(3, 0, 0), ['Marquise', 'Calais-Marck']);
    expect(['Marquise', 'Calais-Marck']).toContain(h.field.name);
    expect(Math.sin(h.landDir) * 3).toBeLessThanOrEqual(0);
  });
});

describe('airfields from the air', () => {
  it('every airfield has a marking with its landing run inside the grass square', () => {
    for (const a of map.airfields) {
      const m = airfieldMarking(a);
      expect(m.faces.length).toBeGreaterThanOrEqual(6);
      for (let i = 0; i < m.verts.length; i += 3) {
        expect(Math.abs(m.verts[i])).toBeLessThanOrEqual(a.half + 0.01);
        expect(Math.abs(m.verts[i + 2])).toBeLessThanOrEqual(a.half + 0.01);
      }
    }
  });
});

describe('down in a field', () => {
  it('rolling with the throttle open goes on; switching off brakes to a stop and ends the sortie', () => {
    const s = new Sortie(spec(5), map, objects);
    rollingInField(s, 12);
    for (let t = 0; t < 4; t += TUNING.sim.dt) s.step(frame({ throttle: 0.25 }));
    expect(s.player.status).toBe('flying');
    s.step(frame({ throttle: 0.25 }, ['engineOff']));
    expect(s.player.fs.engine).toBe('off');
    for (let t = 0; t < 30 && !s.result; t += TUNING.sim.dt) s.step(frame({ throttle: 0.25 }));
    expect(s.player.status).toBe('landed');
    expect(s.result).not.toBeNull();
    const o = s.result!.outcome;
    expect(o.kind).toBe('forced');
    expect(o.writtenUp).toMatch(/written up/);
  });

  it('a forced landing with a real reason is not written up', () => {
    const s = new Sortie(spec(6), map, objects);
    rollingInField(s, 8);
    s.player.damage.glycol = 0.5;
    s.step(frame({ throttle: 0 }, ['engineOff']));
    for (let t = 0; t < 30 && !s.result; t += TUNING.sim.dt) s.step(frame({ throttle: 0 }));
    expect(s.result!.outcome.kind).toBe('forced');
    expect(s.result!.outcome.writtenUp).toBeUndefined();
  });

  it('a reprimand goes on the campaign record and holds promotion back', () => {
    const c = newCampaign(7, { surname: 'Fenwick', home: 'Biggin Hill', aircraft: 'spitfire', ironman: true });
    const base = { date: '', aircraft: '', durationMin: 40, takeoffDelay: 60, claims: [], roundsFired: 0, damageTaken: 0, damageNotes: [], raidNotes: [], raidsTurned: 0, raidsBombed: 0, bombsOnTargetKg: 0, losses: [], enemyDown: 0, logLine: '', rtLog: [], engaged: false, fates: [], squadronKills: 0, airfieldHits: {} };
    const news = applySortie(c, { ...base, outcome: { kind: 'forced', pilot: 'fine', aircraft: 'fine', place: 'Ashford', line: '', writtenUp: 'Written up.' } });
    expect(c.player.writeUps).toBe(1);
    expect(news.join(' ')).toMatch(/reprimand/i);
    expect(news.join(' ')).toMatch(/fetches it back/);
  });
});

describe('the docking computer', () => {
  /** Ask for a homing and wait for the answer. */
  function homed(seed: number): Sortie {
    const s = new Sortie(spec(seed), map, objects);
    s.step(frame({}, ['homing']));
    for (let t = 0; t < TUNING.sortie.homingDelay + 0.5; t += TUNING.sim.dt) s.step(frame());
    expect(s.homing).not.toBeNull();
    return s;
  }

  it('jumps to finals and lands her at the homing field, hands off; the sortie ends as a good landing', () => {
    const s = homed(11);
    s.step(frame({}, ['jumpHome']));
    expect(s.docking.active).toBe(true);
    const field = s.homing!.field;
    expect(s.player.pos.distTo(field.pos)).toBeLessThan(TUNING.docking.finalM + field.len);
    let t = 0;
    for (; t < 180 && !s.result; t += TUNING.sim.dt) s.step(frame({ throttle: 0.7 }));
    expect(s.result, `${s.player.status} after ${t.toFixed(0)} s`).not.toBeNull();
    const o = s.result!.outcome;
    expect(o.kind).toBe('landed');
    expect(o.pilot).toBe('fine');
    expect(o.writtenUp).toBeUndefined();
    expect(map.airfieldAt(s.player.pos.x, s.player.pos.z)).toBe(field);
  });

  it('lands her in Arcade too (quicker controls, more thrust)', () => {
    const s = homed(15);
    s.world.arcade = true;
    s.world.stallGuard = true;
    s.step(frame({}, ['jumpHome']));
    for (let t = 0; t < 180 && !s.result; t += TUNING.sim.dt) s.step(frame({ throttle: 0.7 }));
    expect(s.result?.outcome.kind).toBe('landed');
    expect(s.result?.outcome.pilot).toBe('fine');
  });

  it('moving the stick takes her back', () => {
    const s = homed(12);
    s.step(frame({}, ['jumpHome']));
    for (let t = 0; t < 2; t += TUNING.sim.dt) s.step(frame());
    expect(s.docking.active).toBe(true);
    s.step(frame({ pitch: 0.8 }));
    expect(s.docking.active).toBe(false);
  });

  it('won\'t jump without a homing, or with the enemy about', () => {
    const s = new Sortie(spec(13), map, objects);
    s.step(frame({}, ['jumpHome']));
    expect(s.docking.active).toBe(false);
    expect(s.prompts.join(' ')).toMatch(/HOMING FIRST/);
    const h = homed(14);
    h.world.raids[0].spawn(h.world, h.world.rng);
    const q = h.world.planes.find((p) => p.side === 'lw')!;
    q.fs.setAirborne(h.player.pos.clone().add(new Vec3(2000, 0, 0)), 0, 100);
    h.step(frame({}, ['jumpHome']));
    expect(h.docking.active).toBe(false);
    expect(h.prompts.join(' ')).toMatch(/ENEMY/);
  });
});
