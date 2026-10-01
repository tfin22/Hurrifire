// The sun's direction for a date and time at the latitude of Kent.
// Simple solar geometry is plenty: it moves the dangerous sun cone and the
// glint on the sea through the day.

import { Vec3 } from '../core/math';

const LAT = (51.2 * Math.PI) / 180;

/**
 * Unit vector towards the sun in world axes (x east, y up, z north).
 * dayOfYear 1..365, hour is local solar time (BST ≈ solar + 1).
 */
export function sunDirection(dayOfYear: number, hour: number): Vec3 {
  const decl = ((23.44 * Math.PI) / 180) * Math.sin((2 * Math.PI * (284 + dayOfYear)) / 365);
  const H = ((hour - 12) * 15 * Math.PI) / 180;
  const sinEl = Math.sin(LAT) * Math.sin(decl) + Math.cos(LAT) * Math.cos(decl) * Math.cos(H);
  const el = Math.asin(sinEl);
  const cosAz = (Math.sin(decl) - Math.sin(el) * Math.sin(LAT)) / (Math.cos(el) * Math.cos(LAT));
  let az = Math.acos(Math.max(-1, Math.min(1, cosAz)));
  if (H > 0) az = 2 * Math.PI - az; // afternoon: west of south
  return new Vec3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
}

/** Day of year for a 1940 calendar date (leap year). */
export function dayOfYear(month: number, day: number): number {
  const cum = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
  return cum[month - 1] + day;
}
