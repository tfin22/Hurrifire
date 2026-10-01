// Forward guns (pilot's trigger) and defensive gunners.

import { Vec3 } from '../core/math';
import { Rng } from '../core/rng';
import { AircraftType, GunMount, Gunner, GunType, GUNS } from '../content/aircraft';
import { TUNING } from '../tuning';
import { Bullet, convergedDirection, leadPoint } from './ballistics';

/** The pilot's eye in body coordinates; the gunsight looks along +z from here. */
export const EYE: [number, number, number] = [0, 0.75, -0.3];

export interface GunState {
  mount: GunMount;
  type: GunType;
  rounds: number;
  acc: number;
  /** Body-space direction (converged). */
  dir: Vec3;
}

export class Armament {
  readonly guns: GunState[];
  convergence: number;
  readonly totalStart: number;
  /** Rounds fired this sortie (for the debrief). */
  fired = 0;

  constructor(type: AircraftType, convergenceM: number) {
    this.convergence = convergenceM;
    this.guns = type.guns.map((m) => ({ mount: m, type: GUNS[m.gun], rounds: m.rounds, acc: 0, dir: new Vec3(0, 0, 1) }));
    this.totalStart = this.guns.reduce((a, g) => a + g.rounds, 0);
    this.setConvergence(convergenceM);
  }

  setConvergence(range: number): void {
    this.convergence = range;
    for (const g of this.guns) {
      // Fuselage guns sit near the sight line: harmonise them on it too.
      g.dir = convergedDirection(g.mount.pos, EYE, range, g.type.muzzle);
    }
  }

  get rounds(): number {
    return this.guns.reduce((a, g) => a + g.rounds, 0);
  }

  get frac(): number {
    return this.totalStart ? this.rounds / this.totalStart : 0;
  }

  /**
   * Fire for one step. Spawns bullets into `out`. Returns true if anything fired.
   */
  fire(pos: Vec3, vel: Vec3, rot: (v: Vec3) => Vec3, ownerId: number, side: string, dt: number, rng: Rng, out: Bullet[], unlimited = false): boolean {
    let any = false;
    const per = TUNING.guns.roundsPerBullet;
    for (const g of this.guns) {
      if (g.rounds <= 0 && !unlimited) continue;
      g.acc += (g.type.rate * dt) / (g.type.damage >= 5 ? 1 : per);
      while (g.acc >= 1) {
        g.acc -= 1;
        const n = g.type.damage >= 5 ? 1 : per;
        if (!unlimited) g.rounds = Math.max(0, g.rounds - n);
        this.fired += n;
        const b = new Bullet(ownerId, side, g.type.damage * n, g.type.explosive, rng.next() < (1 / g.type.tracerEvery) * n);
        const d = g.dir.clone();
        d.x += rng.gauss() * g.type.spread * 0.5;
        d.y += rng.gauss() * g.type.spread * 0.5;
        const wd = rot(d.normalize());
        const wp = rot(new Vec3(g.mount.pos[0], g.mount.pos[1], g.mount.pos[2]));
        b.pos.copy(pos).add(wp);
        b.prev.copy(b.pos);
        b.vel.copy(vel).addScaled(wd, g.type.muzzle);
        out.push(b);
        any = true;
        if (g.rounds <= 0 && !unlimited) break;
      }
    }
    return any;
  }
}

/** A defensive gunner: picks a target in his arc and fires short bursts. */
export class GunnerState {
  rounds: number;
  acc = 0;
  burst = 0;
  pause = 0;
  drum = 0;
  alive = true;
  targetId = -1;
  constructor(readonly def: Gunner) {
    this.rounds = def.rounds;
  }
}

export interface GunnerTarget {
  id: number;
  pos: Vec3;
  vel: Vec3;
}

/**
 * Step a gunner. `toBody`/`toWorld` rotate vectors between frames. Aim error
 * scales with `skill` (0 green .. 1 experte) and the gunner's own motion.
 */
export function stepGunner(
  g: GunnerState, ownPos: Vec3, ownVel: Vec3, toBody: (v: Vec3) => Vec3, toWorld: (v: Vec3) => Vec3,
  targets: GunnerTarget[], skill: number, ownerId: number, side: string, dt: number, rng: Rng, out: Bullet[],
): boolean {
  if (!g.alive || g.rounds <= 0) return false;
  if (g.pause > 0) { g.pause -= dt; return false; }
  const type = GUNS[g.def.gun];
  const gunPos = ownPos.clone().add(toWorld(new Vec3(...g.def.pos)));
  // Choose the nearest target inside the arc and range.
  const range = TUNING.guns.gunnerRange;
  let best: GunnerTarget | null = null, bd = range;
  const axis = new Vec3(...g.def.dir).normalize();
  for (const t of targets) {
    const d = t.pos.distTo(gunPos);
    if (d > bd) continue;
    const bodyDir = toBody(t.pos.clone().sub(gunPos)).normalize();
    if (bodyDir.dot(axis) < Math.cos(g.def.arc)) continue;
    best = t; bd = d;
  }
  if (!best) { g.burst = 0; return false; }
  g.targetId = best.id;
  if (g.burst <= 0) {
    g.burst = rng.range(0.8, 2.2);
  }
  g.burst -= dt;
  if (g.burst <= 0) { g.pause = rng.range(0.6, 2.0); return false; }
  const aim = leadPoint(gunPos, ownVel, best.pos, best.vel, type.muzzle);
  // Aim error: a few metres at the target, worse for green gunners and at long range.
  const err = (1.4 - skill) * (2 + bd / 80);
  aim.x += rng.gauss() * err; aim.y += rng.gauss() * err; aim.z += rng.gauss() * err;
  const dir = aim.sub(gunPos).normalize();
  // Must still be within the arc after error.
  if (toBody(dir.clone()).dot(axis) < Math.cos(g.def.arc * 1.05)) return false;
  g.acc += (type.rate * dt) / TUNING.guns.roundsPerBullet;
  let fired = false;
  while (g.acc >= 1 && g.rounds > 0) {
    g.acc -= 1;
    const n = TUNING.guns.roundsPerBullet;
    g.rounds -= n;
    g.drum += n;
    const b = new Bullet(ownerId, side, type.damage * n, type.explosive, rng.next() < (1 / type.tracerEvery) * n);
    b.pos.copy(gunPos);
    b.prev.copy(gunPos);
    const d = dir.clone();
    d.x += rng.gauss() * type.spread * 0.5;
    d.y += rng.gauss() * type.spread * 0.5;
    b.vel.copy(ownVel).addScaled(d.normalize(), type.muzzle);
    out.push(b);
    fired = true;
    if (g.drum >= 75) { g.drum = 0; g.pause = TUNING.guns.drumChange; g.burst = 0; break; }
  }
  return fired;
}
