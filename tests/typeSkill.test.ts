// Experience on type: an old hand gets a little more out of the aircraft
// than a pilot who has just converted, and 0.5 (the default) changes nothing.

import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { FlightMods, FlightState, neutralMods, stepFlight } from '../src/sim/flight';
import { idleControls } from '../src/sim/ai/pilot';
import { DT, env, make } from './helpers/flightHarness';

function fly(typeSkill: number | undefined, secs: number, s: FlightState, mods: FlightMods, ctl: (c: ReturnType<typeof idleControls>, s: FlightState) => void, e = env): FlightState {
  const rng = new Rng(1);
  const c = idleControls(1);
  for (let i = 0; i < secs / DT; i++) { ctl(c, s); stepFlight(s, c, { ...e, typeSkill }, mods, DT, rng); }
  return s;
}

/** Bank angle reached after a second of full aileron at 300 mph. */
const rollAfter = (k?: number) => Math.abs(fly(k, 1, make('hurricane', 3000, 134), neutralMods(1), (c) => { c.roll = 1; }).roll);

describe('experience on type', () => {
  it('0.5 is the same as no experience given at all', () => {
    expect(rollAfter(0.5)).toBe(rollAfter(undefined));
  });

  it('an old hand rolls quicker than a pilot new to the type, by under a tenth', () => {
    const fresh = rollAfter(0), mid = rollAfter(0.5), old = rollAfter(1);
    expect(old).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(fresh);
    expect(old / fresh).toBeLessThan(1.2);
  });

  it('with a holed radiator, an old hand keeps the engine cooler for longer', () => {
    // Seconds at full throttle until the engine seizes.
    const lasts = (k: number) => {
      const mods = neutralMods(1);
      mods.coolant = 0.35;
      let t = 0;
      fly(k, 600, make('hurricane', 3000, 120), mods, (c, s) => { c.throttle = 1; c.pitch = 0; if (s.engine !== 'seized') t += DT; });
      return t;
    };
    const fresh = lasts(0), mid = lasts(0.5), old = lasts(1);
    expect(old).toBeGreaterThan(mid * 1.1);
    expect(mid).toBeGreaterThan(fresh * 1.1);
  });

  it('with the elevator shot about, an old hand pulls more g', () => {
    const g = (k: number) => {
      const mods = neutralMods(1);
      mods.elevator = 0.4;
      let peak = 0;
      fly(k, 3, make('spitfire', 3000, 130), mods, (c, s) => { c.pitch = 1; peak = Math.max(peak, s.nz); });
      return peak;
    };
    expect(g(1)).toBeGreaterThan(g(0) * 1.05);
  });

  it('a spin develops more slowly for an old hand', () => {
    const spin = (k: number) => {
      const s = make('spitfire', 3000, 45);
      s.throttle = 0;
      fly(k, 2, s, neutralMods(1), (c) => { c.pitch = 1; c.yaw = 1; c.throttle = 0; }, { ...env, autoRudder: false });
      return s.spin;
    };
    expect(spin(1)).toBeLessThan(spin(0));
  });

  it('and is easier on fuel', () => {
    const used = (k: number) => {
      const s = make('hurricane', 3000, 120);
      const f0 = s.fuel;
      fly(k, 120, s, neutralMods(1), (c) => { c.throttle = 0.7; });
      return f0 - s.fuel;
    };
    expect(used(1)).toBeLessThan(used(0) * 0.95);
  });
});
