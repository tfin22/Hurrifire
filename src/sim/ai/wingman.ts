// RAF squadron pilots other than the player: take off with the leader, form
// up, hold formation, go in when the leader calls tally-ho (or gives an
// order), re-form, and come home and land. Built on the fighter brain, so
// in a fight they obey the same physics and spotting as everyone else.
// Competence depends on skill: green pilots straggle and fixate.

import { clamp, Vec3 } from '../../core/math';
import { TUNING } from '../../tuning';
import type { Plane } from '../plane';
import { flyApproach } from './approach';
import { FighterBrain } from './fighter';
import { rollTo, stickForG } from './pilot';
import type { AIContext, Brain } from './types';

export type SquadronOrder = 'bombers' | 'escort' | 'follow' | 'reform';

export interface Base {
  x: number;
  z: number;
  h: number;
  /** Landing direction (rad). */
  dir: number;
  half: number;
}

export class WingmanBrain implements Brain {
  phase: 'parked' | 'takeoff' | 'air' | 'land' | 'down' = 'parked';
  readonly fighter: FighterBrain;
  order: SquadronOrder = 'reform';
  homeTime = false;
  /** Flying a tight vic: eyes on the leader, not the sky. */
  vic = true;
  private baseSpot = -1;
  private rollDelay: number;
  private rollAt = -1;
  private approachStage = 0;

  constructor(readonly leader: () => Plane | null, public slot: Vec3, readonly base: Base, index: number) {
    this.fighter = new FighterBrain({ leader: undefined, slot, holdFire: true, preferBombers: true });
    this.rollDelay = 1.5 + index * 1.2;
  }

  get state(): string {
    return this.phase === 'air' ? this.fighter.state : this.phase;
  }

  label(): string {
    return this.phase === 'air' ? `${this.fighter.label()}:${this.order}` : this.phase;
  }

  onHit(me: Plane, by: number, ctx: AIContext): void {
    this.fighter.onHit(me, by, ctx);
  }

  /** Leader's order, or tally-ho (= the default: go for the bombers). */
  give(order: SquadronOrder): void {
    this.order = order;
    const f = this.fighter;
    f.opts.holdFire = order === 'follow' || order === 'reform';
    f.opts.preferBombers = order === 'bombers';
    if (f.opts.holdFire && (f.state === 'attack' || f.state === 'extend' || f.state === 'zoom')) {
      f.targetId = -1;
      f.state = 'formation';
    }
    if (order === 'follow') this.slot = new Vec3(0, -5, -60 * (1 + (this.rollDelay - 1.5) / 1.2));
  }

  update(me: Plane, ctx: AIContext): void {
    const fs = me.fs;
    const c = me.ctl;
    const L = this.leader();
    switch (this.phase) {
      case 'parked':
        c.throttle = 0;
        c.brake = true;
        if (fs.engine === 'off' && L && L.fs.engine !== 'off') fs.engine = 'running'; // start up alongside
        if (L && (L.fs.tas > 4 || !L.fs.onGround) && fs.engine === 'running') {
          if (this.rollAt < 0) this.rollAt = ctx.time + this.rollDelay;
          if (ctx.time >= this.rollAt) this.phase = 'takeoff';
        }
        break;
      case 'takeoff':
        c.brake = false;
        c.yaw = 0;
        c.throttle = clamp(c.throttle + ctx.dt * 0.35, 0, 1);
        if (fs.onGround) {
          c.roll = 0;
          c.pitch = fs.ias > 40 ? 0.5 : fs.ias > 22 ? -0.3 : 0;
        } else {
          c.roll = rollTo(fs, 0);
          c.pitch = stickForG(me.type, 1.1);
          if (fs.agl > 40 && fs.gearCmd > 0.5 && me.type.gear !== 'fixed') fs.gearCmd = 0;
          if (fs.agl > 150) {
            this.phase = 'air';
            this.fighter.opts.leader = L ?? undefined;
            this.fighter.opts.slot = this.slot;
            this.fighter.state = L ? 'formation' : 'patrol';
          }
        }
        break;
      case 'air': {
        if (this.baseSpot < 0) this.baseSpot = me.skill.spot;
        me.skill.spot = this.vic && this.fighter.state === 'formation' ? this.baseSpot * TUNING.ai.vicSpotFactor : this.baseSpot;
        this.fighter.opts.leader = L && L.alive && !this.homeTime ? L : undefined;
        this.fighter.opts.slot = this.slot;
        if (this.fighter.state === 'patrol' && L && L.alive) this.fighter.state = 'formation';
        const lowFuel = fs.fuel < me.type.fuelCapacity * 0.18;
        const leaderGone = !L || !L.alive || L.fs.onGround;
        if ((this.homeTime && (leaderGone || L!.pos.distTo(me.pos) > 4000)) || lowFuel || (leaderGone && this.fighter.state === 'patrol')) {
          this.phase = 'land';
          this.approachStage = 0;
        }
        // Without a leader, patrol over base.
        if (!this.fighter.opts.leader && !this.fighter.opts.waypoint) this.fighter.opts.waypoint = new Vec3(this.base.x, 2500, this.base.z);
        this.fighter.update(me, ctx);
        break;
      }
      case 'land': {
        // Join a long final, then the approach autopilot takes it in.
        const tgt = { x: this.base.x - Math.sin(this.base.dir) * (this.base.half - 100), z: this.base.z - Math.cos(this.base.dir) * (this.base.half - 100), h: this.base.h, dir: this.base.dir };
        if (this.approachStage === 0) {
          const ip = new Vec3(tgt.x - Math.sin(tgt.dir) * 3500, tgt.h + 260, tgt.z - Math.cos(tgt.dir) * 3500);
          const d = ip.clone().sub(fs.pos);
          const err = Math.atan2(d.x, d.z);
          c.roll = rollTo(fs, clamp(Math.atan2(Math.sin(err - fs.heading), Math.cos(err - fs.heading)) * 1.5, -0.6, 0.6));
          c.pitch = stickForG(me.type, 1 / Math.max(0.5, Math.cos(fs.roll)) + clamp((ip.y - fs.pos.y) * 0.004 - fs.vel.y * 0.05, -0.4, 0.4));
          c.throttle = 0.6;
          if (Math.hypot(d.x, d.z) < 600) { this.approachStage = 1; fs.gearCmd = 1; fs.flapsCmd = 1; }
        } else {
          flyApproach(fs, tgt, c, { glide: fs.engine !== 'running' });
        }
        me.trigger = false;
        if (me.status === 'landed') this.phase = 'down';
        break;
      }
      case 'down':
        c.throttle = 0;
        c.brake = true;
        break;
    }
  }
}
