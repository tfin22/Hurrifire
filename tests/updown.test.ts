// Integration: take-offs and landings flown through the full world (flight
// model + touchdown model + roll-out), on simple test ground.

import { describe, expect, it } from 'vitest';
import { Vec3 } from '../src/core/math';
import { GroundModel, Surface } from '../src/sim/ground';
import { World } from '../src/sim/world';
import { flyApproach } from '../src/sim/ai/approach';
import { Plane } from '../src/sim/plane';
import { neutralControls } from '../src/input/input';
import { stallSpeed } from '../src/content/aircraft';

/** Flat ground: one surface, or a long field with a hedge at a distance. */
function ground(surface: Surface, hedgeAtZ = Infinity): GroundModel {
  return {
    heightAt: () => 20,
    surfaceAt: () => surface,
    fieldAt: (_x, z) => (z < hedgeAtZ
      ? { x0: -5000, z0: -5000, x1: 5000, z1: hedgeAtZ, hedge: [false, false, false, true] }
      : { x0: -5000, z0: hedgeAtZ, x1: 5000, z1: 50000, hedge: [false, false, false, false] }),
  };
}

function approachWorld(g: GroundModel, gearDown: boolean, engine: 'running' | 'dead', seed = 1, fromM = 2500) {
  const w = new World(seed, g);
  const p = w.addPlane('spitfire', 'raf', 'Test', 0.3);
  w.player = null;
  const vs = stallSpeed(p.type, p.fs.mass, 1.225, 1);
  const path = engine === 'dead' ? 0.11 : 0.075;
  p.fs.setAirborne(new Vec3(0, 20 + p.type.gearHeight + fromM * Math.tan(path), -fromM), 0, vs * 1.35);
  p.fs.gear = p.fs.gearCmd = gearDown ? 1 : 0;
  p.fs.flaps = p.fs.flapsCmd = gearDown ? 1 : 0;
  if (engine === 'dead') p.fs.engine = 'dead';
  return { w, p };
}

function flyIn(w: World, p: Plane, glide: boolean, secs = 150): void {
  for (let i = 0; i < secs * 50 && p.status === 'flying'; i++) {
    flyApproach(p.fs, { x: 0, z: 0, h: 20, dir: 0 }, p.ctl, { glide });
    w.step(null);
  }
}

describe('landing, flown', () => {
  it('a well-flown powered approach to an airfield is a good landing', () => {
    let good = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const { w, p } = approachWorld(ground('airfield'), true, 'running', seed);
      flyIn(w, p, false);
      expect(p.status).toBe('landed');
      if (['greaser', 'roll'].includes(p.landing.result!.kind)) good++;
      expect(p.landing.result!.pilot).toBe('fine');
    }
    expect(good).toBeGreaterThanOrEqual(3);
  });

  it('a dead-stick approach into a long pasture is reliably survivable', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const { w, p } = approachWorld(ground('pasture'), true, 'dead', seed);
      flyIn(w, p, true);
      expect(['landed']).toContain(p.status);
      expect(p.landing.result!.pilot).not.toBe('lost');
    }
  });

  it('out of fuel with the throttle left open, she still comes to rest and the landing ends', () => {
    const { w, p } = approachWorld(ground('pasture'), false, 'dead', 2);
    for (let i = 0; i < 150 * 50 && p.status === 'flying'; i++) {
      flyApproach(p.fs, { x: 0, z: 0, h: 20, dir: 0 }, p.ctl, { glide: true });
      p.ctl.throttle = 1;
      w.step(null);
    }
    expect(p.status).toBe('landed');
  });

  it('a wheels-up landing on ploughland is a belly landing, and rewarded as one', () => {
    const { w, p } = approachWorld(ground('ploughed'), false, 'dead', 2);
    flyIn(w, p, true);
    expect(p.status).toBe('landed');
    expect(p.landing.result!.kind).toBe('belly');
    expect(p.landing.result!.aircraft).toBe('repairable');
  });

  it('wheels down on ploughland noses over', () => {
    const { w, p } = approachWorld(ground('ploughed'), true, 'dead', 3);
    flyIn(w, p, true);
    expect(p.landing.result!.kind).toBe('noseOver');
  });

  it('a short field with a hedge catches a long roll-out', () => {
    const { w, p } = approachWorld(ground('pasture', 280), true, 'running', 4);
    flyIn(w, p, false);
    expect(['noseOver', 'crashSurvived', 'crashFatal']).toContain(p.landing.result!.kind);
  });

  it('out of fuel is measurably easier than a seized engine with control damage', () => {
    let easy = 0, hard = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const a = approachWorld(ground('pasture'), true, 'dead', seed);
      flyIn(a.w, a.p, true);
      easy += a.p.landing.result!.severity;
      const b = approachWorld(ground('pasture'), true, 'dead', seed);
      b.p.damage.elevator = 0.6;
      b.p.damage.elevatorBias = 0.25;
      b.p.damage.aileron = 0.5;
      b.p.damage.flaps = false;
      b.p.fs.flaps = b.p.fs.flapsCmd = 0;
      flyIn(b.w, b.p, true);
      hard += b.p.landing.result ? b.p.landing.result.severity : 5;
    }
    expect(hard).toBeGreaterThan(easy);
  });
});

describe('take-off', () => {
  function takeoff(autoRudder: boolean, rudder = 0) {
    const w = new World(1, ground('airfield'));
    const p = w.addPlane('spitfire', 'raf', 'Test', 0.8);
    p.isPlayer = true;
    w.player = p;
    w.autoRudder = autoRudder;
    p.fs.setOnGround(new Vec3(0, 20 + p.type.gearHeight, 0), 0);
    const f = neutralControls();
    let looped = false;
    for (let i = 0; i < 50 * 40; i++) {
      f.throttle = Math.min(1, i / 150); // open the throttle smoothly
      // Tail up at speed, then ease back to fly it off.
      f.pitch = p.fs.onGround ? (p.fs.ias > 40 ? 0.5 : p.fs.ias > 22 ? -0.3 : 0) : 0.03;
      f.yaw = rudder;
      w.step(f);
      if (p.fs.events.includes('groundLoop')) looped = true;
      p.fs.events.length = 0;
      if (!p.fs.onGround && p.pos.y > 80) break;
    }
    return { p, looped };
  }

  it('with auto-rudder, a smooth take-off run gets airborne without a ground loop', () => {
    const { p, looped } = takeoff(true);
    expect(looped).toBe(false);
    expect(p.fs.onGround).toBe(false);
    expect(p.pos.y).toBeGreaterThan(60);
  });

  it('without rudder, torque swings the nose into a ground loop', () => {
    const { looped } = takeoff(false, 0);
    expect(looped).toBe(true);
  });

  it('the tail comes up at speed with forward stick', () => {
    const w = new World(1, ground('airfield'));
    const p = w.addPlane('spitfire', 'raf', 'Test', 0.8);
    p.isPlayer = true;
    w.player = p;
    p.fs.setOnGround(new Vec3(0, 20 + p.type.gearHeight, 0), 0);
    const f = { ...neutralControls(), throttle: 1, pitch: -0.4 };
    let tailUpAt = 0;
    for (let i = 0; i < 50 * 20 && p.fs.onGround; i++) {
      w.step(f);
      if (p.fs.tailUp > 0.9 && !tailUpAt) tailUpAt = p.fs.ias;
    }
    expect(tailUpAt).toBeGreaterThan(10);
  });
});
