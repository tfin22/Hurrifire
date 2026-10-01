import { describe, expect, it } from 'vitest';
import { Vec3 } from '../src/core/math';
import { BomberBrain, RaidLink } from '../src/sim/ai/bomber';
import { DefensiveCircle, FighterBrain } from '../src/sim/ai/fighter';
import { WingmanBrain } from '../src/sim/ai/wingman';
import { TUNING } from '../src/tuning';
import { GroundModel } from '../src/sim/ground';
import { Plane } from '../src/sim/plane';
import { World } from '../src/sim/world';

const flat: GroundModel = { heightAt: () => 0, surfaceAt: () => 'pasture' };

function run(w: World, secs: number, each?: () => void) {
  for (let i = 0; i < secs * 50; i++) {
    each?.();
    w.step(null);
  }
}

/** A minimal raid: fly north to a target 30 km away, home is south. */
function raidLink(lead: () => Plane | null): RaidLink & { released: number; jettisoned: number } {
  return {
    leader: lead,
    route: [new Vec3(0, 4000, 0), new Vec3(0, 4000, 30000), new Vec3(0, 4000, -40000)],
    speed: 95, alt: 4000, target: new Vec3(0, 0, 30000),
    release(p) { p.bombs = 0; this.released++; },
    jettison(p) { p.bombs = 0; this.jettisoned++; },
    lastAttacked: -99, home: new Vec3(0, 0, -60000), phase: 'inbound',
    released: 0, jettisoned: 0,
  };
}

function bomberPair(seed = 1) {
  const w = new World(seed, flat);
  w.sun.set(0, 1, 0);
  const lead = w.addPlane('he111', 'lw', 'A1+AA');
  const wing = w.addPlane('he111', 'lw', 'A1+AB');
  const link = raidLink(() => lead);
  lead.fs.setAirborne(new Vec3(0, 4000, 0), 0, 95);
  wing.fs.setAirborne(new Vec3(40, 3990, -40), 0, 95);
  lead.brain = new BomberBrain(link, new Vec3(0, 0, 0));
  const wb = new BomberBrain(link, new Vec3(30, -5, -30));
  wing.brain = wb;
  return { w, lead, wing, link, wb };
}

describe('bomber formation', () => {
  it('a wingman keeps station on the leader', () => {
    const { w, lead, wing, wb } = bomberPair();
    run(w, 40);
    const slot = lead.fs.q.rotate(new Vec3(30, -5, -30)).add(lead.pos);
    expect(wing.alive).toBe(true);
    expect(wb.state).toBe('formation');
    expect(wing.pos.distTo(slot)).toBeLessThan(120);
  });

  it('an engine out: drops out, jettisons, turns for home', () => {
    const { w, wing, link, wb } = bomberPair(2);
    run(w, 5);
    wing.damage.engines[0] = 0;
    run(w, 90);
    expect(wb.state).toBe('straggler');
    expect(link.jettisoned).toBe(1);
    expect(Math.cos(wing.fs.heading)).toBeLessThan(-0.7); // heading south
  });

  it('on fire: the crew bail out', () => {
    const { w, wing, wb } = bomberPair(3);
    run(w, 2);
    wing.damage.fire = 20;
    run(w, 1);
    expect(wb.state).toBe('bail');
    expect(wing.bailing).toBe(true);
  });

  it('the leader releases over the target on the bomb run', () => {
    const { w, lead, link } = bomberPair(4);
    lead.fs.setAirborne(new Vec3(0, 4000, 22000), 0, 95);
    link.phase = 'bombRun';
    run(w, 60);
    expect(link.released).toBeGreaterThan(0);
  });
});

describe('the 110 defensive circle', () => {
  function circleSetup(seed = 1) {
    const w = new World(seed, flat);
    w.sun.set(0, 1, 0);
    const circle: DefensiveCircle = { centre: null, radius: 600, dir: 1, lastThreat: -99 };
    const zs = [0, 1, 2].map((i) => {
      const p = w.addPlane('bf110', 'lw', `3U+A${i}`);
      p.fs.setAirborne(new Vec3(i * 60, 4000, -i * 60), 0, 110);
      p.brain = new FighterBrain({ waypoint: new Vec3(0, 4000, 60000), circle });
      return p;
    });
    const spit = w.addPlane('spitfire', 'raf', 'Target');
    spit.fs.setAirborne(new Vec3(0, 4500, -2500), 0, 140);
    return { w, circle, zs, spit };
  }

  it('forms when RAF fighters close in, and every 110 joins', () => {
    const { w, circle, zs, spit } = circleSetup();
    for (const z of zs) (z.brain as FighterBrain).contacts.tell(spit.id, 0);
    run(w, 3);
    expect(circle.centre).not.toBeNull();
    for (const z of zs) expect((z.brain as FighterBrain).state).toBe('circle');
  });

  it('they keep turning round a shared centre', () => {
    const { w, circle, zs, spit } = circleSetup(2);
    for (const z of zs) (z.brain as FighterBrain).contacts.tell(spit.id, 0);
    const hdgs: number[] = [];
    run(w, 30, () => {
      spit.fs.setAirborne(zs[0].pos.clone().add(new Vec3(0, 600, -2000)), 0, 140); // hang about
      if (w.tick % 250 === 0) hdgs.push(zs[0].fs.heading);
    });
    const c = circle.centre!;
    for (const z of zs) expect(Math.hypot(z.pos.x - c.x, z.pos.z - c.z)).toBeLessThan(2000);
    // Heading moved through most of the compass.
    const spread = new Set(hdgs.map((h) => Math.round(((h + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 2)) % 4));
    expect(spread.size).toBeGreaterThanOrEqual(3);
  });

  it('breaks up and carries on once the threat has gone', () => {
    const { w, circle, zs, spit } = circleSetup(3);
    for (const z of zs) (z.brain as FighterBrain).contacts.tell(spit.id, 0);
    run(w, 3);
    spit.fs.setAirborne(new Vec3(0, 4000, -60000), 180, 140);
    run(w, 50);
    expect(circle.centre).toBeNull();
    for (const z of zs) expect((z.brain as FighterBrain).state).not.toBe('circle');
  });
});

describe('squadron formations', () => {
  it('a vic wingman watches his leader, not the sky; a pair spots better', () => {
    const w = new World(5, flat);
    const lead = w.addPlane('hurricane', 'raf', 'Lead');
    lead.fs.setAirborne(new Vec3(0, 3000, 0), 0, 110);
    const base = { x: 0, z: -20000, h: 0, dir: 0, half: 500 };
    const mk = (vic: boolean, i: number) => {
      const p = w.addPlane('hurricane', 'raf', `W${i}`);
      p.fs.setAirborne(new Vec3(-40 * (i + 1), 3000, -40), 0, 110);
      const b = new WingmanBrain(() => lead, new Vec3(-40 * (i + 1), 0, -40), base, i);
      b.vic = vic;
      b.phase = 'air';
      b.fighter.state = 'formation';
      p.brain = b;
      return p;
    };
    const v = mk(true, 0), pr = mk(false, 1);
    const spotV = v.skill.spot, spotP = pr.skill.spot;
    run(w, 2);
    expect(v.skill.spot).toBeCloseTo(spotV * TUNING.ai.vicSpotFactor, 5);
    expect(pr.skill.spot).toBeCloseTo(spotP, 5);
  });
});
