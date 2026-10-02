// Spotting: can one pilot see another? Range against the target's size,
// where it is relative to the observer (the blind spot behind and below),
// the sun (aircraft in the sun's glare are very hard to see — attacking out
// of the sun works), cloud in the way, and the observer's skill and fatigue.
// Used by every AI pilot to build its picture of the sky; the same rules
// keep the 109s honest when they come at the player out of the sun.

import { clamp, Vec3 } from '../../core/math';
import { TUNING } from '../../tuning';
import type { Plane } from '../plane';
import type { AIContext } from './types';

/** Probability that `obs` spots `tgt` on one check (checks happen every ~0.5 s). */
export function spotChance(obs: Plane, tgt: Plane, ctx: AIContext, skillSpot: number, fatigue = 0): number {
  const S = TUNING.ai.spotting;
  const d = obs.pos.distTo(tgt.pos);
  const size = tgt.type.span / 10;
  const r0 = S.baseRange * Math.sqrt(size) * skillSpot * (1 - fatigue * 0.3); // range at which spotting fades out
  if (d > r0) return 0;
  let p = 1 - (d / r0) ** 2;
  // Aspect: hard to see behind and below.
  const dir = tgt.pos.clone().sub(obs.pos).scale(1 / Math.max(d, 1));
  const local = obs.fs.q.unrotate(dir);
  if (local.z < -0.85) p *= S.rearFactor;
  else if (local.y < -0.6 && local.z > -0.2) p *= S.belowNoseFactor;
  // Sun glare: target near the sun's direction.
  const sunDot = dir.dot(ctx.sun);
  if (sunDot > Math.cos((TUNING.effects.sunDazzleConeDeg * Math.PI) / 180)) p *= S.sunFactor * (skillSpot > 1.2 ? 2 : 1);
  // Against the ground (target well below) it is harder than against the sky.
  if (dir.y < -0.25) p *= S.groundBackFactor;
  // Cloud in the way.
  if (!ctx.losClear(obs.pos, tgt.pos)) return 0;
  // Close in, almost certain whatever the aspect.
  if (d < S.certainRange) p = Math.max(p, 0.9);
  return clamp(p * S.perCheck, 0, 1);
}

export class ContactMemory {
  private seen = new Map<number, number>();

  /** Re-check every contact; returns ids currently known. */
  update(me: Plane, ctx: AIContext, skillSpot: number, fatigue = 0): void {
    for (const t of ctx.planes) {
      if (t === me || t.side === me.side || !t.alive) { this.seen.delete(t.id); continue; }
      const known = this.seen.has(t.id) && ctx.time - this.seen.get(t.id)! < TUNING.ai.spotting.memory;
      const p = spotChance(me, t, ctx, skillSpot * (known ? 1.6 : 1), fatigue);
      if (p > 0 && ctx.rng.next() < (known ? Math.min(1, p * 3) : p)) this.seen.set(t.id, ctx.time);
    }
    for (const [id, t] of this.seen) if (ctx.time - t > TUNING.ai.spotting.memory) this.seen.delete(id);
  }

  knows(id: number): boolean {
    return this.seen.has(id);
  }

  ids(): number[] {
    return [...this.seen.keys()];
  }

  /** Mark a contact as known (e.g. it just shot at us, or the leader called it). */
  tell(id: number, time: number): void {
    this.seen.set(id, time);
  }
}

/** Is `a` behind `b` and pointing at it (a threat to b)? Returns angle off b's tail and a's aim error. */
export function threatGeometry(attacker: Plane, victim: Plane): { range: number; offTail: number; aimErr: number } {
  const rel = attacker.pos.clone().sub(victim.pos);
  const range = rel.len();
  const vf = victim.fs.forward();
  const af = attacker.fs.forward();
  const offTail = Math.acos(clamp(-rel.dot(vf) / Math.max(range, 1), -1, 1));
  const aimErr = Math.acos(clamp(-rel.dot(af) / Math.max(range, 1), -1, 1));
  return { range, offTail, aimErr };
}

export function dirTo(a: Vec3, b: Vec3): Vec3 {
  return b.clone().sub(a).normalize();
}
