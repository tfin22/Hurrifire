// Raids. A raid exists first as a plot moving along its route from France;
// when RAF fighters get within range it becomes real aircraft in formation:
// bomber vics stacked in a box, close escort weaving above and behind, top
// cover higher still. It flies to the target, bombs, and goes home, unless
// it is broken up and turned back first. A bomber under fire calls it in,
// and the escort comes down on whoever is shooting.

import { Vec3 } from '../core/math';
import { Rng } from '../core/rng';
import { TUNING } from '../tuning';
import { AIRCRAFT, AircraftId } from '../content/aircraft';
import { BomberBrain, RaidLink } from './ai/bomber';
import { DefensiveCircle, FighterBrain } from './ai/fighter';
import { skillFor, SkillLevel } from './ai/types';
import type { Plane } from './plane';
import type { World } from './world';

export type RaidKind = 'convoy' | 'airfield' | 'radar' | 'london' | 'jabo' | 'sweep';
export type GroupRole = 'bomber' | 'diveBomber' | 'closeEscort' | 'topCover' | 'zerstorer' | 'jabo' | 'sweep';

export interface RaidGroupSpec {
  type: AircraftId;
  count: number;
  role: GroupRole;
  /** Height above the bombers (m). */
  altOffset: number;
  skill: SkillLevel;
}

export interface RaidSpec {
  name: string;
  kind: RaidKind;
  targetName: string;
  target: Vec3;
  /** Where the plot starts (over France or mid-Channel). */
  start: Vec3;
  /** Coast-crossing waypoint. */
  entry: Vec3;
  alt: number;
  speed: number;
  groups: RaidGroupSpec[];
  /** Raid starts moving this many seconds after the sortie starts. */
  delay: number;
}

export class Bomb {
  readonly pos = new Vec3();
  readonly vel = new Vec3();
  constructor(readonly raidId: number, readonly ownerId: number, readonly kg: number) {}
}

export class Raid implements RaidLink {
  readonly id: number;
  /** True position of the formation (centroid once spawned). */
  readonly plot = new Vec3();
  readonly vel = new Vec3();
  route: Vec3[];
  speed: number;
  alt: number;
  target: Vec3;
  home: Vec3;
  phase: RaidLink['phase'] = 'inbound';
  lastAttacked = -100;
  spawned = false;
  planes: Plane[] = [];
  bombers: Plane[] = [];
  escorts: Plane[] = [];
  dive: boolean;
  private leg = 1;
  private leaderRef: Plane | null = null;
  /** Bombs that fell within 600 m of the target, and total dropped (kg). */
  bombsOnTarget = 0;
  bombsDropped = 0;
  jettisoned = 0;
  turnedBack = false;
  /** Controller's radar errors, fixed per raid. */
  readonly heightError: number;
  readonly strengthFactor: number;
  readonly total: number;
  started = false;
  /** The 110s' shared defensive circle. */
  readonly circle: DefensiveCircle = { centre: null, radius: 650, dir: 1, lastThreat: -100 };
  /** Direction towards the sun (top cover sits up-sun). */
  sun: Vec3 | null = null;
  /** Who is shooting at the bombers: attacker id → first and latest report (s). */
  readonly alarms = new Map<number, { first: number; last: number }>();
  /** Bombers already counted as lost (for the crews alongside). */
  private lost = new Set<number>();

  constructor(id: number, readonly spec: RaidSpec, rng: Rng) {
    this.id = id;
    this.route = [spec.start.clone(), spec.entry.clone(), spec.target.clone(), spec.entry.clone().add(new Vec3(6000, 0, -8000)), spec.start.clone()];
    this.route.forEach((p) => (p.y = spec.alt));
    // A formation flies at the pace of its slowest bombers, whatever the plan said.
    const cruise = spec.groups.filter((g) => g.role === 'bomber' || g.role === 'diveBomber' || g.role === 'zerstorer').map((g) => AIRCRAFT[g.type].cruise ?? Infinity);
    this.speed = Math.min(spec.speed, ...cruise);
    this.alt = spec.alt;
    this.target = spec.target.clone();
    this.home = spec.start.clone();
    this.home.y = spec.alt;
    this.plot.copy(this.route[0]);
    this.dive = spec.groups.some((g) => g.role === 'diveBomber');
    // Radar heights could be thousands of feet out; strengths were estimates.
    this.heightError = (rng.next() * 2 - 1) * 1200 + (rng.chance(0.3) ? (rng.next() < 0.5 ? -1 : 1) * 600 : 0);
    this.strengthFactor = 0.7 + rng.next() * 0.7;
    this.total = spec.groups.reduce((a, g) => a + g.count, 0);
  }

  leader(): Plane | null {
    if (this.leaderRef && this.leaderRef.alive && this.leaderRef.brain instanceof BomberBrain && this.leaderRef.brain.state !== 'straggler') return this.leaderRef;
    // Next in line takes over.
    this.leaderRef = this.bombers.find((b) => b.alive && b.brain instanceof BomberBrain && b.brain.state !== 'straggler') ?? null;
    if (this.leaderRef) {
      const b = this.leaderRef.brain as BomberBrain;
      b.leg = Math.max(b.leg, this.leg);
      for (const e of this.escorts) if (e.brain instanceof FighterBrain && e.brain.opts.leader) e.brain.opts.leader = this.leaderRef;
    }
    return this.leaderRef;
  }

  /** Strength the radar sees. */
  get estimatedStrength(): number {
    const alive = this.spawned ? this.planes.filter((p) => p.alive).length : this.total;
    return Math.max(3, Math.round(alive * this.strengthFactor));
  }

  release(p: Plane): void {
    this.drop?.(this, p, false);
  }

  jettison(p: Plane): void {
    this.jettisoned++;
    this.drop?.(this, p, true);
  }

  alarm(attackerId: number, time: number): void {
    const a = this.alarms.get(attackerId);
    if (a && time - a.last < TUNING.ai.escortAlarmMemory) a.last = time;
    else this.alarms.set(attackerId, { first: time, last: time });
  }

  /** A bomber going down shakes the crews flying alongside it. */
  private lossesSeen(time: number): void {
    for (const b of this.bombers) {
      if (b.status === 'flying' || this.lost.has(b.id)) continue;
      this.lost.add(b.id);
      for (const o of this.bombers) {
        if (o === b || o.status !== 'flying' || !(o.brain instanceof BomberBrain)) continue;
        if (o.pos.distTo(b.pos) < TUNING.ai.lossRange) o.brain.shake(o, TUNING.ai.nerveLoss, time);
      }
    }
  }

  /** Set by the world: puts the bombs into the air. */
  drop: ((r: Raid, p: Plane, jettison: boolean) => void) | null = null;

  /** Advance the abstract plot (before spawning) or track the formation. */
  step(dt: number, time: number): void {
    if (time < this.spec.delay) return;
    this.started = true;
    if (!this.spawned) {
      const wp = this.route[Math.min(this.leg, this.route.length - 1)];
      const d = wp.clone().sub(this.plot);
      d.y = 0;
      const l = d.len();
      if (l < 500 && this.leg < this.route.length - 1) this.leg++;
      if (l > 1) this.vel.copy(d).scale(this.speed / l);
      this.plot.addScaled(this.vel, dt);
      this.plot.y = this.alt;
    } else {
      // The formation is where the bombers still in it are, not the ones running for home.
      const inFormation = this.bombers.filter((p) => p.alive && p.brain instanceof BomberBrain && p.brain.state !== 'straggler');
      const live = inFormation.length ? inFormation : (this.bombers.length ? this.bombers : this.escorts).filter((p) => p.alive);
      if (live.length) {
        const c = new Vec3();
        const v = new Vec3();
        for (const p of live) { c.add(p.pos); v.add(p.fs.vel); }
        this.plot.copy(c.scale(1 / live.length));
        this.vel.copy(v.scale(1 / live.length));
      }
      const L = this.leader();
      if (L && L.brain instanceof BomberBrain) this.leg = L.brain.leg;
      this.lossesSeen(time);
    }
    // Phases.
    const toTarget = Math.hypot(this.plot.x - this.target.x, this.plot.z - this.target.z);
    if (this.phase === 'inbound' && toTarget < (this.dive ? 4000 : 9000)) this.phase = 'bombRun';
    const bombersLeft = this.bombers.filter((b) => b.alive && b.bombs > 0 && b.brain instanceof BomberBrain && b.brain.state !== 'straggler').length;
    if (this.phase === 'bombRun' && this.spawned && bombersLeft === 0) this.phase = 'outbound';
    if (this.phase === 'bombRun' && !this.spawned && toTarget < 500) {
      // Abstract bombing (nobody intercepted near the target).
      this.phase = 'outbound';
      this.bombsDropped += this.total;
      this.bombsOnTarget += Math.round(this.total * 0.5);
    }
    // Broken up: most bombers gone or straggling before the target.
    if (this.spawned && this.phase === 'inbound' && this.bombers.length) {
      const fit = this.bombers.filter((b) => b.alive && b.brain instanceof BomberBrain && b.brain.state !== 'straggler').length;
      if (fit <= this.bombers.length * 0.4) {
        this.phase = 'scattered';
        this.turnedBack = true;
      }
    }
    if (this.phase === 'outbound') { this.leg = Math.max(this.leg, 3); }
  }

  /** Make the raid real: aircraft in formation around the plot. */
  spawn(w: World, rng: Rng): void {
    if (this.spawned) return;
    this.spawned = true;
    const hdg = Math.atan2(this.vel.x || 0.0001, this.vel.z || -1);
    const fwd = new Vec3(Math.sin(hdg), 0, Math.cos(hdg));
    const right = new Vec3(Math.cos(hdg), 0, -Math.sin(hdg));
    const place = (off: Vec3) => this.plot.clone().addScaled(right, off.x).addScaled(fwd, off.z).add(new Vec3(0, off.y, 0));
    let n = 0;
    let first: Plane | null = null;
    for (const g of this.spec.groups) {
      if (g.role !== 'bomber' && g.role !== 'diveBomber' && g.role !== 'jabo') continue;
      for (let i = 0; i < g.count; i++, n++) {
        const slot = g.role === 'jabo' ? new Vec3((n % 2 ? 1 : -1) * 40 * Math.ceil(n / 2), 0, -30 * n) : bomberSlot(n);
        const p = w.addPlane(g.type, 'lw', `${g.type}-${n}`, 0.7);
        p.skill = skillFor(g.skill);
        p.unit = this.spec.name;
        p.fs.setAirborne(place(slot), hdg, this.speed);
        p.fs.throttle = 0.75;
        p.brain = new BomberBrain(this, slot);
        if (g.role === 'jabo') p.bombs = 250;
        this.bombers.push(p);
        this.planes.push(p);
        if (!first) first = p;
      }
    }
    this.leaderRef = first;
    if (first) (first.brain as BomberBrain).leg = this.leg;
    let e = 0;
    for (const g of this.spec.groups) {
      if (g.role === 'bomber' || g.role === 'diveBomber' || g.role === 'jabo') continue;
      for (let i = 0; i < g.count; i++, e++) {
        const p = w.addPlane(g.type, 'lw', `${g.type}-e${e}`, g.type === 'bf109' ? 0.62 : 0.7);
        p.skill = skillFor(g.skill);
        p.unit = this.spec.name;
        const slot = escortSlot(g.role, i, g.altOffset, rng);
        if (g.role === 'topCover' && this.sun) {
          // Top cover sits up-sun of the bombers, where the RAF can't see it.
          const sx = this.sun.x * Math.cos(hdg) - this.sun.z * Math.sin(hdg);
          const sz = this.sun.x * Math.sin(hdg) + this.sun.z * Math.cos(hdg);
          const l = Math.hypot(sx, sz) || 1;
          slot.x += (sx / l) * 1200;
          slot.z += (sz / l) * 1200;
        }
        p.fs.setAirborne(place(slot), hdg, this.speed + 10);
        if (first && (g.role === 'closeEscort' || g.role === 'topCover' || g.role === 'zerstorer')) {
          p.brain = new FighterBrain({ leader: first, slot, escortOf: () => this.bombers, alarm: this.alarms, circle: g.type === 'bf110' ? this.circle : undefined });
        } else {
          // Free hunt / fighter-bombers: fly the route.
          p.brain = new FighterBrain({ waypoint: this.target.clone().add(new Vec3(0, g.altOffset, 0)) });
        }
        this.escorts.push(p);
        this.planes.push(p);
      }
    }
  }
}

/** Bombers: vics of three, vics stacked into a box of nine, boxes side by side. */
export function bomberSlot(n: number): Vec3 {
  const vic = [new Vec3(0, 0, 0), new Vec3(-35, 0, -30), new Vec3(35, 0, -30)];
  const staffel = [new Vec3(0, 0, 0), new Vec3(-110, -25, -90), new Vec3(110, -25, -90)];
  const box = Math.floor(n / 9);
  const boxOff = new Vec3((box % 2 ? 1 : -1) * Math.ceil(box / 2) * 380, (box % 2 ? 40 : -40) * Math.ceil(box / 2), -box * 180);
  return vic[n % 3].clone().add(staffel[Math.floor(n / 3) % 3]).add(boxOff);
}

function escortSlot(role: GroupRole, i: number, altOffset: number, rng: Rng): Vec3 {
  const pair = Math.floor(i / 2), wing = i % 2;
  const side = pair % 2 ? 1 : -1;
  const back = role === 'closeEscort' ? -250 : -500;
  return new Vec3(side * (300 + Math.floor(pair / 2) * 250) + wing * 60, altOffset + rng.range(-60, 60), back - pair * 120 - wing * 40);
}
