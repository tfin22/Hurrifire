// Glide performance: best lift/drag ratio with the propeller windmilling,
// and how far you can get from a height, with the wind. Used by the Assist
// glide-range ring and by AI forced landings; checked against the flight
// model in tests.

import { AircraftType, massOf } from '../content/aircraft';

/** Extra drag of a windmilling prop (matches flight.ts). */
export const WINDMILL_CD = 0.008;

function induced(t: AircraftType): number {
  const AR = (t.span * t.span) / t.wingArea;
  return 1 / (Math.PI * AR * t.oswald);
}

/** Best (maximum) lift/drag ratio, clean, prop windmilling. */
export function bestGlideRatio(t: AircraftType): number {
  const cd0 = t.cd0 + WINDMILL_CD;
  return 1 / (2 * Math.sqrt(cd0 * induced(t)));
}

/** Speed for best glide (EAS ≈ IAS, m/s) at a mass. */
export function bestGlideSpeed(t: AircraftType, mass: number): number {
  const cd0 = t.cd0 + WINDMILL_CD;
  const cl = Math.sqrt(cd0 / induced(t));
  return Math.sqrt((2 * mass * 9.81) / (1.225 * t.wingArea * cl));
}

/**
 * Still-air glide range from a height, corrected for a wind component along
 * the track (positive = tailwind). Keeps a reserve height for the approach.
 */
export function glideRange(t: AircraftType, heightAgl: number, windAlong = 0, reserve = 100, mass = massOf(t, t.fuelCapacity * 0.3)): number {
  const h = Math.max(0, heightAgl - reserve);
  const ld = bestGlideRatio(t);
  const v = bestGlideSpeed(t, mass);
  const groundFactor = Math.max(0.2, (v + windAlong) / v);
  return h * ld * groundFactor;
}

/** Can a point at horizontal distance d (along a heading with this wind) be reached? */
export function canReach(t: AircraftType, heightAgl: number, d: number, windAlong = 0): boolean {
  return glideRange(t, heightAgl, windAlong) >= d;
}
