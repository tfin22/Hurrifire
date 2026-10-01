import { describe, expect, it } from 'vitest';
import { Vec3 } from '../src/core/math';
import { Rng } from '../src/core/rng';
import { AIRCRAFT } from '../src/content/aircraft';
import { evaluateTouchdown, obstacleImpact, rolloutDistance, TouchdownInput, worseOf } from '../src/sim/landing';
import { bestGlideRatio, bestGlideSpeed, glideRange } from '../src/sim/glide';
import { FlightState, neutralMods, stepFlight } from '../src/sim/flight';
import { idleControls, rollTo, stickForG } from '../src/sim/ai/pilot';
import { env } from './helpers/flightHarness';
import type { Surface } from '../src/sim/ground';

const base = (o: Partial<TouchdownInput> = {}): TouchdownInput => ({
  sinkRate: 0.8, airspeed: 34, stallSpeed: 32, groundSpeed: 30, bank: 0, pitch: 0.19, drift: 0,
  gear: 'down', surface: 'airfield', threePoint: 0.2, fire: 0, luck: 0.5, ...o,
});

describe('touchdown model: outcome table', () => {
  it('greaser: a clean three-pointer', () => {
    const r = evaluateTouchdown(base());
    expect(r.kind).toBe('greaser');
    expect(r.aircraft).toBe('fine');
    expect(r.pilot).toBe('fine');
  });

  it('bounce: too much sink or speed puts it back in the air', () => {
    expect(evaluateTouchdown(base({ sinkRate: 2.9 })).kind).toBe('bounce');
    const fast = evaluateTouchdown(base({ airspeed: 32 * 1.55, groundSpeed: 48 }));
    expect(fast.kind).toBe('bounce');
    expect(fast.bounceVy!).toBeGreaterThan(0);
  });

  it('ground loop: a wingtip or drift at touchdown', () => {
    expect(evaluateTouchdown(base({ bank: 0.3 })).kind).toBe('groundLoop');
    expect(evaluateTouchdown(base({ drift: 0.36 })).kind).toBe('groundLoop');
  });

  it('nose over: nose-down contact, or wheels in plough or marsh', () => {
    expect(evaluateTouchdown(base({ pitch: -0.1 })).kind).toBe('noseOver');
    expect(evaluateTouchdown(base({ surface: 'marsh' })).kind).toBe('noseOver');
    const r = evaluateTouchdown(base({ surface: 'ploughed', groundSpeed: 30 }));
    expect(r.kind).toBe('noseOver');
    expect(r.pilot).toBe('shaken');
  });

  it('belly landing: wheels up on a good surface is damaged but repairable', () => {
    const r = evaluateTouchdown(base({ gear: 'up', pitch: 0.05 }));
    expect(r.kind).toBe('belly');
    expect(r.aircraft).toBe('repairable');
    expect(r.pilot).toBe('fine');
  });

  it('crash, survived: a heavy arrival writes it off', () => {
    const r = evaluateTouchdown(base({ sinkRate: 7.5 }));
    expect(r.kind).toBe('crashSurvived');
    expect(r.aircraft).toBe('writeOff');
    expect(['shaken', 'wounded']).toContain(r.pilot);
  });

  it('crash, not survived: only genuinely bad impacts', () => {
    expect(evaluateTouchdown(base({ sinkRate: 12 })).kind).toBe('crashFatal');
    expect(evaluateTouchdown(base({ pitch: -0.35, airspeed: 60, groundSpeed: 60 })).kind).toBe('crashFatal');
    expect(evaluateTouchdown(base({ fire: 0.8 })).pilot).toBe('lost');
  });

  it('every row is reachable', () => {
    const kinds = new Set<string>();
    const cases: Partial<TouchdownInput>[] = [
      {}, { sinkRate: 2.9 }, { bank: 0.3 }, { pitch: -0.1 }, { gear: 'up', pitch: 0.05 }, { sinkRate: 7.5 }, { sinkRate: 12 },
    ];
    for (const c of cases) kinds.add(evaluateTouchdown(base(c)).kind);
    for (const k of ['greaser', 'bounce', 'groundLoop', 'noseOver', 'belly', 'crashSurvived', 'crashFatal']) expect(kinds.has(k)).toBe(true);
  });
});

describe('touchdown model: boundaries are monotone', () => {
  it('more sink never gives a better result', () => {
    const rank = ['greaser', 'roll', 'bounce', 'groundLoop', 'belly', 'noseOver', 'crashSurvived', 'crashFatal'];
    let last = 0;
    for (let s = 0; s <= 14; s += 0.25) {
      const r = rank.indexOf(evaluateTouchdown(base({ sinkRate: s, luck: 0.99 })).kind);
      expect(r).toBeGreaterThanOrEqual(last);
      last = r;
    }
  });

  it('luck only matters near a threshold', () => {
    const results = new Set<string>();
    for (let l = 0; l < 1; l += 0.05) results.add(evaluateTouchdown(base({ sinkRate: 1.0, luck: l })).kind);
    expect(results.size).toBe(1);
    const edge = new Set<string>();
    // Exactly at the bounce threshold (0.85 × 3 m/s): either side can happen.
    for (let l = 0; l < 1; l += 0.05) edge.add(evaluateTouchdown(base({ sinkRate: 0.85 * 3.0, luck: l })).kind);
    expect(edge.size).toBeGreaterThan(1);
  });
});

describe('touchdown model: surfaces, gear up vs down', () => {
  const surfaces: Surface[] = ['airfield', 'pasture', 'stubble', 'ploughed', 'marsh', 'orchard', 'woodland', 'hops', 'town', 'beach', 'sea'];
  it('matches the surface table', () => {
    const down = (s: Surface) => evaluateTouchdown(base({ surface: s })).kind;
    const up = (s: Surface) => evaluateTouchdown(base({ surface: s, gear: 'up', pitch: 0.05 })).kind;
    expect(down('airfield')).toBe('greaser');
    expect(down('pasture')).toBe('greaser');
    expect(down('stubble')).toBe('greaser');
    expect(up('ploughed')).toBe('belly');
    expect(down('ploughed')).toBe('noseOver');
    expect(down('marsh')).toBe('noseOver');
    expect(up('marsh')).toBe('belly');
    for (const s of ['orchard', 'woodland', 'hops', 'town'] as Surface[]) {
      expect(['crashSurvived', 'crashFatal']).toContain(down(s));
      expect(['crashSurvived', 'crashFatal']).toContain(up(s));
    }
    expect(down('beach')).toBe('greaser');
    expect(up('beach')).toBe('belly');
    expect(['ditched', 'crashFatal']).toContain(down('sea'));
    for (const s of surfaces) expect(evaluateTouchdown(base({ surface: s })).kind).toBeDefined();
  });

  it('a deliberate belly landing beats one leg down', () => {
    const one = evaluateTouchdown(base({ gear: 'partial' }));
    const belly = evaluateTouchdown(base({ gear: 'up', pitch: 0.05 }));
    expect(one.kind).toBe('groundLoop');
    expect(belly.kind).toBe('belly');
    expect(belly.aircraft).toBe('repairable');
  });

  it('ditching is survivable with a perfect attitude, gear up', () => {
    const r = evaluateTouchdown(base({ surface: 'sea', gear: 'up', pitch: 0.1, sinkRate: 1.2, airspeed: 34 }));
    expect(r.kind).toBe('ditched');
    expect(r.pilot).not.toBe('lost');
    const bad = evaluateTouchdown(base({ surface: 'sea', gear: 'down', pitch: -0.05, sinkRate: 5 }));
    expect(bad.pilot).toBe('lost');
  });

  it('the Spitfire noses under: ditching with the wheels down is worse', () => {
    const a = evaluateTouchdown(base({ surface: 'sea', gear: 'up', pitch: 0.1, sinkRate: 1.2, nosesUnder: true }));
    const b = evaluateTouchdown(base({ surface: 'sea', gear: 'down', pitch: 0.1, sinkRate: 1.2, nosesUnder: true }));
    expect(a.kind).toBe('ditched');
    expect(['ditched', 'crashFatal']).toContain(b.kind);
    expect(b.pilot === 'lost' || b.pilot === 'wounded').toBe(true);
  });
});

describe('a clean approach is never fatal', () => {
  it('across random clean touchdowns on any landable surface, in any state', () => {
    const rng = new Rng(11);
    const landable: Surface[] = ['airfield', 'pasture', 'stubble', 'ploughed', 'marsh', 'beach'];
    for (let n = 0; n < 5000; n++) {
      const r = evaluateTouchdown(base({
        sinkRate: rng.range(0, 2.9), airspeed: 32 * rng.range(0.95, 1.5), groundSpeed: rng.range(20, 45),
        bank: rng.range(-0.16, 0.16), drift: rng.range(-0.19, 0.19), pitch: rng.range(0, 0.25),
        gear: rng.pick(['down', 'up', 'partial'] as const), surface: rng.pick(landable), luck: rng.next(),
      }));
      expect(r.pilot).not.toBe('lost');
    }
  });
});

describe('roll-out and obstacles', () => {
  it('needs more ground on grass with wheels than on the belly; plough stops you quickest with wheels', () => {
    expect(rolloutDistance(30, 'pasture', true)).toBeGreaterThan(rolloutDistance(30, 'pasture', false));
    expect(rolloutDistance(30, 'ploughed', true)).toBeLessThan(rolloutDistance(30, 'pasture', true));
    // A Spitfire touching down at ~70 mph needs a few hundred metres with brakes.
    const d = rolloutDistance(31, 'pasture', true);
    expect(d).toBeGreaterThan(150);
    expect(d).toBeLessThan(450);
  });

  it('hedges at walking pace are harmless; at speed they are not', () => {
    expect(obstacleImpact(3, 'hedge', true)).toBeNull();
    expect(obstacleImpact(10, 'hedge', true)!.kind).toBe('noseOver');
    expect(obstacleImpact(22, 'hedge', true)!.kind).toBe('crashSurvived');
    expect(obstacleImpact(40, 'trees', true)!.pilot).toBe('lost');
  });

  it('worseOf keeps the worse outcome', () => {
    const a = evaluateTouchdown(base());
    const b = obstacleImpact(10, 'hedge', true);
    expect(worseOf(a, b)!.kind).toBe('noseOver');
  });
});

describe('glide range', () => {
  it('Spitfire glides about 1:12 with the prop windmilling', () => {
    const r = bestGlideRatio(AIRCRAFT.spitfire);
    expect(r).toBeGreaterThan(10);
    expect(r).toBeLessThan(14);
  });

  it('the estimate matches a simulated dead-stick glide at best glide speed', () => {
    const t = AIRCRAFT.spitfire;
    const s = new FlightState(t, 0.3);
    const v = bestGlideSpeed(t, s.mass);
    s.setAirborne(new Vec3(0, 1100, 0), 0, v);
    s.engine = 'dead';
    const rng = new Rng(1);
    const mods = neutralMods(1);
    const c = idleControls(0);
    for (let i = 0; i < 50 * 60 * 5 && s.pos.y > 100; i++) {
      c.roll = rollTo(s, 0);
      c.pitch = stickForG(t, 1 + (s.ias - v) * 0.03 - s.qr * 0.5);
      stepFlight(s, c, env, mods, 0.02, rng);
    }
    const flown = Math.hypot(s.pos.x, s.pos.z);
    const est = glideRange(t, 1100, 0, 100, s.mass);
    expect(Math.abs(flown - est) / est).toBeLessThan(0.15);
  });

  it('a tailwind stretches the glide, a headwind shortens it', () => {
    const t = AIRCRAFT.hurricane;
    expect(glideRange(t, 1000, 8)).toBeGreaterThan(glideRange(t, 1000, 0));
    expect(glideRange(t, 1000, -8)).toBeLessThan(glideRange(t, 1000, 0));
  });

  it('a 109 does worse than a Spitfire from the same height', () => {
    expect(glideRange(AIRCRAFT.bf109, 1500)).toBeLessThan(glideRange(AIRCRAFT.spitfire, 1500));
  });
});
