// An aircraft in the world: flight state, controls, pilot and (from M4)
// guns, damage and an AI brain.

import { AircraftType, Side } from '../content/aircraft';
import { FlightControls, FlightMods, FlightState, neutralMods } from './flight';
import { Physiology } from './physiology';
import { idleControls } from './ai/pilot';

export type PlaneStatus = 'flying' | 'landed' | 'crashed' | 'bailedOut' | 'ditched' | 'destroyed';

export class Plane {
  readonly fs: FlightState;
  mods: FlightMods;
  readonly ctl: FlightControls = idleControls(0.8);
  readonly pilot = new Physiology();
  status: PlaneStatus = 'flying';
  isPlayer = false;
  /** Hit flash timer (render only reads it). */
  flash = 0;
  flashParts = 0;
  /** Parts no longer attached (a wing that has come off). */
  hiddenParts = 0;
  /** Seconds since last fired (for sounds). */
  firing = false;

  constructor(
    readonly id: number,
    readonly type: AircraftType,
    readonly side: Side,
    public callsign: string,
    fuelFrac = 1,
  ) {
    this.fs = new FlightState(type, fuelFrac);
    this.mods = neutralMods(type.engines);
  }

  get alive(): boolean {
    return this.status === 'flying' || this.status === 'landed';
  }

  get pos() {
    return this.fs.pos;
  }
}
