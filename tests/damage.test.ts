import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { AIRCRAFT, AircraftId, ZoneId } from '../src/content/aircraft';
import { applyHit, controllable, fireTimeLeft, flightMods, newDamage, tickDamage } from '../src/sim/damage';

/** Rounds (random zones, weighted by zone size) until the aircraft can no longer fly or its engine dies. */
function roundsToKill(id: AircraftId, seed: number): number {
  const t = AIRCRAFT[id];
  const d = newDamage(t);
  const rng = new Rng(seed);
  const weights = t.zones.map((z) => z.r * z.r);
  const total = weights.reduce((a, b) => a + b, 0);
  for (let n = 1; n < 2000; n++) {
    let r = rng.next() * total, i = 0;
    while (r > weights[i]) r -= weights[i++];
    applyHit(d, t, t.zones[i].id, 1, false, 9, rng);
    for (let k = 0; k < 5; k++) tickDamage(d, 120, 0.02, rng);
    if (!controllable(d) || d.engines.every((e) => e <= 0) || d.fire > 0 || d.glycol >= 0.7) return n;
  }
  return 2000;
}

describe('damage model', () => {
  it('the Hurricane survives more hits than the Spitfire', () => {
    let spit = 0, hurri = 0;
    for (let s = 1; s <= 60; s++) { spit += roundsToKill('spitfire', s); hurri += roundsToKill('hurricane', s); }
    expect(hurri).toBeGreaterThan(spit * 1.15);
  });

  it('bombers absorb more than fighters', () => {
    let f = 0, b = 0;
    for (let s = 1; s <= 40; s++) { f += roundsToKill('bf109', s); b += roundsToKill('he111', s); }
    expect(b).toBeGreaterThan(f);
  });

  it('enough hits on a wing take it off', () => {
    const t = AIRCRAFT.bf109;
    const d = newDamage(t);
    const rng = new Rng(1);
    const ev: string[] = [];
    for (let i = 0; i < 60 && d.wingOff === 'none'; i++) ev.push(...applyHit(d, t, 'wingL', 1, false, 1, rng));
    expect(d.wingOff).toBe('L');
    expect(ev).toContain('wingOffL');
    expect(controllable(d)).toBe(false);
    expect(flightMods(d, t).rollBias).toBeLessThan(-1);
  });

  it('20 mm shells do more than rifle-calibre rounds', () => {
    const t = AIRCRAFT.spitfire;
    const a = newDamage(t), b = newDamage(t);
    applyHit(a, t, 'fuselage', 7, true, 1, new Rng(1));
    applyHit(b, t, 'fuselage', 1, false, 1, new Rng(1));
    expect(a.hp.fuselage!).toBeLessThan(b.hp.fuselage!);
  });

  it('radiator hits leak glycol, which cuts cooling', () => {
    const t = AIRCRAFT.spitfire;
    const d = newDamage(t);
    const rng = new Rng(5);
    for (let i = 0; i < 20 && d.glycol === 0; i++) applyHit(d, t, 'radiator', 1, false, 1, rng);
    expect(d.glycol).toBeGreaterThan(0);
    expect(flightMods(d, t).coolant).toBeLessThan(1);
  });

  it('fire spreads to an explosion unless put out, with a countdown', () => {
    const t = AIRCRAFT.bf109;
    const d = newDamage(t);
    d.fire = 0.05;
    const left = fireTimeLeft(d);
    expect(left).toBeGreaterThan(15);
    expect(left).toBeLessThan(60);
    const rng = new Rng(2);
    let tt = 0;
    while (!d.exploded && tt < 120) { tickDamage(d, 60, 0.02, rng); tt += 0.02; }
    expect(d.exploded).toBe(true);
    expect(Math.abs(tt - left)).toBeLessThan(2);
  });

  it('control damage makes response sluggish or biased', () => {
    const t = AIRCRAFT.spitfire;
    const d = newDamage(t);
    const rng = new Rng(8);
    for (let i = 0; i < 5; i++) applyHit(d, t, 'elevator' as ZoneId, 1, false, 1, rng);
    const m = flightMods(d, t);
    expect(m.elevator).toBeLessThan(1);
  });

  it('records who did the damage', () => {
    const t = AIRCRAFT.he111;
    const d = newDamage(t);
    const rng = new Rng(3);
    applyHit(d, t, 'fuselage', 3, false, 7, rng);
    applyHit(d, t, 'fuselage', 1, false, 8, rng);
    expect(d.by[7]).toBe(3);
    expect(d.by[8]).toBe(1);
  });

  it('is deterministic for the same rng', () => {
    expect(roundsToKill('spitfire', 42)).toBe(roundsToKill('spitfire', 42));
  });
});
