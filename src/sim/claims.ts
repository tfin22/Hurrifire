// Combat claims and their confirmation. What the pilot claims comes from what
// they saw; what intelligence confirms comes from the evidence (did anyone
// see it crash? is there a wreck in England?). Over-claiming was historical
// and happens to everyone: a 109 trailing smoke and diving away "must have
// gone in", even when it limped home to Calais.

import { Rng } from '../core/rng';
import { TUNING } from '../tuning';

export type ClaimLevel = 'destroyed' | 'probable' | 'damaged';

export interface Engagement {
  enemyId: number;
  type: string;
  /** Damage this pilot did, as a fraction of the target's hit points. */
  damageDone: number;
  /** Did it actually go down (wreck, crashed, ditched, exploded)? */
  wentDown: boolean;
  /** Where it came down. */
  downAt: 'england' | 'sea' | 'france' | 'air' | null;
  /** Was it seen to crash (by anyone friendly)? */
  seenCrash: boolean;
  /** Its crew baled out (parachutes seen). */
  crewBaledOut: boolean;
  /** The last the pilot saw of it. */
  lastSeen: 'goingDown' | 'smoking' | 'hit' | 'escaped';
  /** Did this pilot do the most damage (credited kill)? */
  credited: boolean;
}

export interface Claim {
  enemyId: number;
  type: string;
  claimed: ClaimLevel;
  /** What intelligence allows. */
  allowed: ClaimLevel | 'none';
  /** The truth (for the campaign's own records). */
  actual: 'destroyed' | 'damaged' | 'unhurt';
  note: 'confirmed' | 'downgraded' | 'overclaim' | 'damaged' | 'wreck';
}

/** What the pilot claims from what they saw. */
export function pilotClaim(e: Engagement, rng: Rng): ClaimLevel | null {
  if (e.damageDone <= 0) return null;
  if (e.lastSeen === 'goingDown' || (e.wentDown && e.credited)) return 'destroyed';
  if (e.lastSeen === 'smoking' && e.damageDone > TUNING.claims.heavyDamage) {
    return rng.chance(TUNING.claims.overclaimSmoking) ? 'destroyed' : 'probable';
  }
  if (e.lastSeen === 'smoking') return 'probable';
  return 'damaged';
}

/** Intelligence officer's verdict on a claim. */
export function confirmClaim(e: Engagement, claimed: ClaimLevel): Claim {
  const actual: Claim['actual'] = e.wentDown ? 'destroyed' : e.damageDone > 0 ? 'damaged' : 'unhurt';
  const base = { enemyId: e.enemyId, type: e.type, claimed, actual };
  if (claimed === 'damaged') return { ...base, allowed: 'damaged', note: 'damaged' };
  if (claimed === 'probable') return { ...base, allowed: 'probable', note: 'downgraded' };
  // Claimed destroyed.
  if (e.wentDown && (e.downAt === 'england' || e.downAt === 'air')) return { ...base, allowed: 'destroyed', note: 'wreck' };
  if (e.seenCrash || e.crewBaledOut) return { ...base, allowed: 'destroyed', note: 'confirmed' };
  if (e.wentDown) return { ...base, allowed: 'probable', note: 'downgraded' };
  // It didn't go down at all, but with no evidence either way the claim
  // stands as a probable — and sometimes, historically, as destroyed.
  return { ...base, allowed: 'probable', note: 'overclaim' };
}

export function assessClaims(es: Engagement[], rng: Rng): Claim[] {
  const out: Claim[] = [];
  for (const e of es) {
    const c = pilotClaim(e, rng);
    if (c) out.push(confirmClaim(e, c));
  }
  return out;
}

export function tally(claims: Claim[]): { destroyed: number; probable: number; damaged: number } {
  const t = { destroyed: 0, probable: 0, damaged: 0 };
  for (const c of claims) if (c.allowed !== 'none') t[c.allowed]++;
  return t;
}
