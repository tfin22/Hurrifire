// The sector controller. Works from the plot (radar and Observer Corps), not
// from the truth: positions are a little out, heights can be thousands of
// feet out, strengths are estimates. Gives vectors to intercept, updates,
// "bandits ahead" when close, and "pancake" when it's over. The R/T fades
// with distance from the sector and is unreadable over France.

import { M_TO_FT, Vec3, wrapPi } from '../core/math';
import { Rng } from '../core/rng';
import { clockOf, garble, RT, sayAngels, sayHeading, sayMiles, sayStrength } from '../content/text/rt';
import { TUNING } from '../tuning';
import type { Raid } from './raid';

export interface RTMessage {
  t: number;
  from: 'controller' | 'squadron' | 'player';
  text: string;
  /** Spoken calls stop time compression. */
  urgent?: boolean;
}

export interface Vector {
  /** Heading to steer (rad, compass). */
  heading: number;
  /** Seconds to the intercept. */
  time: number;
  point: Vec3;
  /** Can we catch it at all? */
  feasible: boolean;
}

/**
 * Collision-course intercept: steer so that after time t we are where the
 * raid will be. Solves |P + V t − S| = s t for the smallest positive t.
 */
export function interceptVector(own: Vec3, ownSpeed: number, raidPos: Vec3, raidVel: Vec3): Vector {
  const dx = raidPos.x - own.x, dz = raidPos.z - own.z;
  const vx = raidVel.x, vz = raidVel.z;
  const a = vx * vx + vz * vz - ownSpeed * ownSpeed;
  const b = 2 * (dx * vx + dz * vz);
  const c = dx * dx + dz * dz;
  let t: number;
  if (Math.abs(a) < 1e-6) t = -c / b;
  else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) t = NaN;
    else {
      const r = Math.sqrt(disc);
      const t1 = (-b - r) / (2 * a), t2 = (-b + r) / (2 * a);
      t = [t1, t2].filter((x) => x > 0).sort((p, q) => p - q)[0] ?? NaN;
    }
  }
  if (!isFinite(t) || t <= 0) {
    // Can't catch it: steer straight at it.
    let h = Math.atan2(dx, dz);
    if (h < 0) h += Math.PI * 2;
    return { heading: h, time: Math.hypot(dx, dz) / Math.max(1, ownSpeed), point: raidPos.clone(), feasible: false };
  }
  const point = new Vec3(raidPos.x + vx * t, raidPos.y, raidPos.z + vz * t);
  let h = Math.atan2(point.x - own.x, point.z - own.z);
  if (h < 0) h += Math.PI * 2;
  return { heading: h, time: t, point, feasible: true };
}

/** The height the controller gives, from the raid's true height and its radar error. */
export function reportedHeight(trueAlt: number, raid: Pick<Raid, 'heightError'>, rng: Rng): number {
  const noise = (rng.next() - 0.5) * 300;
  return Math.max(1500, trueAlt + raid.heightError + noise);
}

export interface ControllerView {
  time: number;
  /** Squadron leader / player position and speed. */
  pos: Vec3;
  speed: number;
  raids: Raid[];
  /** Is the squadron engaged (tally-ho called)? */
  engaged: boolean;
  /** Player fuel fraction, damage, etc. for pancake calls. */
  wantsHome: boolean;
  /** Distance from the sector station (m). */
  fromSector: number;
  overFrance: boolean;
  offMap: boolean;
  /** Describe a position for the R/T ("approaching Dungeness"). */
  describe(p: Vec3, moving?: Vec3): string;
}

export class SectorController {
  readonly log: RTMessage[] = [];
  private nextVector = 0;
  private lastClose = -1000;
  private pancaked = false;
  private warnedFrance = false;
  private warnedEdge = false;
  private ackedTally = false;
  targetRaid: Raid | null = null;
  lastVector: Vector | null = null;
  lastAngels = 0;
  private rng: Rng;

  constructor(readonly squadron: string, readonly callsign: string, seed: number) {
    this.rng = new Rng(seed);
  }

  say(t: number, text: string, from: RTMessage['from'] = 'controller', urgent = true, fade = 0): void {
    this.log.push({ t, from, text: from === 'controller' ? garble(text, fade, this.rng) : text, urgent });
  }

  /** How badly the R/T is breaking up (0 clear … 1 nothing). */
  fadeFor(v: ControllerView): number {
    if (v.overFrance) return 0.7;
    return Math.max(0, Math.min(0.6, (v.fromSector - 70000) / 60000));
  }

  /** The scramble call. */
  scramble(v: ControllerView, patrol: string, angelsFt: number): void {
    this.say(v.time, RT.scramble(this.squadron, this.callsign, sayAngels(angelsFt), patrol));
    this.nextVector = v.time + TUNING.controller.firstVectorDelay;
  }

  step(v: ControllerView): void {
    const C = TUNING.controller;
    const fade = this.fadeFor(v);
    if (v.overFrance && !this.warnedFrance) {
      this.warnedFrance = true;
      this.say(v.time, RT.overFrance(this.squadron, this.callsign), 'controller', true, fade);
    }
    if (!v.overFrance) this.warnedFrance = false;
    if (v.offMap && !this.warnedEdge) { this.warnedEdge = true; this.say(v.time, RT.comeHome(this.squadron, this.callsign), 'controller', true, fade); }
    if (!v.offMap) this.warnedEdge = false;
    if (this.pancaked) return;
    // Choose the raid to send us at: the nearest one still coming in.
    const live = v.raids.filter((r) => r.started && !r.turnedBack && r.phase !== 'outbound' && r.estimatedStrength > 0);
    if (!live.length || v.wantsHome) {
      if (v.time > C.minSortie && (v.raids.every((r) => r.phase === 'outbound' || r.turnedBack || !r.started) || v.wantsHome)) {
        this.pancaked = true;
        this.say(v.time, v.wantsHome ? RT.pancakeFuel(this.squadron, this.callsign) : RT.pancake(this.squadron, this.callsign), 'controller', true, fade);
      }
      return;
    }
    live.sort((a, b) => a.plot.distTo(v.pos) - b.plot.distTo(v.pos));
    const raid = (this.targetRaid = live[0]);
    if (v.engaged) {
      if (!this.ackedTally) { this.ackedTally = true; this.say(v.time, RT.tallyAck(this.callsign), 'controller', false, fade); }
      return;
    }
    const d = raid.plot.distTo(v.pos);
    // Close in: the controller calls it, and the pilots should see them soon.
    if (d < C.closeRange && v.time - this.lastClose > C.closeEvery) {
      this.lastClose = v.time;
      const brg = Math.atan2(raid.plot.x - v.pos.x, raid.plot.z - v.pos.z);
      const rel = raid.plot.y + raid.heightError > v.pos.y + 600 ? 'above' : raid.plot.y + raid.heightError < v.pos.y - 600 ? 'below' : 'same level';
      const vec = this.lastVector;
      const myHdg = vec ? vec.heading : brg;
      this.say(v.time, RT.close(this.squadron, this.callsign, sayMiles(d), clockOf(((wrapPi(brg - myHdg) * 180) / Math.PI)), rel), 'controller', true, fade);
      return;
    }
    if (v.time < this.nextVector) return;
    this.nextVector = v.time + C.vectorEvery;
    // Work from the plot, which is a little out.
    const plotPos = raid.plot.clone().add(new Vec3((this.rng.next() - 0.5) * C.plotError, 0, (this.rng.next() - 0.5) * C.plotError));
    const vec = interceptVector(v.pos, Math.max(v.speed, C.assumedSpeed), plotPos, raid.vel);
    const angelsFt = reportedHeight(raid.plot.y, raid, this.rng) * M_TO_FT;
    const first = !this.lastVector;
    this.lastVector = vec;
    this.lastAngels = angelsFt;
    const buster = vec.time > C.busterTime || !vec.feasible;
    const where = v.describe(raid.plot, raid.vel);
    const text = first
      ? RT.vector(this.squadron, this.callsign, sayHeading((vec.heading * 180) / Math.PI), sayAngels(angelsFt), buster, sayStrength(raid.estimatedStrength), where)
      : RT.update(this.squadron, this.callsign, sayHeading((vec.heading * 180) / Math.PI), sayStrength(raid.estimatedStrength), where, sayAngels(angelsFt));
    this.say(v.time, text, 'controller', true, fade);
  }

  /** Player called tally-ho. */
  tallyHo(): void {
    this.ackedTally = false;
  }
}
