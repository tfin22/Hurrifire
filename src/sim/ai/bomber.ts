// Bomber AI. The formation leader flies the raid's route; everyone else keeps
// station on him. Attacked, they close up. Over the target they hold
// straight and level for the bomb run. Damaged aircraft drop out, jettison
// their bombs and turn for France: an easy kill, but a turned-back raid is
// what actually matters.
//
// Crews also have nerve. Bursts of fire, fighters coming head-on through the
// formation and the bomber alongside going down all wear it away; it comes
// back slowly when they are left alone. When it runs out the crew jettison
// and turn for home, sound aircraft or not. Green crews break first; crews
// on the bomb run are committed and harder to shake.

import { clamp, Vec3 } from '../../core/math';
import { TUNING } from '../../tuning';
import { controllable, damageFraction } from '../damage';
import type { Plane } from '../plane';
import { flyTo, headingAltitude, rollTo, stickForG } from './pilot';
import type { AIContext, Brain } from './types';

export interface RaidLink {
  /** Current formation leader (may change if he goes down). */
  leader(): Plane | null;
  /** Route the leader flies. */
  route: Vec3[];
  speed: number;
  alt: number;
  target: Vec3;
  /** Called when a bomber releases its load. */
  release(p: Plane): void;
  /** Called when a bomber jettisons (turned back). */
  jettison(p: Plane): void;
  /** Time (s) a formation member was last attacked. */
  lastAttacked: number;
  /** "Bombers under attack": tells the escort who is shooting. */
  alarm?(attackerId: number, time: number): void;
  home: Vec3;
  phase: 'inbound' | 'bombRun' | 'outbound' | 'scattered';
  /** Dive bombers (Stukas) peel off and dive on the target. */
  dive?: boolean;
}

export type BomberState = 'formation' | 'lead' | 'bombRun' | 'dive' | 'outbound' | 'straggler' | 'bail';

export class BomberBrain implements Brain {
  state: BomberState = 'formation';
  leg = 1;
  /** Crew's nerve (NaN until first update, then set from skill). */
  nerve = NaN;
  /** Lost its nerve: jettisoned and running for home, aircraft sound. */
  broken = false;
  private divePhase = 0;
  private lastShaken = -100;
  private nextLook = 0;
  private lastHeadOn = -100;

  constructor(readonly raid: RaidLink, public slot: Vec3) {}

  label(): string {
    return this.broken ? 'broken' : this.state;
  }

  onHit(me: Plane, by: number, ctx: AIContext): void {
    this.raid.lastAttacked = ctx.time;
    this.raid.alarm?.(by, ctx.time);
    if (ctx.time - this.lastShaken >= TUNING.ai.nerveHitGap) this.shake(me, TUNING.ai.nerveHit, ctx.time);
  }

  /** Wear the crew's nerve down. */
  shake(me: Plane, amount: number, time: number): void {
    if (Number.isNaN(this.nerve)) this.nerve = TUNING.ai.bomberNerve[me.skill.level] ?? 1;
    this.nerve -= amount * (this.raid.phase === 'bombRun' ? TUNING.ai.bombRunNerve : 1);
    this.lastShaken = time;
  }

  /** Fighters coming at us head-on, guns going or very close: the most unnerving attack there is. One pass shakes once, however many come through. */
  private lookAhead(me: Plane, ctx: AIContext): void {
    const A = TUNING.ai;
    if (ctx.time - this.lastHeadOn < A.headOnGap) return;
    const fwd = me.fs.forward();
    const cosMax = Math.cos((A.headOnDeg * Math.PI) / 180);
    for (const q of ctx.planes) {
      if (q.side === me.side || !q.alive || q.type.role !== 'fighter') continue;
      const rel = q.pos.clone().sub(me.pos);
      const d = rel.len();
      if (d > A.headOnRange || d < 1) continue;
      if (rel.dot(fwd) / d < cosMax) continue;
      // Coming towards us, nose on, and shooting (or about to hit us).
      if (q.fs.forward().dot(fwd) > -0.7) continue;
      if (!q.firing && d > A.headOnClose) continue;
      this.lastHeadOn = ctx.time;
      this.shake(me, A.nerveHeadOn, ctx.time);
      return;
    }
  }

  update(me: Plane, ctx: AIContext): void {
    const c = me.ctl;
    me.trigger = false;
    c.boost = false;
    if (!controllable(me.damage) || me.damage.fire > 0 || me.damage.engines.every((e) => e <= 0)) {
      if (this.state !== 'bail') { this.state = 'bail'; me.bailing = true; }
      c.pitch = 0; c.roll = rollTo(me.fs, 0); c.throttle = 0;
      return;
    }
    // Nerve: looked at twice a second, recovered when left alone.
    const A = TUNING.ai;
    if (Number.isNaN(this.nerve)) this.nerve = A.bomberNerve[me.skill.level] ?? 1;
    if (ctx.time >= this.nextLook) {
      this.nextLook = ctx.time + 0.5;
      if (this.state !== 'straggler') this.lookAhead(me, ctx);
    }
    if (ctx.time - this.lastShaken > A.nerveCalm) this.nerve = Math.min(A.bomberNerve[me.skill.level] ?? 1, this.nerve + A.nerveRecovery * ctx.dt);
    // Badly hurt, an engine out, or the crew have had enough: drop out of formation and go home.
    const engineOut = me.damage.engines.some((e) => e <= 0);
    const hurt = engineOut || damageFraction(me.damage) > 0.32 || me.damage.pilot === 'wounded';
    if (this.state !== 'straggler' && (hurt || this.nerve <= 0)) {
      this.state = 'straggler';
      this.broken = !hurt;
      if (me.bombs > 0) this.raid.jettison(me);
    }
    const L = this.raid.leader();
    if (this.state === 'straggler' || this.raid.phase === 'scattered') {
      const d = this.raid.home.clone().sub(me.pos);
      // A shaken crew dive away for speed; a hurt one nurses it home.
      headingAltitude(me.fs, Math.atan2(d.x, d.z), Math.max(500, me.pos.y - (this.broken ? 800 : 300)), c, this.broken ? 6 : 4, 0.4);
      c.throttle = engineOut || this.broken ? 1 : 0.85;
      return;
    }
    if (L === me) this.lead(me, ctx);
    else if (L) this.follow(me, L, ctx);
  }

  /** The leader flies the route; at the target he holds steady and releases. */
  private lead(me: Plane, ctx: AIContext): void {
    const r = this.raid;
    const fs = me.fs;
    const c = me.ctl;
    this.state = r.phase === 'bombRun' ? 'bombRun' : r.phase === 'outbound' ? 'outbound' : 'lead';
    if (r.dive && r.phase === 'bombRun') { this.diveBomb(me, ctx); return; }
    const wp = r.route[Math.min(this.leg, r.route.length - 1)];
    const d = wp.clone().sub(fs.pos);
    const hd = Math.hypot(d.x, d.z);
    if (hd < 1500 && this.leg < r.route.length - 1) this.leg++;
    const hdg = Math.atan2(d.x, d.z);
    // Gentle turns: bomber formations don't manoeuvre hard.
    headingAltitude(fs, hdg, r.alt, c, 3, r.phase === 'bombRun' ? 0.15 : 0.35);
    c.throttle = clamp(0.7 + (r.speed - fs.tas) * 0.05, 0.4, 1);
    // Bomb release: ahead of the target by the bombs' forward throw.
    if (r.phase === 'bombRun' && me.bombs > 0) {
      const fall = Math.sqrt((2 * Math.max(10, fs.pos.y - r.target.y)) / 9.81);
      const throwDist = fs.tas * fall;
      const t = r.target.clone().sub(fs.pos);
      const along = t.x * Math.sin(fs.heading) + t.z * Math.cos(fs.heading);
      const cross = Math.abs(t.x * Math.cos(fs.heading) - t.z * Math.sin(fs.heading));
      if (along < throwDist && along > throwDist - 600 && cross < 800) r.release(me);
    }
  }

  /** Stuka attack: peel off, steep dive, release low, pull out (vulnerable here). */
  private diveBomb(me: Plane, _ctx: AIContext): void {
    const fs = me.fs, c = me.ctl, r = this.raid;
    const t = r.target.clone().sub(fs.pos);
    const hd = Math.hypot(t.x, t.z);
    if (this.divePhase === 0) {
      // Approach until nearly overhead.
      headingAltitude(fs, Math.atan2(t.x, t.z), r.alt, c, 3, 0.4);
      c.throttle = 0.8;
      if (hd < fs.pos.y * 0.6) this.divePhase = 1;
    } else if (this.divePhase === 1) {
      // Dive (dive brakes simulated by low throttle).
      const dir = t.clone().normalize();
      flyTo(fs, r.target.clone(), c, 4);
      c.throttle = 0.1;
      c.airbrake = true;
      if (fs.pos.y - r.target.y < 900 || dir.y > -0.3 && hd < 300) {
        if (me.bombs > 0) r.release(me);
        this.divePhase = 2;
        c.airbrake = false;
      }
    } else {
      // Pull out low and slow, then run for home.
      c.roll = rollTo(fs, 0);
      c.pitch = stickForG(me.type, fs.vel.y < 0 ? 4 : 1.2);
      c.throttle = 1;
      if (fs.vel.y > 0) {
        const d = r.home.clone().sub(fs.pos);
        headingAltitude(fs, Math.atan2(d.x, d.z), 300, c, 4, 0.5);
      }
    }
  }

  /** Keep station on the leader; tighter when under attack. */
  private follow(me: Plane, L: Plane, ctx: AIContext): void {
    const fs = me.fs, c = me.ctl, r = this.raid;
    this.state = r.phase === 'outbound' ? 'outbound' : 'formation';
    const tight = ctx.time - r.lastAttacked < 25 ? 0.7 : 1;
    const slot = L.fs.q.rotate(this.slot.clone().scale(tight)).add(L.pos);
    const ahead = slot.clone().addScaled(L.fs.vel, 2);
    flyTo(fs, ahead, c, 2.2);
    const fwd = L.fs.forward();
    const gap = slot.clone().sub(fs.pos).dot(fwd);
    c.throttle = clamp(L.ctl.throttle + gap * 0.008 + (L.fs.tas - fs.tas) * 0.05, 0.25, 1);
    // Followers drop when the leader drops (the "bomb on the leader" method).
    if (r.phase === 'bombRun' && me.bombs > 0 && L.bombs === 0) r.release(me);
  }
}
