import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { assessClaims, confirmClaim, Engagement, pilotClaim, tally } from '../src/sim/claims';

const e = (o: Partial<Engagement> = {}): Engagement => ({
  enemyId: 1, type: 'Bf 109', damageDone: 0.5, wentDown: true, downAt: 'england', seenCrash: true,
  crewBaledOut: false, lastSeen: 'goingDown', credited: true, ...o,
});

describe('claims confirmation', () => {
  it('a 109 seen to crash in Kent is confirmed destroyed', () => {
    const c = confirmClaim(e(), 'destroyed');
    expect(c.allowed).toBe('destroyed');
  });

  it('one that went into the Channel with nobody watching is downgraded to probable', () => {
    const c = confirmClaim(e({ downAt: 'sea', seenCrash: false }), 'destroyed');
    expect(c.allowed).toBe('probable');
    expect(c.note).toBe('downgraded');
  });

  it('a parachute seen counts as evidence', () => {
    expect(confirmClaim(e({ downAt: 'sea', seenCrash: false, crewBaledOut: true }), 'destroyed').allowed).toBe('destroyed');
  });

  it('a damaged claim stays damaged', () => {
    expect(confirmClaim(e({ wentDown: false, lastSeen: 'hit' }), 'damaged').allowed).toBe('damaged');
  });

  it('over-claiming happens: a smoking 109 that got home is often claimed destroyed', () => {
    const rng = new Rng(4);
    let claimedDestroyed = 0;
    for (let i = 0; i < 200; i++) {
      const c = pilotClaim(e({ wentDown: false, downAt: null, seenCrash: false, lastSeen: 'smoking', damageDone: 0.5, credited: false }), rng);
      if (c === 'destroyed') claimedDestroyed++;
    }
    expect(claimedDestroyed).toBeGreaterThan(80);
    expect(claimedDestroyed).toBeLessThan(160);
    // ...but intelligence only allows it as a probable without evidence.
    const verdict = confirmClaim(e({ wentDown: false, downAt: null, seenCrash: false, lastSeen: 'smoking' }), 'destroyed');
    expect(verdict.allowed).toBe('probable');
    expect(verdict.actual).toBe('damaged');
  });

  it('no hits, no claim; tallies add up', () => {
    const rng = new Rng(1);
    const cs = assessClaims([e(), e({ enemyId: 2, damageDone: 0 }), e({ enemyId: 3, wentDown: false, lastSeen: 'hit', downAt: null })], rng);
    expect(cs.length).toBe(2);
    expect(tally(cs)).toEqual({ destroyed: 1, probable: 0, damaged: 1 });
  });
});
