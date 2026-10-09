// Fighter AI: a state machine per aircraft.
//
//   patrol  → fly the route or hold a formation slot, scanning the sky
//   attack  → lead pursuit, fire inside the skill's range and aim tolerance
//   extend  → unload and run to rebuild speed (energy discipline)
//   zoom    → convert speed back into height after a diving pass
//   evade   → break into an attacker, or (fuel-injected 109s) bunt into a
//             dive that a Merlin can't follow without cutting out
//   bunt    → the push-over itself, then the dive
//   rtb     → low fuel, no ammunition or damaged: run for home
//   bail    → leave the aircraft
//
// Everything goes through the same stick, rudder and throttle the player
// has, and the same flight model.

import { clamp, Vec3 } from '../../core/math';
import { TUNING } from '../../tuning';
import { leadPoint } from '../ballistics';
import { controllable } from '../damage';
import type { Plane } from '../plane';
import { availableG, flyDirection, flyTo, headingAltitude, maxLevelTurn, rollTo, stickForG } from './pilot';
import { ContactMemory, threatGeometry } from './spotting';
import type { AIContext, Brain } from './types';

export type FighterState = 'circle' | 'patrol' | 'formation' | 'attack' | 'extend' | 'zoom' | 'evade' | 'bunt' | 'rtb' | 'bail' | 'glide' | 'pullUp';

export interface FighterOpts {
  /** Patrol waypoint and height. */
  waypoint?: Vec3;
  /** Follow this plane at a body-frame offset. */
  leader?: Plane;
  slot?: Vec3;
  /** Escort: only engage fighters that come near these planes. */
  escortOf?: () => Plane[];
  /** Escort: the bombers' calls of who is attacking them (attacker id → first and latest report). */
  alarm?: ReadonlyMap<number, { first: number; last: number }>;
  /** Hold fire / don't engage until released (wingmen before tally-ho). */
  holdFire?: boolean;
  /** Fuel fraction at which to go home. */
  bingo?: number;
  /** Prefer bombers as targets (RAF squadrons). */
  preferBombers?: boolean;
  /** Bf 110s: a shared defensive circle, formed when fighters threaten. */
  circle?: DefensiveCircle;
}

/** The 110s' Lufbery circle: each aircraft covers the tail of the one ahead. */
export interface DefensiveCircle {
  centre: Vec3 | null;
  radius: number;
  dir: 1 | -1;
  /** Last time any member saw an enemy fighter near. */
  lastThreat: number;
}

/**
 * Height (m) a pull-out from the present dive needs: first rolling the
 * wings level (upside down, that's most of a second and a half of falling),
 * then the turn at the G we can pull, with room for the speed it gathers.
 */
export function pullOutHeight(me: Plane): number {
  const fs = me.fs;
  const v = Math.max(1, fs.vel.len());
  const sink = Math.max(0, -fs.vel.y);
  const n = Math.max(2, Math.min(availableG(fs, 0.85), me.skill.gLimit));
  const r = (v * v * 1.25) / (9.81 * (n - 1));
  const sinDive = Math.min(1, sink / v);
  const A = TUNING.ai, k = clamp((fs.ias - A.recoveryRollIas[0]) / (A.recoveryRollIas[1] - A.recoveryRollIas[0]), 0, 1);
  const rate = A.recoveryRollRate[0] + (A.recoveryRollRate[1] - A.recoveryRollRate[0]) * k;
  const roll = (Math.abs(fs.roll) / rate) * sink;
  return roll + r * (1 - Math.sqrt(1 - sinDive * sinDive));
}

export class FighterBrain implements Brain {
  state: FighterState = 'patrol';
  stateT = 0;
  targetId = -1;
  threatId = -1;
  /** Angle (rad) between the nose and the lead point on the last attacking step. */
  aimErr = Math.PI;
  readonly contacts = new ContactMemory();
  private nextThink = 0;
  private nextSpot = 0;
  private aimJitter = new Vec3();
  private jitterT = 0;
  private turnDir: 1 | -1 = 1;
  private extendDir = new Vec3(0, 0, 1);

  constructor(public opts: FighterOpts = {}) {
    if (opts.leader) this.state = 'formation';
  }

  label(): string {
    return `${this.state}${this.targetId >= 0 ? '>' + this.targetId : ''}`;
  }

  private set(s: FighterState): void {
    if (s !== this.state) {
      this.state = s;
      this.stateT = 0;
    }
  }

  onHit(me: Plane, shooterId: number, ctx: AIContext): void {
    this.contacts.tell(shooterId, ctx.time);
    if (this.state !== 'bail' && this.state !== 'rtb' && this.state !== 'evade' && this.state !== 'bunt') {
      this.threatId = shooterId;
      this.decideEvasion(me, ctx);
    }
  }

  private find(ctx: AIContext, id: number): Plane | null {
    if (id < 0) return null;
    return ctx.planes.find((p) => p.id === id && p.alive) ?? null;
  }

  update(me: Plane, ctx: AIContext): void {
    this.stateT += ctx.dt;
    const c = me.ctl;
    me.trigger = false;
    if (!controllable(me.damage) || me.status !== 'flying') {
      // Out of control: the stick does nothing useful.
      c.pitch = 0.4; c.roll = 0.6; c.throttle = 0;
      return;
    }
    if (ctx.time >= this.nextSpot) {
      this.nextSpot = ctx.time + TUNING.ai.spotting.checkInterval;
      this.contacts.update(me, ctx, me.skill.spot, me.fatigue);
    }
    if (ctx.time >= this.nextThink) {
      this.nextThink = ctx.time + me.skill.think;
      this.think(me, ctx);
    }
    // Ground avoidance overrides everything. Fast and steep, a pull-out takes
    // a lot of height: start it while there's room for the turn it needs.
    const agl = me.pos.y - ctx.groundAt(me.pos.x, me.pos.z);
    if (me.fs.vel.y < -5 && agl < pullOutHeight(me) + TUNING.ai.groundAvoidAgl) {
      if (this.state !== 'bail') this.set('pullUp');
    }
    this.act(me, ctx);
  }

  /** Decisions, made every `skill.think` seconds. */
  private think(me: Plane, ctx: AIContext): void {
    const fs = me.fs;
    const d = me.damage;
    if (this.state === 'bail') return;
    // Damage and fuel.
    if (d.fire > 0 || (d.engines.every((e) => e <= 0) && me.side === 'lw') || d.pilot === 'killed') {
      this.set('bail');
      me.bailing = true;
      return;
    }
    if (d.engines.every((e) => e <= 0)) { this.set('glide'); return; }
    const bingo = this.opts.bingo ?? (me.type.id === 'bf109' ? TUNING.ai.bingoFuel109 : 0.2);
    const lowFuel = fs.fuel < me.type.fuelCapacity * bingo;
    const noAmmo = me.armament.frac < 0.04;
    const hurt = d.glycol > 0.3 || d.oil > 0.5 || d.pilot === 'wounded' || d.wingL + d.wingR > 0.6;
    if ((lowFuel || noAmmo || hurt) && this.state !== 'rtb') {
      if (this.state !== 'evade' && this.state !== 'bunt') { this.set('rtb'); this.targetId = -1; }
    }
    // Bf 110s under fighter attack form a defensive circle.
    const circ = this.opts.circle;
    if (circ && this.state !== 'rtb') {
      const near = this.contacts.ids().some((id) => { const t = this.find(ctx, id); return !!t && t.type.role === 'fighter' && t.pos.distTo(me.pos) < 4000; });
      if (near) {
        circ.lastThreat = ctx.time;
        if (!circ.centre) circ.centre = me.pos.clone().add(me.fs.right().scale(circ.radius * circ.dir));
        if (this.state !== 'circle') this.set('circle');
      }
      if (this.state === 'circle') {
        if (ctx.time - circ.lastThreat > 40) { circ.centre = null; this.set(this.opts.leader ? 'formation' : 'patrol'); }
        return;
      }
    }
    // Threats: a known enemy behind us and pointing at us.
    let threat: Plane | null = null, threatRange = Infinity;
    for (const id of this.contacts.ids()) {
      const t = this.find(ctx, id);
      if (!t || t.type.role === 'bomber') continue;
      const g = threatGeometry(t, me);
      if (g.range < TUNING.ai.threatRange && g.offTail < (TUNING.ai.threatTailDeg * Math.PI) / 180 && g.aimErr < (TUNING.ai.threatAimDeg * Math.PI) / 180 && g.range < threatRange) {
        threat = t; threatRange = g.range;
      }
    }
    if (threat && this.state !== 'evade' && this.state !== 'bunt' && this.state !== 'pullUp') {
      this.threatId = threat.id;
      this.decideEvasion(me, ctx);
      return;
    }
    if (this.state === 'evade' || this.state === 'bunt') {
      if (!threat && this.stateT > 2.5) {
        // Shaken off (or it overshot): turn the tables if we have the energy.
        const t = this.find(ctx, this.threatId);
        this.threatId = -1;
        if (t && me.skill.aggression > 0.4 && this.state === 'evade') { this.targetId = t.id; this.set('attack'); }
        else this.set(this.state === 'bunt' ? 'zoom' : 'extend');
      }
      return;
    }
    if (this.state === 'rtb' || this.state === 'glide') return;
    if (this.opts.holdFire) return;
    this.hearAlarm(me, ctx);
    // Targets.
    const tgt = this.find(ctx, this.targetId);
    if (!tgt || !this.contacts.knows(tgt.id)) this.targetId = this.pickTarget(me, ctx);
    if (this.targetId >= 0 && (this.state === 'patrol' || this.state === 'formation')) this.set('attack');
    if (this.targetId < 0 && (this.state === 'attack')) this.set(this.opts.leader ? 'formation' : 'patrol');
    // Energy discipline: don't let the fight drag us slow.
    if (this.state === 'attack' && me.skill.minSpeed > 0 && fs.ias < me.skill.minSpeed) {
      const t = this.find(ctx, this.targetId);
      const g = t ? threatGeometry(me, t) : null;
      if (!g || g.aimErr > 0.35 || g.range > 500) {
        this.extendDir = fs.forward().clone();
        this.extendDir.y = Math.min(this.extendDir.y, -0.15);
        this.set('extend');
      }
    }
    if (this.state === 'extend' && (this.stateT > TUNING.ai.extendSeconds || fs.ias > me.skill.minSpeed + 45)) {
      this.set(me.type.id === 'bf109' ? 'zoom' : 'attack');
    }
    if (this.state === 'zoom' && (this.stateT > TUNING.ai.zoomSeconds || fs.ias < me.skill.minSpeed + 15)) this.set('attack');
  }

  private decideEvasion(me: Plane, ctx: AIContext): void {
    const fs = me.fs;
    const t = this.find(ctx, this.threatId);
    const canBunt = me.type.fuelInjected && fs.pos.y > 1500 && fs.ias > 95 && me.skill.level !== 'green';
    const pursuerCarb = t ? !t.type.fuelInjected : false;
    if (canBunt && (pursuerCarb || ctx.rng.chance(0.4))) {
      this.set('bunt');
      return;
    }
    if (t) {
      const local = fs.q.unrotate(t.pos.clone().sub(fs.pos));
      this.turnDir = local.x >= 0 ? 1 : -1; // break towards the attacker
    }
    this.set('evade');
  }

  /** Escort: "bombers under attack!" puts the attacker in our picture, after a moment to react. */
  private hearAlarm(me: Plane, ctx: AIContext): void {
    const al = this.opts.alarm;
    if (!al) return;
    const A = TUNING.ai;
    const delay = A.escortReaction[me.skill.level] ?? 3.5;
    for (const [id, a] of al) {
      if (ctx.time - a.last > A.escortAlarmMemory || ctx.time - a.first < delay) continue;
      if (this.contacts.knows(id)) continue;
      const t = this.find(ctx, id);
      if (t && t.pos.distTo(me.pos) < A.escortAlarmRange) this.contacts.tell(id, ctx.time);
    }
  }

  private isAlarm(id: number, ctx: AIContext): boolean {
    const a = this.opts.alarm?.get(id);
    return !!a && ctx.time - a.last < TUNING.ai.escortAlarmMemory;
  }

  private pickTarget(me: Plane, ctx: AIContext): number {
    let best = -1, bestScore = Infinity;
    const escort = this.opts.escortOf?.() ?? null;
    for (const id of this.contacts.ids()) {
      const t = this.find(ctx, id);
      if (!t) continue;
      let d = t.pos.distTo(me.pos);
      if (escort) {
        // Escorts care about fighters near their charges.
        if (t.type.role === 'bomber') continue;
        const near = escort.some((b) => b.alive && b.pos.distTo(t.pos) < 3500);
        if (!near && d > 2500) continue;
      }
      if (this.opts.preferBombers && (t.type.role === 'bomber' || t.type.role === 'diveBomber')) d *= 0.5;
      // Escorts go first for whoever is shooting at the bombers.
      if (escort && this.isAlarm(id, ctx)) d *= 0.4;
      // Easier targets: those not looking at us.
      const g = threatGeometry(me, t);
      d *= 0.7 + 0.3 * (g.offTail / Math.PI);
      if (d < bestScore) { bestScore = d; best = id; }
    }
    return best;
  }

  private act(me: Plane, ctx: AIContext): void {
    const fs = me.fs;
    const c = me.ctl;
    const sk = me.skill;
    const gLim = Math.max(2.5, sk.gLimit - (me.pilot.grey > 0.5 ? 1.5 : 0) - (me.damage.pilot === 'wounded' ? 1 : 0));
    c.boost = false;
    c.yaw = 0;
    switch (this.state) {
      case 'pullUp': {
        // Aim a little above the horizon along our track: from any attitude,
        // inverted or vertical, that rolls the lift up and pulls.
        const dir = fs.vel.clone();
        dir.y = 0;
        if (dir.lenSq() < 1) { dir.copy(fs.forward()); dir.y = 0; }
        dir.normalize();
        dir.y = 0.25;
        flyDirection(fs, dir, c, Math.min(gLim + 0.5, 6));
        c.throttle = fs.vel.y < -60 ? 0.3 : 1;
        if (fs.vel.y > 2 && fs.pos.y - ctx.groundAt(fs.pos.x, fs.pos.z) > TUNING.ai.groundAvoidAgl) this.set(this.targetId >= 0 ? 'attack' : this.opts.leader ? 'formation' : 'patrol');
        break;
      }
      case 'formation': {
        const L = this.opts.leader;
        if (!L || !L.alive) { this.opts.leader = undefined; this.set('patrol'); break; }
        const slot = L.fs.q.rotate(this.opts.slot ?? new Vec3(-30, 0, -30)).add(L.pos);
        const ahead = slot.clone().addScaled(L.fs.vel, 1.5);
        flyTo(fs, ahead, c, 3);
        // Throttle: match the leader, plus close the along-track gap.
        const fwd = L.fs.forward();
        const gap = slot.clone().sub(fs.pos).dot(fwd);
        c.throttle = clamp(L.ctl.throttle + gap * 0.01 + (L.fs.tas - fs.tas) * 0.05, 0.2, 1);
        break;
      }
      case 'patrol': {
        const wp = this.opts.waypoint ?? ctx.home(me.side, me);
        const d = wp.clone().sub(fs.pos);
        const hdg = Math.atan2(d.x, d.z);
        headingAltitude(fs, hdg, wp.y, c, 10, 0.6);
        c.throttle = 0.8;
        break;
      }
      case 'attack': {
        const t = this.find(ctx, this.targetId);
        if (!t) { this.set('patrol'); break; }
        this.attack(me, t, ctx, gLim);
        break;
      }
      case 'extend': {
        flyDirection(fs, this.extendDir, c, 2.5);
        c.throttle = 1;
        c.boost = me.type.boostMul > 1.1 && fs.boostUsed < me.type.boostSeconds * 0.8;
        break;
      }
      case 'zoom': {
        const dir = fs.forward().clone();
        dir.y = 0.75;
        flyDirection(fs, dir, c, Math.min(gLim, 4));
        c.throttle = 1;
        break;
      }
      case 'evade': {
        maxLevelTurn(fs, this.turnDir, c, 0.93, gLim);
        c.throttle = 1;
        // Experienced pilots reverse when the attacker is about to overshoot.
        const t = this.find(ctx, this.threatId);
        if (t && sk.level === 'experte' && this.stateT > 2) {
          const local = fs.q.unrotate(t.pos.clone().sub(fs.pos));
          if (local.z > -50 && Math.abs(local.x) < 120) this.turnDir = local.x >= 0 ? 1 : -1;
        }
        break;
      }
      case 'bunt': {
        // Push over hard (negative G), then dive away at full power.
        if (this.stateT < TUNING.ai.buntSeconds) {
          c.roll = rollTo(fs, 0);
          c.pitch = -0.85;
        } else {
          const dir = fs.forward().clone();
          dir.y = -1.2;
          flyDirection(fs, dir, c, 3);
          if (fs.pos.y - ctx.groundAt(fs.pos.x, fs.pos.z) < 900) this.set('zoom');
        }
        c.throttle = 1;
        if (this.stateT > TUNING.ai.buntSeconds + TUNING.ai.diveSeconds) this.set('zoom');
        break;
      }
      case 'circle': {
        // Fly the circle: aim at a point a little ahead round it, hold height.
        const circ = this.opts.circle!;
        const c0 = circ.centre ?? fs.pos;
        const ang = Math.atan2(fs.pos.x - c0.x, fs.pos.z - c0.z) + circ.dir * 0.5;
        const tgt = new Vec3(c0.x + Math.sin(ang) * circ.radius, c0.y, c0.z + Math.cos(ang) * circ.radius);
        flyTo(fs, tgt, c, Math.min(gLim, 3.5));
        c.throttle = 0.9;
        // Snap shots at anything crossing the nose.
        for (const id of this.contacts.ids()) {
          const t = this.find(ctx, id);
          if (!t) continue;
          const g = threatGeometry(me, t);
          if (g.range < sk.fireRange && g.aimErr < 0.06) me.trigger = true;
        }
        break;
      }
      case 'rtb':
      case 'glide': {
        const home = ctx.home(me.side, me);
        const d = home.clone().sub(fs.pos);
        const hdg = Math.atan2(d.x, d.z);
        const alt = this.state === 'glide' ? fs.pos.y - 50 : Math.max(800, Math.min(fs.pos.y, 4000));
        headingAltitude(fs, hdg, alt, c, 6, 0.5);
        c.throttle = this.state === 'glide' ? 0 : 0.85;
        if (this.state === 'glide' && fs.ias < me.type.bestGlide) c.pitch = Math.min(c.pitch, stickForG(me.type, 0.9));
        break;
      }
      case 'bail': {
        c.pitch = 0; c.roll = rollTo(fs, 0); c.throttle = 0;
        break;
      }
    }
  }

  private attack(me: Plane, t: Plane, ctx: AIContext, gLim: number): void {
    const fs = me.fs;
    const c = me.ctl;
    const sk = me.skill;
    const muzzle = me.armament.guns[0]?.type.muzzle ?? 750;
    const range = t.pos.distTo(fs.pos);
    // Aim with a little skill-dependent wander.
    if (ctx.time >= this.jitterT) {
      this.jitterT = ctx.time + 0.8;
      const e = (1 - sk.aim) * 7 * (sk.wander ?? 1);
      this.aimJitter.set(ctx.rng.gauss() * e, ctx.rng.gauss() * e, ctx.rng.gauss() * e);
    }
    const lead = range < 1200 ? leadPoint(fs.pos, fs.vel, t.pos, t.fs.vel, muzzle).add(this.aimJitter) : t.pos.clone();
    const dir = lead.clone().sub(fs.pos);
    // Too close and closing fast: overshoot. Break off and come round again.
    const closure = -t.fs.vel.clone().sub(fs.vel).dot(dir.clone().normalize());
    if (range < 70 || (range < 150 && closure > 60)) {
      this.extendDir = fs.forward().clone().add(fs.right().scale(this.turnDir * 0.8));
      this.extendDir.y = me.type.id === 'bf109' ? 0.3 : -0.1;
      this.set('extend');
      return;
    }
    // Against another AI, pull hard for the lead: a gentle pull sits in lag
    // and the fight goes round for ever. Against the player it stays as playtested.
    const gain = (t.isPlayer ? 1 : TUNING.ai.attackGain) * (sk.aggression > 0.5 ? 1.2 : 1);
    const err = (this.aimErr = flyDirection(fs, dir, c, gLim, gain));
    // Don't hang on the edge of the stall unless green.
    if (sk.level !== 'green' && fs.buffet > 0.4) c.pitch = Math.min(c.pitch, stickForG(me.type, availableG(fs, 0.85)));
    c.throttle = range < 300 && closure > 35 && sk.level === 'experte' ? 0.55 : 1;
    // Fire inside range when the target's span roughly fills the lead tolerance.
    let tol = Math.atan((t.type.span * 0.5) / Math.max(range, 30)) * (sk.level === 'green' ? 2.2 : 1.2 - sk.aim * 0.3);
    // Against another AI, a pilot also takes the snap shot a turning fight
    // offers: holding the lead inside a wingspan almost never happens there.
    // Against the player it stays as playtested.
    if (!t.isPlayer) tol = Math.max(tol, (TUNING.ai.snapDeg[sk.level] * Math.PI) / 180);
    if (range < sk.fireRange && err < tol) me.trigger = true;
    // Boom and zoom: a disciplined 109 that's above won't hang about in a turning fight.
    if (me.type.id === 'bf109' && sk.aggression < 0.5 && this.stateT > 12 && err > 0.6) {
      this.extendDir = fs.forward().clone();
      this.extendDir.y = -0.3;
      this.set('extend');
    }
  }
}
