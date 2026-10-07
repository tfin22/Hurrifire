// The fight around the player: the squadron goes in with them and talks on
// the R/T, the escort comes down on whoever attacks the bombers, and bomber
// crews lose their nerve, jettison and turn for home.

import { describe, expect, it } from 'vitest';
import { Vec3 } from '../src/core/math';
import { Rng } from '../src/core/rng';
import { worldMap } from '../src/content/world/map';
import { WorldObjects } from '../src/content/world/objects';
import { BomberBrain, RaidLink } from '../src/sim/ai/bomber';
import { FighterBrain } from '../src/sim/ai/fighter';
import { WingmanBrain } from '../src/sim/ai/wingman';
import type { AIContext, SkillLevel } from '../src/sim/ai/types';
import { skillFor } from '../src/sim/ai/types';
import { GroundModel } from '../src/sim/ground';
import { Plane } from '../src/sim/plane';
import { Raid } from '../src/sim/raid';
import { arcadeSpec, generateRaids, Sortie, SortieSpec } from '../src/sim/sortie';
import { generateWeather } from '../src/sim/weather';
import { World } from '../src/sim/world';
import { TUNING } from '../src/tuning';

const flat: GroundModel = { heightAt: () => 0, surfaceAt: () => 'pasture' };
const run = (w: World, secs: number, each?: () => void) => { for (let i = 0; i < secs * 50; i++) { each?.(); w.step(null); } };

function link(lead: () => Plane | null): RaidLink & { jettisoned: number } {
  return {
    leader: lead,
    route: [new Vec3(0, 4000, 0), new Vec3(0, 4000, 30000), new Vec3(0, 4000, -40000)],
    speed: 95, alt: 4000, target: new Vec3(0, 0, 30000),
    release(p) { p.bombs = 0; },
    jettison(p) { p.bombs = 0; this.jettisoned++; },
    lastAttacked: -99, home: new Vec3(0, 0, -60000), phase: 'inbound', jettisoned: 0,
  };
}

/** A bomber pair heading north; a Spitfire comes at the wingman head-on, `passes` times. */
function headOn(level: SkillLevel, passes: number) {
  const w = new World(5, flat);
  w.sun.set(0, 1, 0);
  const lead = w.addPlane('he111', 'lw', 'A1+AA');
  const wing = w.addPlane('he111', 'lw', 'A1+AB');
  wing.skill = skillFor(level);
  const l = link(() => lead);
  lead.fs.setAirborne(new Vec3(0, 4000, 0), 0, 95);
  wing.fs.setAirborne(new Vec3(40, 3990, -40), 0, 95);
  lead.brain = new BomberBrain(l, new Vec3(0, 0, 0));
  const wb = new BomberBrain(l, new Vec3(30, -5, -30));
  wing.brain = wb;
  const spit = w.addPlane('spitfire', 'raf', 'Red 1');
  for (let i = 0; i < passes; i++) {
    // Nose on from 600 m, a little above so nobody collides.
    spit.fs.setAirborne(wing.pos.clone().add(wing.fs.forward().scale(600)).add(new Vec3(0, 40, 0)), wing.fs.heading + Math.PI, 130);
    run(w, 6);
  }
  run(w, 60);
  return { wing, wb, l };
}

describe('bomber crews under attack', () => {
  it('a green crew, met head-on again and again, jettisons and turns for home in a sound aircraft', () => {
    const { wing, wb, l } = headOn('green', 3);
    expect(wb.broken).toBe(true);
    expect(wb.state).toBe('straggler');
    expect(l.jettisoned).toBe(1);
    expect(wing.status).toBe('flying');
    expect(Math.cos(wing.fs.heading)).toBeLessThan(-0.7); // south, for France
  });

  it('an experienced crew takes the same and holds formation', () => {
    const { wb, l } = headOn('experte', 3);
    expect(wb.broken).toBe(false);
    expect(wb.state).toBe('formation');
    expect(l.jettisoned).toBe(0);
  });

  it('left alone, nerve comes back', () => {
    const w = new World(6, flat);
    const b = w.addPlane('he111', 'lw', 'A1+AA');
    const l = link(() => b);
    b.fs.setAirborne(new Vec3(0, 4000, 0), 0, 95);
    const brain = new BomberBrain(l, new Vec3());
    b.brain = brain;
    run(w, 1);
    brain.shake(b, 0.5, w.time);
    const shaken = brain.nerve;
    run(w, TUNING.ai.nerveCalm + 20);
    expect(brain.nerve).toBeGreaterThan(shaken + 0.2);
  });
});

function raidSpec() {
  return {
    name: 'r', kind: 'airfield' as const, targetName: 'x', target: new Vec3(0, 0, 60000), start: new Vec3(0, 4000, 0), entry: new Vec3(0, 4000, 20000),
    alt: 4000, speed: 90, delay: 0,
    groups: [
      { type: 'he111' as const, count: 6, role: 'bomber' as const, altOffset: 0, skill: 'average' as const },
      { type: 'bf109' as const, count: 4, role: 'closeEscort' as const, altOffset: 500, skill: 'average' as const },
    ],
  };
}

function spawned(seed: number) {
  const w = new World(seed, flat);
  w.sun.set(0, 1, 0);
  const r = new Raid(1, raidSpec(), new Rng(seed));
  w.addRaid(r);
  run(w, 1);
  r.spawn(w, new Rng(seed));
  return { w, r };
}

describe('raid reactions', () => {
  it('a bomber going down shakes the crews alongside it', () => {
    const { w, r } = spawned(7);
    run(w, 1);
    const [victim, ...rest] = r.bombers;
    w.goDown(victim);
    run(w, 0.2);
    const near = rest.filter((b) => b.pos.distTo(victim.pos) < TUNING.ai.lossRange);
    expect(near.length).toBeGreaterThan(0);
    for (const b of near) expect((b.brain as BomberBrain).nerve).toBeLessThan(TUNING.ai.bomberNerve.average);
  });

  it('the escort comes down on a fighter shooting at the bombers, even one it never saw', () => {
    const { w, r } = spawned(8);
    // Blind escorts: only the bombers' call can tell them.
    for (const e of r.escorts) e.skill = { ...e.skill, spot: 0 };
    const spit = w.addPlane('spitfire', 'raf', 'Red 1');
    const b = r.bombers[3];
    spit.fs.setAirborne(b.pos.clone().add(b.fs.forward().scale(-400)).add(new Vec3(0, -60, 0)), b.fs.heading, 110);
    run(w, 1);
    const knows = () => r.escorts.filter((e) => (e.brain as FighterBrain).contacts.knows(spit.id)).length;
    expect(knows()).toBe(0);
    b.brain!.onHit!(b, spit.id, (w as unknown as { ctx: AIContext }).ctx);
    run(w, TUNING.ai.escortReaction.average + 2, () => spit.fs.setAirborne(b.pos.clone().add(b.fs.forward().scale(-400)).add(new Vec3(0, -60, 0)), b.fs.heading, 110));
    expect(knows()).toBeGreaterThan(0);
    expect(r.escorts.some((e) => (e.brain as FighterBrain).targetId === spit.id)).toBe(true);
  });
});

const map = worldMap();
const objects = new WorldObjects(map);

function sortieSpec(seed: number, o: Partial<SortieSpec> = {}): SortieSpec {
  const rng = new Rng(seed);
  const home = map.airfieldByName('Biggin Hill')!;
  return {
    seed, month: 8, day: 18, hour: 13, weather: { ...generateWeather(rng, 8), cover: 0 }, phase: 'airfields',
    home: home.name, playerType: 'spitfire', playerName: 'P/O Test', squadron: 'Gannet', controller: 'Sapper',
    leading: true, others: [1, 2, 3, 4, 5].map((i) => ({ name: `Sgt ${i}`, skill: 'average' as const, fatigue: 0 })),
    raids: generateRaids(rng, 'airfields', home, map, false, 1), start: 'readiness', convergenceM: 274,
    underAttack: false, fatigue: 0, assist: true, ...o,
  };
}

const straight = { pitch: 0, roll: 0, yaw: 0, throttle: 1, fire: false, boost: false, brake: false, pump: false };

describe('the squadron', () => {
  it('leading, the squadron goes in with you once the enemy is close, without waiting for tally-ho', () => {
    const s = new Sortie(arcadeSpec(sortieSpec(11)), map, objects);
    const wingmen = s.formation.filter((q) => q !== s.player).map((q) => q.brain as WingmanBrain);
    expect(wingmen.every((b) => b.order === 'reform')).toBe(true);
    for (let i = 0; i < 120 * 50 && !s.engaged; i++) s.step(straight);
    expect(s.engaged).toBe(true);
    expect(wingmen.every((b) => b.order === 'bombers')).toBe(true);
    expect(s.controller.log.some((m) => m.from === 'player' && m.text.startsWith('Tally-ho'))).toBe(true);
  });

  it('opening fire with the enemy about takes the squadron in', () => {
    const s = new Sortie(arcadeSpec(sortieSpec(12)), map, objects);
    let fired = -1;
    for (let i = 0; i < 120 * 50 && !s.engaged; i++) {
      const near = s.world.planes.some((q) => q.side === 'lw' && q.alive && q.pos.distTo(s.player.pos) < TUNING.sortie.tallyRange);
      if (near && fired < 0) fired = i;
      s.step({ ...straight, fire: near });
    }
    expect(fired).toBeGreaterThanOrEqual(0);
    expect(s.engaged).toBe(true);
    // Gone in on the guns, well before anyone got close.
    const nearest = Math.min(...s.world.planes.filter((q) => q.side === 'lw' && q.alive).map((q) => q.pos.distTo(s.player.pos)));
    expect(nearest).toBeGreaterThan(TUNING.sortie.autoTallyRange);
  });

  it('section callsigns: Red leads, then Yellow', () => {
    const s = new Sortie(sortieSpec(13), map, objects);
    expect(s.callOf(s.formation[0])).toBe('Gannet Leader');
    expect(s.callOf(s.formation[1])).toBe('Red Two');
    expect(s.callOf(s.formation[3])).toBe('Yellow One');
  });

  it('a wingman calls his kills and his losses on the R/T', () => {
    const s = new Sortie(arcadeSpec(sortieSpec(14)), map, objects);
    for (let i = 0; i < 50; i++) s.step(straight);
    const w = s.world;
    const wing = s.formation[1];
    const enemy = w.addPlane('he111', 'lw', 'A1+AA');
    enemy.fs.setAirborne(wing.pos.clone().add(new Vec3(0, 0, 3000)), 0, 90);
    enemy.damage.by[wing.id] = 50;
    w.goDown(enemy);
    s.step(straight);
    expect(s.controller.log.some((m) => m.text.startsWith('Red Two: got a He 111'))).toBe(true);
    w.goDown(s.formation[2]);
    s.step(straight);
    expect(s.controller.log.some((m) => m.text.startsWith("Red Three here, I've been hit"))).toBe(true);
  });
});
