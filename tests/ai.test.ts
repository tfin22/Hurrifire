import { describe, expect, it } from 'vitest';
import { Quat, Vec3 } from '../src/core/math';
import { EYE } from '../src/sim/guns';
import { FighterBrain } from '../src/sim/ai/fighter';
import { skillFor } from '../src/sim/ai/types';
import { GroundModel } from '../src/sim/ground';
import { World } from '../src/sim/world';
import { neutralControls } from '../src/input/input';
import { idleControls } from '../src/sim/ai/pilot';

const flat: GroundModel = { heightAt: () => 0, surfaceAt: () => 'pasture' };

function setup(seed = 1) {
  const w = new World(seed, flat);
  w.sun.set(0, 1, 0); // overhead, out of the way
  const raf = w.addPlane('spitfire', 'raf', 'Target', 0.8);
  const lw = w.addPlane('bf109', 'lw', 'Gelb 1', 0.8);
  lw.skill = skillFor('experte');
  return { w, raf, lw };
}

function run(w: World, secs: number, each?: () => void) {
  for (let i = 0; i < secs * 50; i++) {
    each?.();
    w.step(null);
  }
}

describe('fighter AI state transitions', () => {
  it('patrol → attack when an enemy is spotted ahead', () => {
    const { w, raf, lw } = setup();
    lw.fs.setAirborne(new Vec3(0, 3000, 0), 0, 120);
    raf.fs.setAirborne(new Vec3(0, 3000, 1200), 0, 110);
    const b = new FighterBrain({ waypoint: new Vec3(0, 3000, 50000) });
    lw.brain = b;
    run(w, 4);
    expect(b.state).toBe('attack');
    expect(b.targetId).toBe(raf.id);
  });

  it('evades (break or bunt) with an enemy fighter on its tail', () => {
    const { w, raf, lw } = setup(2);
    lw.fs.setAirborne(new Vec3(0, 3000, 0), 0, 120);
    raf.fs.setAirborne(new Vec3(0, 3000, -350), 0, 125);
    const b = new FighterBrain({ waypoint: new Vec3(0, 3000, 50000) });
    lw.brain = b;
    b.contacts.tell(raf.id, 0);
    const seen = new Set<string>();
    run(w, 3, () => seen.add(b.state));
    expect(seen.has('evade') || seen.has('bunt')).toBe(true);
  });

  it('a fuel-injected 109 bunts away from a Merlin when it can', () => {
    let bunts = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const { w, raf, lw } = setup(seed);
      lw.fs.setAirborne(new Vec3(0, 4000, 0), 0, 130);
      raf.fs.setAirborne(new Vec3(0, 4000, -300), 0, 130);
      const b = new FighterBrain({ waypoint: new Vec3(0, 4000, 50000) });
      lw.brain = b;
      b.contacts.tell(raf.id, 0);
      let bunted = false;
      run(w, 3, () => { if (b.state === 'bunt') bunted = true; });
      if (bunted) bunts++;
    }
    expect(bunts).toBeGreaterThanOrEqual(3);
  });

  it('heads for France when fuel runs low', () => {
    const { w, lw } = setup();
    lw.fs.setAirborne(new Vec3(0, 3000, 0), 0, 120);
    lw.fs.fuel = lw.type.fuelCapacity * 0.2;
    const b = new FighterBrain({ waypoint: new Vec3(0, 3000, 50000) });
    lw.brain = b;
    run(w, 2);
    expect(b.state).toBe('rtb');
    run(w, 40);
    // Heading towards home (south-east of here).
    const home = w.homes.lw.clone().sub(lw.pos).normalize();
    expect(lw.fs.forward().dot(home)).toBeGreaterThan(0.8);
  });

  it('bails out when on fire', () => {
    const { w, lw } = setup();
    lw.fs.setAirborne(new Vec3(0, 3000, 0), 0, 120);
    lw.damage.fire = 0.05;
    const b = new FighterBrain({});
    lw.brain = b;
    run(w, 8);
    expect(b.state).toBe('bail');
    expect(w.parachutes.length).toBeGreaterThan(0);
  });

  it('pulls up rather than fly into the ground', () => {
    const { w, lw } = setup();
    lw.fs.setAirborne(new Vec3(0, 600, 0), 0, 150, -0.5);
    lw.brain = new FighterBrain({ waypoint: new Vec3(0, 600, 50000) });
    run(w, 15);
    expect(lw.status).toBe('flying');
    expect(lw.pos.y).toBeGreaterThan(50);
  });
});

describe('the 1-v-1', () => {
  it('an experte 109 shoots down a Spitfire that just flies straight and level', () => {
    let kills = 0;
    for (let seed = 1; seed <= 3; seed++) {
      const { w, raf, lw } = setup(seed);
      raf.fs.setAirborne(new Vec3(0, 3000, 0), 0, 110);
      lw.fs.setAirborne(new Vec3(600, 3300, -2500), 0, 130);
      lw.brain = new FighterBrain({ waypoint: new Vec3(0, 3000, 30000) });
      const c = idleControls(0.7);
      run(w, 120, () => {
        if (raf.status === 'flying') {
          // Straight and level.
          c.pitch = (3000 - raf.pos.y) * 0.003 - raf.fs.vel.y * 0.02;
          c.roll = -raf.fs.roll * 2;
          Object.assign(raf.ctl, c);
        }
      });
      if (raf.status !== 'flying') kills++;
    }
    expect(kills).toBeGreaterThanOrEqual(2);
  });

  it('the player can shoot down a 109 from dead astern at the convergence range', () => {
    const { w, raf, lw } = setup(9);
    raf.isPlayer = true;
    w.player = raf;
    lw.fs.setAirborne(new Vec3(0, 3000, 274), 0, 110);
    raf.fs.setAirborne(new Vec3(0, 3000 - 0.75, 0), 0, 110);
    lw.brain = null; // a sitting duck
    const f = neutralControls();
    f.throttle = lw.fs.throttle;
    f.fire = true;
    for (let i = 0; i < 50 * 6 && lw.status === 'flying'; i++) {
      Object.assign(lw.ctl, idleControls(0.8));
      // Hold the sight on the target (the gunnery under test, not the flying).
      const eye = raf.pos.clone().add(raf.fs.q.rotate(new Vec3(...EYE)));
      raf.fs.q = Quat.lookRotation(lw.pos.clone().sub(eye));
      w.step({ ...f, throttle: 0.8 });
    }
    expect(lw.damage.hits).toBeGreaterThan(5);
    expect(lw.status).not.toBe('flying');
    expect(lw.killedBy).toBe(raf.id);
  });

  it('replays identically from the same seed', () => {
    const go = () => {
      const { w, raf, lw } = setup(77);
      raf.fs.setAirborne(new Vec3(0, 3000, 0), 0, 110);
      lw.fs.setAirborne(new Vec3(600, 3300, -2500), 0, 130);
      lw.brain = new FighterBrain({ waypoint: new Vec3(0, 3000, 30000) });
      raf.brain = new FighterBrain({ waypoint: new Vec3(0, 3000, -30000) });
      run(w, 60);
      return [lw.pos.x, lw.pos.y, raf.pos.x, raf.damage.hits, w.bullets.length, w.particles.length];
    };
    expect(go()).toEqual(go());
  });
});
