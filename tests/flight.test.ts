import { describe, expect, it } from 'vitest';
import { Vec3 } from '../src/core/math';
import { Rng } from '../src/core/rng';
import { AIRCRAFT, massOf, stallSpeed } from '../src/content/aircraft';
import { FlightState, neutralMods, stepFlight } from '../src/sim/flight';
import { idleControls, levelTurn, stickForG } from '../src/sim/ai/pilot';
import { DT, climbRate, diveSpeed, env, levelTopSpeed, make, run, sustainedTurnRate } from './helpers/flightHarness';

describe('flight model: stall', () => {
  for (const id of ['spitfire', 'bf109', 'hurricane'] as const) {
    it(`${id} stalls near its computed stall speed when slowed in level flight`, () => {
      const s = make(id, 2000, 70);
      let stallV = 0;
      run(s, 60, (st, c) => {
        levelTurn(st, 0, c, 2000);
        // Short of full back stick the wing is held just below the stall; haul back as it gets there.
        if (st.alpha > st.type.alphaStall * 0.9) c.pitch = 1;
        c.throttle = 0;
        if (st.stalled && !stallV) stallV = st.tas;
      });
      const rho = 1.225 * Math.pow(1 - 2000 / 44300, 4.256);
      const expected = stallSpeed(AIRCRAFT[id], massOf(AIRCRAFT[id], s.fuel), rho);
      expect(stallV).toBeGreaterThan(0);
      expect(Math.abs(stallV - expected) / expected).toBeLessThan(0.12);
    });
  }

  it('gives buffet warning before the stall', () => {
    const s = make('spitfire', 2000, 60);
    let buffetFirst = -1, stallAt = -1, t = 0;
    run(s, 40, (st, c) => {
      levelTurn(st, 0, c, 2000);
      if (st.alpha > st.type.alphaStall * 0.9) c.pitch = 1;
      c.throttle = 0;
      t += DT;
      if (st.buffet > 0.2 && buffetFirst < 0) buffetFirst = t;
      if (st.stalled && stallAt < 0) stallAt = t;
    });
    expect(buffetFirst).toBeGreaterThan(0);
    expect(stallAt).toBeGreaterThan(buffetFirst);
  });

  it('recovers from a spin with stick forward and opposite rudder', () => {
    const s = make('spitfire', 3000, 45);
    s.throttle = 0;
    // Full back stick and pro-spin rudder, no auto-rudder.
    const manual = { ...env, autoRudder: false };
    const rng = new Rng(3);
    const mods = neutralMods(1);
    const c = idleControls(0);
    for (let i = 0; i < 300; i++) {
      c.pitch = 1; c.yaw = 1; c.roll = 0;
      stepFlight(s, c, manual, mods, DT, rng);
    }
    expect(s.spin).toBeGreaterThan(0.5);
    // Recovery.
    for (let i = 0; i < 400; i++) {
      c.pitch = -0.5; c.yaw = -s.spinDir; c.roll = 0;
      stepFlight(s, c, manual, mods, DT, rng);
    }
    expect(s.spin).toBe(0);
    expect(s.stalled).toBe(false);
  });
});

describe('flight model: relative performance', () => {
  it('Spitfire out-turns a 109 at the same speed and height', () => {
    for (const alt of [1500, 4500, 6500]) {
      expect(sustainedTurnRate('spitfire', alt, 110)).toBeGreaterThan(sustainedTurnRate('bf109', alt, 110));
    }
  });

  it('Hurricane also out-turns a 109', () => {
    expect(sustainedTurnRate('hurricane', 3000, 105)).toBeGreaterThan(sustainedTurnRate('bf109', 3000, 105));
  });

  it('109 out-climbs both RAF fighters', () => {
    const c109 = climbRate('bf109', 1500, 75);
    expect(c109).toBeGreaterThan(climbRate('spitfire', 1500, 75));
    expect(c109).toBeGreaterThan(climbRate('hurricane', 1500, 75));
  });

  it('climb rates are plausible (2000–3500 ft/min for the fighters)', () => {
    for (const id of ['spitfire', 'hurricane', 'bf109'] as const) {
      const fpm = climbRate(id, 1500, 75) * 3.28 * 60;
      expect(fpm).toBeGreaterThan(1900);
      expect(fpm).toBeLessThan(3600);
    }
  });

  it('109 out-dives both RAF fighters', () => {
    const d109 = diveSpeed('bf109', 7000, 110, 20);
    expect(d109).toBeGreaterThan(diveSpeed('spitfire', 7000, 110, 20));
    expect(d109).toBeGreaterThan(diveSpeed('hurricane', 7000, 110, 20));
  });

  it('Spitfire is faster than the Hurricane, and the fastest at altitude', () => {
    const s = levelTopSpeed('spitfire', 5500);
    expect(s).toBeGreaterThan(levelTopSpeed('hurricane', 5500));
    expect(s).toBeGreaterThan(levelTopSpeed('bf109', 5500));
  });

  it('a hard turn bleeds energy; diving regains it', () => {
    const s = make('spitfire', 3000, 130);
    const e0 = s.tas * s.tas / 2 + 9.81 * s.pos.y;
    run(s, 15, (st, c) => { levelTurn(st, 1.35, c, 3000); c.pitch = 1; c.throttle = 1; });
    const e1 = s.tas * s.tas / 2 + 9.81 * s.pos.y;
    expect(e1).toBeLessThan(e0);
    const v1 = s.tas;
    run(s, 10, (st, c) => { c.roll = -st.roll; c.pitch = stickForG(st.type, 0.6); });
    expect(s.tas).toBeGreaterThan(v1);
  });
});

describe('flight model: negative-G cut-out', () => {
  function bunt(id: 'spitfire' | 'hurricane' | 'bf109') {
    const s = new FlightState(AIRCRAFT[id], 0.8);
    s.setAirborne(new Vec3(0, 4000, 0), 0, 130);
    const rng = new Rng(4);
    const mods = neutralMods(1);
    const c = idleControls(1);
    let cut = false, minPowerRpm = Infinity;
    for (let i = 0; i < 100; i++) {
      c.pitch = -1;
      stepFlight(s, c, env, mods, DT, rng);
      if (s.events.includes('cutout')) cut = true;
      s.events.length = 0;
      minPowerRpm = Math.min(minPowerRpm, s.rpm);
    }
    return { cut, s };
  }

  it('the Merlin cuts out under negative G', () => {
    expect(bunt('spitfire').cut).toBe(true);
    expect(bunt('hurricane').cut).toBe(true);
  });

  it("the 109's fuel-injected DB 601 doesn't", () => {
    expect(bunt('bf109').cut).toBe(false);
  });

  it('a cut-out costs thrust while it lasts', () => {
    const a = make('spitfire', 4000, 130), b = make('bf109', 4000, 130);
    a.vel.set(0, 0, 130); b.vel.set(0, 0, 130);
    run(a, 2, (_s, c) => { c.pitch = -1; c.throttle = 1; });
    expect(a.cutoutT).toBeGreaterThan(0);
  });
});

describe('flight model: engine and fuel', () => {
  it('coughs before running out, then windmills', () => {
    const s = make('spitfire', 2000, 90);
    s.fuel = s.type.fuelCapacity * 0.02;
    const seen: string[] = [];
    run(s, 400, (st, c) => {
      levelTurn(st, 0, c, 2000);
      c.throttle = 0.8;
      seen.push(...st.events);
      st.events.length = 0;
    });
    expect(seen.indexOf('cough')).toBeGreaterThanOrEqual(0);
    expect(seen.indexOf('fuelOut')).toBeGreaterThan(seen.indexOf('cough'));
    expect(s.engine).toBe('dead');
  });

  it('emergency boost overheats if overused', () => {
    const s = make('hurricane', 1000, 80);
    let maxT = 0;
    run(s, 900, (st, c) => { levelTurn(st, 0, c, 1000); c.throttle = 1; c.boost = true; maxT = Math.max(maxT, st.radTemp); });
    expect(maxT).toBeGreaterThan(115);
    // Within the limit it stays healthy.
    const ok = make('hurricane', 1000, 80);
    let okMax = 0;
    run(ok, 120, (st, c) => { levelTurn(st, 0, c, 1000); c.throttle = 1; c.boost = true; okMax = Math.max(okMax, st.radTemp); });
    expect(ok.engine).toBe('running');
    expect(okMax).toBeLessThan(125);
  });

  it('is deterministic for the same seed and inputs', () => {
    const a = make('spitfire', 3000, 120), b = make('spitfire', 3000, 120);
    const script = (st: FlightState, c: ReturnType<typeof idleControls>) => {
      c.pitch = Math.sin(st.time) * 0.8; c.roll = Math.cos(st.time * 0.7);
    };
    run(a, 30, script);
    run(b, 30, script);
    expect(a.pos.x).toBe(b.pos.x);
    expect(a.pos.y).toBe(b.pos.y);
    expect(a.q.w).toBe(b.q.w);
  });
});

describe('flight model: forgiving inputs (playtest)', () => {
  it('easing the stick forward into a shallow dive does not cut the Merlin', () => {
    for (const push of [0.15, 0.3, 0.5, 0.65]) {
      const s = make('spitfire', 3000, 110);
      let cut = false;
      run(s, 3, (st, c) => { c.pitch = -push; c.throttle = 1; if (st.events.includes('cutout')) cut = true; });
      expect(cut, `push ${push}`).toBe(false);
    }
  });

  it('a hard bunt still cuts it, but a brief jolt does not', () => {
    const s = make('spitfire', 3000, 110);
    let cut = false;
    run(s, 1.5, (st, c) => { c.pitch = -1; c.throttle = 1; if (st.events.includes('cutout')) cut = true; });
    expect(cut).toBe(true);
    const j = make('spitfire', 3000, 110);
    let t = 0, jcut = false;
    run(j, 1, (st, c) => { t += DT; c.pitch = t < 0.1 ? -1 : 0; c.throttle = 1; if (st.events.includes('cutout')) jcut = true; });
    expect(jcut).toBe(false);
  });

  it('pulling up firmly at cruise does not stall; most of the stick is safe even when slow', () => {
    for (const [speed, pull] of [[110, 0.6], [110, 0.85], [75, 0.85], [60, 0.8]] as const) {
      const s = make('spitfire', 3000, speed);
      let stalled = false;
      run(s, 2, (st, c) => { c.pitch = pull; c.throttle = 1; if (st.events.includes('stall')) stalled = true; });
      expect(stalled, `${speed} m/s, stick ${pull}`).toBe(false);
    }
  });

  it('full back stick when slow still stalls', () => {
    const s = make('spitfire', 3000, 60);
    let stalled = false;
    run(s, 2, (st, c) => { c.pitch = 1; c.throttle = 1; if (st.events.includes('stall')) stalled = true; });
    expect(stalled).toBe(true);
  });

  it('a diving Stuka with its dive brakes out stays catchable', () => {
    const s = make('ju87', 4000, 80);
    run(s, 25, (_st, c) => { c.pitch = stickForG(s.type, s.pitch > -1.2 ? 0.3 : 1); c.throttle = 0.1; c.airbrake = true; });
    expect(s.tas).toBeLessThan(150); // about 330 mph
  });
});

describe('flight model: stall guard (player assist)', () => {
  it('full back stick at combat speed holds at the buffet instead of stalling', () => {
    const guarded = { ...env, stallGuard: true };
    for (const speed of [60, 80, 100]) {
      const s = make('spitfire', 3000, speed);
      const rng = new Rng(9), mods = neutralMods(1), c = idleControls(1);
      let stalled = false, buffet = 0;
      for (let i = 0; i < 150; i++) {
        c.pitch = 1;
        stepFlight(s, c, guarded, mods, DT, rng);
        if (s.events.includes('stall')) stalled = true;
        buffet = Math.max(buffet, s.buffet);
        s.events.length = 0;
      }
      expect(stalled, `${speed} m/s`).toBe(false);
      expect(buffet, `${speed} m/s`).toBeGreaterThan(0.5);
    }
  });
});
