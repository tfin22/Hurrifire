// Autopilot primitives that turn intentions ("point the nose there", "hold
// this bank and height") into stick, rudder and throttle — the same controls
// the player has. AI pilots are built on these, so they never get physics the
// player doesn't.

import { clamp, Vec3, wrapPi } from '../../core/math';
import { AircraftType } from '../../content/aircraft';
import { FlightControls, FlightState } from '../flight';
import { TUNING } from '../../tuning';

export const idleControls = (throttle = 0.8): FlightControls => ({ pitch: 0, roll: 0, yaw: 0, throttle, boost: false, brake: false });

/** Inverse of commandedG: stick position for a wanted load factor. */
/** Inverse of commandedG: the stick for a wanted load factor. */
export function stickForG(t: AircraftType, g: number): number {
  const T = TUNING.flight;
  if (g >= 1) return clamp(Math.pow(clamp((g - 1) / (t.maxG - 1), 0, 1), 1 / T.pullCurve), 0, 1);
  const P = T.pushToZeroG;
  if (g >= 0) return -P * Math.pow(Math.min(1, 1 - g), 1 / 1.3);
  return -clamp(P + (1 - P) * (g / t.minG), 0, 1);
}

/** Roll stick to reach a bank angle (rad), damped by roll rate. */
export function rollTo(s: FlightState, bank: number, gain = 2.2): number {
  const err = wrapPi(bank - s.roll);
  return clamp(err * gain - s.p * 0.35, -1, 1);
}

/** Load factor the wing can give at this speed before buffet (fraction of stall α). */
export function availableG(s: FlightState, margin = 0.92): number {
  const t = s.type;
  const rho = 1.225 * Math.pow(Math.max(0.2, 1 - s.pos.y / 44300), 4.256);
  const clMax = (t.cl0 + t.clAlpha * t.alphaStall * margin + s.flaps * t.flapCl);
  const q = 0.5 * rho * s.tas * s.tas;
  return Math.min(t.maxG, (q * t.wingArea * clMax) / (s.mass * 9.81));
}

/**
 * Level turn at a bank angle, holding height (vertical speed → 0, plus a
 * gentle pull towards targetAlt if given).
 */
export function levelTurn(s: FlightState, bank: number, out: FlightControls, targetAlt?: number): FlightControls {
  out.roll = rollTo(s, bank);
  let g = 1 / Math.max(0.15, Math.cos(s.roll));
  g += clamp(-s.vel.y * 0.08, -1, 1);
  if (targetAlt !== undefined) g += clamp((targetAlt - s.pos.y) * 0.002, -0.5, 0.5);
  out.pitch = stickForG(s.type, g);
  out.yaw = 0;
  return out;
}

/** Hard level turn: as much G as the wing gives without stalling, bank to hold height. */
export function maxLevelTurn(s: FlightState, dir: 1 | -1, out: FlightControls, margin = 0.92, gCap = Infinity): FlightControls {
  const n = Math.max(1.05, Math.min(availableG(s, margin), gCap));
  const bank = Math.acos(clamp(1 / n, -1, 1)) * dir;
  out.roll = rollTo(s, bank, 3);
  const vsCorr = clamp(-s.vel.y * 0.05, -0.5, 0.5);
  out.pitch = stickForG(s.type, Math.min(n, 1 / Math.max(0.1, Math.cos(s.roll)) + vsCorr));
  out.yaw = 0;
  return out;
}

/**
 * Point the nose along a world direction using bank-and-pull, up to gLimit.
 * Returns the angle off (rad) for the caller's convenience.
 */
export function flyDirection(s: FlightState, dir: Vec3, out: FlightControls, gLimit = 5, aggression = 1): number {
  const f = s.forward(), u = s.up(), r = s.right();
  const d = dir.clone().normalize();
  const cosErr = clamp(f.dot(d), -1, 1);
  const err = Math.acos(cosErr);
  // Desired lift: towards the target perpendicular to the nose, plus 1 g to hold up the weight.
  const w = d.clone().addScaled(f, -cosErr);
  const wl = w.len();
  const turnG = clamp(err * 6 * aggression, 0, gLimit);
  const lift = new Vec3(0, 1, 0).addScaled(f, -f.y); // gravity compensation, perpendicular to the nose
  if (wl > 1e-4) lift.addScaled(w, turnG / wl);
  const lx = lift.dot(r), ly = lift.dot(u);
  const rollErr = Math.atan2(lx, ly);
  const gWanted = Math.hypot(lx, ly);
  if (err < 0.02) {
    // On target: level the wings gently relative to the lift direction.
    out.roll = clamp(rollErr * 1.5 - s.p * 0.3, -1, 1);
    out.pitch = stickForG(s.type, ly);
  } else {
    out.roll = clamp(rollErr * 2.5 - s.p * 0.3, -1, 1);
    // Pull once roughly rolled into the plane of the turn.
    const aligned = Math.cos(clamp(rollErr, -Math.PI / 2, Math.PI / 2));
    out.pitch = stickForG(s.type, Math.max(0.2, gWanted * Math.max(0, aligned) + (Math.abs(rollErr) > 1.6 ? 0 : 0)));
    if (Math.abs(rollErr) > 2.4 && err > 1.2) out.pitch = stickForG(s.type, gLimit * 0.8); // target behind: pull through
  }
  out.yaw = 0;
  return err;
}

/** Fly towards a world point. */
export function flyTo(s: FlightState, target: Vec3, out: FlightControls, gLimit = 4): number {
  const d = target.clone().sub(s.pos);
  return flyDirection(s, d, out, gLimit);
}

/** Throttle to hold a true airspeed. */
export function holdSpeed(s: FlightState, v: number, out: FlightControls, gain = 0.08): void {
  out.throttle = clamp(out.throttle + (v - s.tas) * gain * 0.02, 0, 1);
}

/** Heading/altitude hold with a climb or descent limited to a vertical speed. */
export function headingAltitude(s: FlightState, heading: number, alt: number, out: FlightControls, maxVs = 12, maxBank = 0.6): void {
  const herr = wrapPi(heading - s.heading);
  const bank = clamp(herr * 1.5, -maxBank, maxBank);
  out.roll = rollTo(s, bank);
  const vsWanted = clamp((alt - s.pos.y) * 0.08, -maxVs, maxVs);
  let g = 1 / Math.max(0.3, Math.cos(s.roll)) + clamp((vsWanted - s.vel.y) * 0.06, -0.6, 0.8);
  if (s.tas < s.type.bestGlide * 0.95 && vsWanted > 0) g = Math.min(g, 1);
  out.pitch = stickForG(s.type, g);
  out.yaw = 0;
}

/** Climb at a fixed indicated airspeed (stick holds speed), heading hold. */
export function climbAtSpeed(s: FlightState, ias: number, heading: number, out: FlightControls): void {
  const herr = wrapPi(heading - s.heading);
  out.roll = rollTo(s, clamp(herr * 1.5, -0.4, 0.4));
  // Too fast: pull up; too slow: lower the nose.
  const g = 1 + clamp((s.ias - ias) * 0.04, -0.5, 0.6) - s.qr * 0.5;
  out.pitch = stickForG(s.type, g);
  out.throttle = 1;
  out.yaw = 0;
}
