// Zone-based damage for every aircraft.
//
// A hit lands in a zone (engine, radiator, oil, fuel, controls, wings,
// fuselage, tail, pilot/crew, gear, flaps), knocks off hit points scaled by
// the type's robustness, and may start an effect: glycol leak (white smoke,
// rising temperature, eventual seizure), oil leak (black smoke, oil on the
// windscreen), fire (a countdown; it spreads), control damage (sluggish or
// biased response), structural failure (a wing or the tail comes off), a
// wounded or killed pilot, gear or flap damage.
//
// applyHit is pure apart from the state it is given and the rng; the flight
// model reads the result through flightMods().

import { Rng } from '../core/rng';
import { AircraftType, ZoneId } from '../content/aircraft';
import { TUNING } from '../tuning';
import { FlightMods, neutralMods } from './flight';

export type PilotHealth = 'ok' | 'wounded' | 'killed';

export type DamageEvent =
  | 'hit' | 'glycolLeak' | 'oilLeak' | 'fire' | 'fireOut' | 'explode' | 'engineDead'
  | 'pilotWounded' | 'pilotKilled' | 'crewHit' | 'wingOffL' | 'wingOffR' | 'tailOff'
  | 'controls' | 'gearDamaged' | 'flapsDamaged' | 'fuelLeak';

export interface DamageState {
  hp: Partial<Record<ZoneId, number>>;
  maxHp: Partial<Record<ZoneId, number>>;
  /** 0..1 severities. */
  glycol: number;
  oil: number;
  /** 0 = no fire; grows to 1 then the tank goes up. */
  fire: number;
  fuelLeak: number;
  aileron: number;
  elevator: number;
  rudder: number;
  aileronBias: number;
  elevatorBias: number;
  rudderBias: number;
  airframe: number;
  wingL: number;
  wingR: number;
  wingOff: 'none' | 'L' | 'R';
  tailOff: boolean;
  /** Per-engine health 0..1. */
  engines: number[];
  pilot: PilotHealth;
  crewHit: number;
  gear: 'ok' | 'one' | 'none';
  flaps: boolean;
  exploded: boolean;
  hits: number;
  /** Damage dealt by each shooter id (for kill credit). */
  by: Record<number, number>;
  lastHitBy: number;
}

export function newDamage(t: AircraftType): DamageState {
  const hp: Partial<Record<ZoneId, number>> = {};
  for (const z of t.zones) hp[z.id] = z.hp * t.robust;
  return {
    hp, maxHp: { ...hp },
    glycol: 0, oil: 0, fire: 0, fuelLeak: 0,
    aileron: 0, elevator: 0, rudder: 0, aileronBias: 0, elevatorBias: 0, rudderBias: 0,
    airframe: 0, wingL: 0, wingR: 0, wingOff: 'none', tailOff: false,
    engines: new Array(t.engines).fill(1),
    pilot: 'ok', crewHit: 0, gear: 'ok', flaps: true, exploded: false, hits: 0, by: {}, lastHitBy: -1,
  };
}

const OVERFLOW: Partial<Record<ZoneId, ZoneId>> = {
  elevator: 'tail', rudder: 'tail', aileron: 'wingR', flaps: 'wingL', gear: 'wingL',
  radiator: 'engine', oil: 'engine', pilot: 'fuselage', crew: 'fuselage',
};

const frac = (d: DamageState, z: ZoneId) => {
  const m = d.maxHp[z];
  return m ? Math.max(0, (d.hp[z] ?? 0) / m) : 1;
};

/** Is the aircraft still something a pilot can fly? */
export function controllable(d: DamageState): boolean {
  return d.wingOff === 'none' && !d.tailOff && !d.exploded && d.pilot !== 'killed';
}

/**
 * Apply one hit to a zone. `dmg` is in .303-round units; explosive rounds
 * (20 mm) are far more likely to start fires and tear structure.
 */
export function applyHit(d: DamageState, _t: AircraftType, zone: ZoneId, dmg: number, explosive: boolean, shooter: number, rng: Rng): DamageEvent[] {
  const T = TUNING.damage;
  const ev: DamageEvent[] = ['hit'];
  // A part already shot away passes further hits to the structure behind it.
  if ((d.hp[zone] ?? 1) <= 0 && OVERFLOW[zone] && d.hp[OVERFLOW[zone]!] !== undefined) zone = OVERFLOW[zone]!;
  d.hits++;
  d.by[shooter] = (d.by[shooter] ?? 0) + dmg;
  d.lastHitBy = shooter;
  const before = d.hp[zone] ?? 0;
  const k = explosive ? 1.6 : 1;
  d.hp[zone] = before - dmg * k;
  const p = (base: number) => Math.min(0.95, base * dmg * (explosive ? T.pFireExplosiveMul * 0.5 + 0.5 : 1));
  const engIdx = zone === 'engineR' ? 1 : 0;
  switch (zone) {
    case 'engine':
    case 'engineL':
    case 'engineR': {
      if (rng.chance(p(T.pGlycolEngine)) && d.glycol < 1) { if (d.glycol === 0) ev.push('glycolLeak'); d.glycol = Math.min(1, d.glycol + 0.35); }
      if (rng.chance(p(T.pOilEngine)) && d.oil < 1) { if (d.oil === 0) ev.push('oilLeak'); d.oil = Math.min(1, d.oil + 0.3); }
      d.engines[engIdx] = Math.max(0, frac(d, zone));
      if (d.engines[engIdx] <= 0 && before > 0) {
        ev.push('engineDead');
        if (rng.chance(explosive ? 0.45 : 0.15) && d.fire === 0) { d.fire = 0.05; ev.push('fire'); }
      }
      if (explosive && rng.chance(0.08) && d.fire === 0) { d.fire = 0.05; ev.push('fire'); }
      break;
    }
    case 'radiator':
      if (rng.chance(p(T.pGlycolRadiator))) { if (d.glycol === 0) ev.push('glycolLeak'); d.glycol = Math.min(1, d.glycol + 0.45); }
      break;
    case 'oil':
      if (rng.chance(p(T.pOilCooler))) { if (d.oil === 0) ev.push('oilLeak'); d.oil = Math.min(1, d.oil + 0.4); }
      break;
    case 'fuel':
    case 'fuelL':
    case 'fuelR':
      if (rng.chance(p(T.pFireFuel)) && d.fire === 0) { d.fire = 0.05; ev.push('fire'); }
      else if (rng.chance(0.3)) { if (d.fuelLeak === 0) ev.push('fuelLeak'); d.fuelLeak = Math.min(1, d.fuelLeak + 0.2); }
      break;
    case 'pilot':
      if (d.pilot !== 'killed') {
        if ((d.hp.pilot ?? 0) <= 0 || rng.chance(p(T.pKillPilot))) { d.pilot = 'killed'; ev.push('pilotKilled'); }
        else if (d.pilot === 'ok' && rng.chance(p(T.pWound))) { d.pilot = 'wounded'; ev.push('pilotWounded'); }
      }
      break;
    case 'crew':
      if (rng.chance(0.4)) { d.crewHit++; ev.push('crewHit'); }
      break;
    case 'aileron':
      d.aileron = Math.min(0.9, d.aileron + dmg * T.controlDamagePerPoint);
      if (rng.chance(0.3)) d.aileronBias += rng.signed() * 0.15;
      ev.push('controls');
      break;
    case 'elevator':
      d.elevator = Math.min(0.85, d.elevator + dmg * T.controlDamagePerPoint);
      if (rng.chance(0.35)) d.elevatorBias = Math.max(-0.35, Math.min(0.35, d.elevatorBias + rng.signed() * 0.12));
      ev.push('controls');
      break;
    case 'rudder':
      d.rudder = Math.min(0.9, d.rudder + dmg * T.controlDamagePerPoint);
      if (rng.chance(0.3)) d.rudderBias += rng.signed() * 0.05;
      ev.push('controls');
      break;
    case 'wingL':
    case 'wingR': {
      const f = frac(d, zone);
      if (zone === 'wingL') d.wingL = 1 - f; else d.wingR = 1 - f;
      if (f <= 0 && d.wingOff === 'none') {
        d.wingOff = zone === 'wingL' ? 'L' : 'R';
        ev.push(zone === 'wingL' ? 'wingOffL' : 'wingOffR');
      }
      if (explosive && rng.chance(0.05) && d.fire === 0) { d.fire = 0.05; ev.push('fire'); }
      break;
    }
    case 'fuselage':
      d.airframe = 1 - frac(d, 'fuselage');
      if (d.airframe >= 1 && !d.tailOff) { d.tailOff = true; ev.push('tailOff'); }
      break;
    case 'tail':
      if (frac(d, 'tail') <= 0 && !d.tailOff) { d.tailOff = true; ev.push('tailOff'); }
      break;
    case 'gear':
      if (rng.chance(p(T.pGearDamage)) && d.gear !== 'none') { d.gear = d.gear === 'ok' && rng.chance(0.6) ? 'one' : 'none'; ev.push('gearDamaged'); }
      break;
    case 'flaps':
      if (rng.chance(p(T.pFlapsDamage)) && d.flaps) { d.flaps = false; ev.push('flapsDamaged'); }
      break;
  }
  // Explosive rounds also shake the whole airframe.
  if (explosive) d.airframe = Math.min(1, d.airframe + 0.04);
  return ev;
}

/** Per-step evolution: fires spread or blow out, leaks worsen. */
export function tickDamage(d: DamageState, speed: number, dt: number, rng: Rng): DamageEvent[] {
  const T = TUNING.damage;
  const ev: DamageEvent[] = [];
  if (d.fire > 0 && !d.exploded) {
    if (speed > T.fireBlowOutSpeed && rng.chance(T.fireBlowOut * dt * (speed / T.fireBlowOutSpeed))) {
      d.fire = 0;
      ev.push('fireOut');
    } else {
      d.fire += T.fireSpread * dt * (0.6 + d.fire);
      if (d.fire >= 1) { d.exploded = true; ev.push('explode'); }
    }
  }
  if (d.oil > 0) d.oil = Math.min(1, d.oil + T.oilPerSec * dt * d.oil);
  return ev;
}

/** Seconds of fire left before the tank goes up (for the bail-out countdown). */
export function fireTimeLeft(d: DamageState): number {
  if (d.fire <= 0) return Infinity;
  // Integrate df/dt = k (0.6 + f) from f to 1.
  const k = TUNING.damage.fireSpread;
  return Math.log((0.6 + 1) / (0.6 + d.fire)) / k;
}

/** How the damage changes the handling. */
export function flightMods(d: DamageState, t: AircraftType): FlightMods {
  const m = neutralMods(t.engines);
  m.aileron = 1 - d.aileron * 0.8;
  m.aileronBias = d.aileronBias;
  m.elevator = 1 - d.elevator * 0.75;
  m.elevatorBias = d.elevatorBias;
  m.rudder = 1 - d.rudder * 0.8;
  m.rudderBias = d.rudderBias;
  m.extraDrag = d.airframe * 0.02 + (d.wingL + d.wingR) * 0.012 + (d.gear !== 'ok' ? 0.004 : 0);
  m.liftMul = 1 - (d.wingL + d.wingR) * 0.12;
  m.rollBias = (d.wingL - d.wingR) * 0.25;
  m.power = d.engines.map((e) => (e <= 0 ? 0 : 0.35 + 0.65 * e));
  m.coolant = Math.max(0.03, 1 - d.glycol * TUNING.damage.glycolCooling);
  m.flapsWork = d.flaps;
  m.gearFault = d.gear;
  m.pilot = d.pilot === 'wounded' ? 0.55 : 1;
  if (d.wingOff !== 'none') {
    m.liftMul = 0.45;
    m.rollBias = d.wingOff === 'L' ? -3 : 3;
    m.extraDrag += 0.05;
  }
  if (d.tailOff) {
    m.elevator = 0;
    m.elevatorBias = 0.8;
    m.rudder = 0;
  }
  return m;
}

/** Total damage taken as a fraction of all hit points (0..1). */
export function damageFraction(d: DamageState): number {
  let have = 0, max = 0;
  for (const k of Object.keys(d.maxHp) as ZoneId[]) {
    max += d.maxHp[k] ?? 0;
    have += Math.max(0, d.hp[k] ?? 0);
  }
  return max ? 1 - have / max : 0;
}
