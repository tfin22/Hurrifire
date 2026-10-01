// Approach and landing autopilot: line up on a runway direction, fly a
// glide path at approach speed, flare to a three-point attitude. Used by AI
// pilots landing (wingmen coming home, forced landings) and by tests that
// fly whole approaches through the touchdown model.

import { clamp, wrapPi } from '../../core/math';
import { stallSpeed } from '../../content/aircraft';
import { FlightControls, FlightState } from '../flight';
import { rollTo, stickForG } from './pilot';

export interface ApproachTarget {
  /** Touchdown point. */
  x: number;
  z: number;
  h: number;
  /** Landing heading (rad). */
  dir: number;
}

export interface ApproachOpts {
  /** Engine-off glide (steeper path, no throttle). */
  glide?: boolean;
  /** Glide path angle (rad). */
  path?: number;
  /** Approach speed as a multiple of stall. */
  speedRatio?: number;
}

/** One step of the approach. Returns the phase for debugging. */
export function flyApproach(s: FlightState, tgt: ApproachTarget, out: FlightControls, o: ApproachOpts = {}): 'line-up' | 'final' | 'flare' | 'roll' {
  const t = s.type;
  const vs = stallSpeed(t, s.mass, 1.225, s.flaps);
  const vApp = vs * (o.speedRatio ?? (o.glide ? 1.35 : 1.3));
  const path = o.path ?? (o.glide ? 0.11 : 0.075);
  const dx = Math.sin(tgt.dir), dz = Math.cos(tgt.dir);
  // Along-track distance to the touchdown point and cross-track offset.
  const rx = tgt.x - s.pos.x, rz = tgt.z - s.pos.z;
  const along = rx * dx + rz * dz;
  const cross = rx * dz - rz * dx; // + means the line is to our right
  const agl = s.pos.y - tgt.h - t.gearHeight;
  out.yaw = 0;
  out.brake = false;
  if (s.onGround) {
    out.roll = 0;
    out.pitch = 0.3;
    out.throttle = 0;
    out.brake = s.tas < 25;
    return 'roll';
  }
  if (agl < 7) {
    // Flare: kill the sink, ease to the three-point attitude, power off.
    out.roll = rollTo(s, 0, 2);
    const wantVs = -0.6 - agl * 0.12;
    const g = 1 + clamp((wantVs - s.vel.y) * 0.25, -0.3, 0.8) + (t.groundAttitude - s.pitch) * 0.6;
    out.pitch = stickForG(t, g);
    out.throttle = 0;
    return 'flare';
  }
  // Heading: aim to intercept the centreline.
  const intercept = clamp(cross * 0.004, -0.6, 0.6);
  const wantHdg = tgt.dir + intercept;
  const herr = wrapPi(wantHdg - s.heading);
  out.roll = rollTo(s, clamp(herr * 2.2, -0.45, 0.45), 2);
  // Height on the glide path.
  const wantH = Math.max(0, along) * Math.tan(path);
  const hErr = wantH - agl;
  const wantVs = clamp(-s.tas * Math.sin(path) + hErr * 0.15, -9, 3);
  let g = 1 / Math.max(0.5, Math.cos(s.roll)) + clamp((wantVs - s.vel.y) * 0.08, -0.4, 0.5);
  // Speed: with power on, throttle holds speed; gliding, the stick does.
  if (o.glide) {
    out.throttle = 0;
    if (s.ias < vApp) g = Math.min(g, 1 - (vApp - s.ias) * 0.04);
  } else {
    out.throttle = clamp(0.35 + (vApp - s.ias) * 0.06 - hErr * 0.002, 0, 0.9);
  }
  out.pitch = stickForG(t, g);
  return Math.abs(cross) > 60 ? 'line-up' : 'final';
}
