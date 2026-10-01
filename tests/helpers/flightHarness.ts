import { Vec3, MPS_TO_MPH, M_TO_FT } from '../../src/core/math';
import { Rng } from '../../src/core/rng';
import { AIRCRAFT, AircraftId } from '../../src/content/aircraft';
import { FlightControls, FlightEnv, FlightState, neutralMods, stepFlight } from '../../src/sim/flight';
import { climbAtSpeed, idleControls, levelTurn, maxLevelTurn, rollTo, stickForG } from '../../src/sim/ai/pilot';

export const DT = 1 / 50;
export const env: FlightEnv = {
  wind: new Vec3(),
  groundAt: () => ({ h: 0, friction: 0.05, soft: false }),
  autoRudder: true,
};

export function make(id: AircraftId, alt: number, speed: number, heading = 0): FlightState {
  const s = new FlightState(AIRCRAFT[id], 0.8);
  s.setAirborne(new Vec3(0, alt, 0), heading, speed);
  return s;
}

export function run(s: FlightState, seconds: number, ctl: (s: FlightState, c: FlightControls) => void, c = idleControls(1)): void {
  const rng = new Rng(1);
  const mods = neutralMods(s.type.engines);
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    ctl(s, c);
    stepFlight(s, c, env, mods, DT, rng);
  }
}

/** Seconds for a full 360 in a hard level turn at the start speed. */
export function turnTime(id: AircraftId, alt: number, speed: number): { time: number; altLoss: number; endSpeed: number } {
  const s = make(id, alt, speed);
  const c = idleControls(1);
  let turned = 0, last = s.heading, t = 0;
  const rng = new Rng(2);
  const mods = neutralMods(s.type.engines);
  while (turned < Math.PI * 2 && t < 120) {
    maxLevelTurn(s, 1, c);
    stepFlight(s, c, env, mods, DT, rng);
    let d = s.heading - last;
    if (d < -Math.PI) d += Math.PI * 2;
    if (d > Math.PI) d -= Math.PI * 2;
    turned += d;
    last = s.heading;
    t += DT;
  }
  return { time: t, altLoss: alt - s.pos.y, endSpeed: s.tas };
}

/** Sustained (equilibrium) turn rate (deg/s) after settling at full power, holding height. */
export function sustainedTurnRate(id: AircraftId, alt: number, speed: number): number {
  const s = make(id, alt, speed);
  run(s, 40, (st, c) => maxLevelTurn(st, 1, c));
  const h0 = s.heading;
  let turned = 0, last = h0;
  run(s, 10, (st, c) => {
    maxLevelTurn(st, 1, c);
    let d = st.heading - last;
    if (d < -Math.PI) d += Math.PI * 2;
    if (d > Math.PI) d -= Math.PI * 2;
    turned += d;
    last = st.heading;
  });
  return (turned / 10) * 57.2958;
}

export function climbRate(id: AircraftId, alt: number, ias: number): number {
  const s = make(id, alt, ias * 1.1);
  run(s, 30, (st, c) => climbAtSpeed(st, ias, 0, c));
  const h0 = s.pos.y;
  run(s, 20, (st, c) => climbAtSpeed(st, ias, 0, c));
  return (s.pos.y - h0) / 20;
}

export function levelTopSpeed(id: AircraftId, alt: number): number {
  const s = make(id, alt, 140);
  run(s, 120, (st, c) => { levelTurn(st, 0, c, alt); c.throttle = 1; });
  return s.tas;
}

export function diveSpeed(id: AircraftId, alt: number, speed: number, seconds: number, angleDeg = 60): number {
  const s = make(id, alt, speed);
  const want = -angleDeg * Math.PI / 180;
  run(s, seconds, (st, c) => {
    c.roll = rollTo(st, 0);
    // Hold the dive angle with gentle stick.
    const g = Math.cos(st.pitch) + (want - st.pitch) * 4 - st.qr * 0.8;
    c.pitch = stickForG(st.type, g);
    c.throttle = 1;
  });
  return s.tas;
}

export const mph = (v: number) => v * MPS_TO_MPH;
export const fpm = (v: number) => v * M_TO_FT * 60;
