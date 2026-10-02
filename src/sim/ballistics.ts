// Bullets: short ballistic tracers with travel time, gravity drop, air drag
// and the firing aircraft's own velocity added. Each simulated round can
// stand for a small group of real rounds (TUNING.guns.roundsPerBullet) to
// keep the count manageable with eight Brownings going.

import { G, Vec3 } from '../core/math';
import { ZoneDef } from '../content/aircraft';
import { TUNING } from '../tuning';

export class Bullet {
  readonly pos = new Vec3();
  readonly prev = new Vec3();
  readonly vel = new Vec3();
  life = 0;
  dead = false;
  constructor(
    public ownerId: number,
    public side: string,
    public damage: number,
    public explosive: boolean,
    public tracer: boolean,
  ) {}
}

/** Big-targets scale for an enemy at distance d from the player: true size close in, larger at range. */
export function targetScale(d: number): number {
  const T = TUNING.targets;
  const t = Math.min(1, Math.max(0, (d - T.near) / (T.far - T.near)));
  return 1 + (T.scale - 1) * t;
}

/** Advance a bullet one step: drag, gravity, motion. */
export function stepBullet(b: Bullet, dt: number): void {
  b.prev.copy(b.pos);
  const k = 1 - TUNING.guns.dragPerSec * dt;
  b.vel.x *= k; b.vel.z *= k; b.vel.y = b.vel.y * k - G * dt;
  b.pos.addScaled(b.vel, dt);
  b.life += dt;
  if (b.life > TUNING.guns.maxLife || b.pos.y < -10) b.dead = true;
}

/**
 * Closest-approach parameter of segment a→b to point c, and squared distance.
 * Returns t in [0,1].
 */
export function segmentPoint(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): { t: number; d2: number } {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const l2 = dx * dx + dy * dy + dz * dz;
  let t = l2 > 0 ? ((cx - ax) * dx + (cy - ay) * dy + (cz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = ax + dx * t - cx, py = ay + dy * t - cy, pz = az + dz * t - cz;
  return { t, d2: px * px + py * py + pz * pz };
}

/**
 * Which damage zone (if any) a body-space segment passes through first.
 * Zones are spheres in body coordinates.
 */
export function hitZone(a: Vec3, b: Vec3, zones: readonly ZoneDef[]): { zone: ZoneDef; t: number } | null {
  let best: { zone: ZoneDef; t: number } | null = null;
  for (const z of zones) {
    const r = segmentPoint(a.x, a.y, a.z, b.x, b.y, b.z, z.pos[0], z.pos[1], z.pos[2]);
    if (r.d2 <= z.r * z.r && (!best || r.t < best.t)) best = { zone: z, t: r.t };
  }
  return best;
}

/**
 * Body-space gun direction so a round from `gun` crosses the sight line at
 * `range` metres, harmonised for gravity drop. The sight line runs along +z
 * from the pilot's eye.
 */
export function convergedDirection(gun: [number, number, number], eye: [number, number, number], range: number, muzzle: number): Vec3 {
  const t = timeOfFlight(range, muzzle);
  const drop = 0.5 * G * t * t;
  const aim = new Vec3(eye[0], eye[1] + drop, eye[2] + range);
  return aim.sub(new Vec3(gun[0], gun[1], gun[2])).normalize();
}

/** Time for a round to travel `range` metres with our linear drag. */
export function timeOfFlight(range: number, muzzle: number): number {
  const k = TUNING.guns.dragPerSec;
  // x(t) = v0/k (1 - e^-kt)  →  t = -ln(1 - k x / v0) / k
  const q = 1 - (k * range) / muzzle;
  if (q <= 0.05) return 99;
  return -Math.log(q) / k;
}

/** Intercept point for leading a target (used by the AI and the Assist lead marker). */
export function leadPoint(shooterPos: Vec3, shooterVel: Vec3, targetPos: Vec3, targetVel: Vec3, muzzle: number): Vec3 {
  // Iterate time-of-flight on the relative geometry.
  let t = shooterPos.distTo(targetPos) / muzzle;
  const rel = new Vec3();
  for (let i = 0; i < 4; i++) {
    rel.copy(targetPos).addScaled(targetVel, t).sub(shooterPos).addScaled(shooterVel, -t);
    t = timeOfFlight(rel.len(), muzzle);
    if (t > 5) break;
  }
  // Point in world to put the sight on: where the target will be, less our own drift, plus drop.
  const p = targetPos.clone().addScaled(targetVel, t).addScaled(shooterVel, -t);
  p.y += 0.5 * G * t * t;
  return p;
}
