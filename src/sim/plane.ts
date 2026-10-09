// An aircraft in the world: flight state, controls, pilot, guns, damage and
// (for everyone but the player) an AI brain.

import { AircraftType, Side } from '../content/aircraft';
import { FlightControls, FlightMods, FlightState, neutralMods } from './flight';
import { Physiology } from './physiology';
import { idleControls } from './ai/pilot';
import { Armament, GunnerState } from './guns';
import { DamageState, newDamage } from './damage';
import type { Brain, Skill } from './ai/types';
import { skillFor } from './ai/types';
import { Vec3 } from '../core/math';
import type { TouchdownResult } from './landing';
import type { FieldRect } from './ground';

export interface LandingRecord {
  bounces: number;
  /** Worst result so far on this landing. */
  result: TouchdownResult | null;
  /** Every contact, for the debug readout. */
  contacts: { sink: number; speed: number; bank: number; pitch: number; drift: number; surface: string; kind: string }[];
  field: FieldRect | null;
  /** Where it ended up (for the logbook). */
  at: Vec3 | null;
}

export type PlaneStatus =
  | 'flying'    // under control (in the air or on the ground)
  | 'wreck'     // falling out of control
  | 'landed'    // down and stopped safely (or forced-landed)
  | 'crashed'   // hit the ground as a wreck
  | 'ditched'
  | 'destroyed'; // blew up in the air

export class Plane {
  readonly fs: FlightState;
  mods: FlightMods;
  readonly ctl: FlightControls = idleControls(0.8);
  readonly pilot = new Physiology();
  status: PlaneStatus = 'flying';
  isPlayer = false;
  /** Pilot's trigger this tick. */
  trigger = false;
  armament: Armament;
  gunners: GunnerState[];
  damage: DamageState;
  brain: Brain | null = null;
  skill: Skill;
  /** Enemy difficulty applied to this pilot's skill (once, on its first step). */
  rated = false;
  /** Fatigue 0..1 (campaign): slows spotting and lowers G tolerance. */
  fatigue = 0;
  /** Crew still aboard. */
  crewAboard: number;
  /** Crew have decided to bail; jumps happen one by one. */
  bailing = false;
  bailTimer = 0;
  /** Hit flash timer (render only reads it). */
  flash = 0;
  flashParts = 0;
  /** Parts no longer attached (a wing that has come off). */
  hiddenParts = 0;
  firing = false;
  /** Position last tick (for bullet hit tests in the plane's frame). */
  readonly prevPos = new Vec3();
  /** When it went down, and was it seen to crash by its enemies. */
  downAt = -1;
  seenCrash = false;
  /** Formation / unit bookkeeping. */
  unit = '';
  /** Where this aircraft goes home to, if not its side's usual home (another squadron's base). */
  home?: Vec3;
  /** Who shot it down (most damage). */
  killedBy = -1;
  /** Bombs still aboard (bombers). */
  bombs: number;
  /** Smoke emission accumulator. */
  smokeAcc = 0;
  pumpPhase = 0;
  /** Damage state the current flight mods were computed for. */
  modsVersion = -1;
  landing: LandingRecord = { bounces: 0, result: null, contacts: [], field: null, at: null };

  constructor(
    readonly id: number,
    readonly type: AircraftType,
    readonly side: Side,
    public callsign: string,
    fuelFrac = 1,
    convergenceM = 274,
  ) {
    this.fs = new FlightState(type, fuelFrac);
    this.mods = neutralMods(type.engines);
    this.armament = new Armament(type, convergenceM);
    this.gunners = type.gunners.map((g) => new GunnerState(g));
    this.damage = newDamage(type);
    this.skill = skillFor('average');
    this.crewAboard = type.crew;
    this.bombs = type.bombLoad;
  }

  /** In the fight: flying under control. */
  get alive(): boolean {
    return this.status === 'flying';
  }

  /** Still a physical object in the sky (includes falling wrecks). */
  get airborneObject(): boolean {
    return this.status === 'flying' || this.status === 'wreck';
  }

  get pos() {
    return this.fs.pos;
  }
}
