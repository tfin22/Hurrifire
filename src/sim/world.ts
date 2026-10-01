// The deterministic simulation world: every aircraft, bullet, parachute and
// smoke puff, stepped at 50 Hz from a seeded RNG and the player's recorded
// controls. Rendering only reads it.

import { Vec3 } from '../core/math';
import { Rng } from '../core/rng';
import { AIRCRAFT, AircraftId, Side } from '../content/aircraft';
import { ControlFrame } from '../input/input';
import { TUNING } from '../tuning';
import { FlightEnv, GroundResponse, stepFlight, TouchdownInfo } from './flight';
import { GroundModel, SURFACE_FRICTION } from './ground';
import { Plane } from './plane';

export interface Weather {
  wind: Vec3;
  cloudBase: number;
  cloudCover: number;
  haze: number;
}

export class World {
  readonly rng: Rng;
  tick = 0;
  readonly planes: Plane[] = [];
  player: Plane | null = null;
  readonly weather: Weather;
  /** Unit vector towards the sun. */
  readonly sun = new Vec3(0.35, 0.75, -0.55).normalize();
  autoRudder = true;
  /** Hook for landing.ts (set by the sortie layer). */
  touchdown: ((p: Plane, info: TouchdownInfo) => GroundResponse) | null = null;
  private nextId = 1;

  constructor(readonly seed: number, readonly ground: GroundModel, weather?: Partial<Weather>) {
    this.rng = new Rng(seed);
    this.weather = { wind: new Vec3(), cloudBase: 1500, cloudCover: 0.3, haze: 0.3, ...weather };
  }

  get time(): number {
    return this.tick * TUNING.sim.dt;
  }

  addPlane(type: AircraftId, side: Side, callsign: string, fuelFrac = 1): Plane {
    const p = new Plane(this.nextId++, AIRCRAFT[type], side, callsign, fuelFrac);
    this.planes.push(p);
    return p;
  }

  envFor(p: Plane): FlightEnv {
    return {
      wind: this.weather.wind,
      groundAt: (x, z) => {
        const s = SURFACE_FRICTION[this.ground.surfaceAt(x, z)];
        return { h: this.ground.heightAt(x, z), friction: s.friction, soft: s.soft };
      },
      onTouchdown: this.touchdown ? (info) => this.touchdown!(p, info) : undefined,
      autoRudder: p.isPlayer ? this.autoRudder : true,
    };
  }

  /** Advance one tick with the player's controls for this tick. */
  step(player: ControlFrame | null): void {
    const dt = TUNING.sim.dt;
    this.tick++;
    for (const p of this.planes) {
      if (p.status !== 'flying' && p.status !== 'landed') continue;
      if (p.isPlayer && player) {
        const c = p.ctl;
        c.pitch = player.pitch; c.roll = player.roll; c.yaw = player.yaw;
        c.throttle = player.throttle; c.boost = player.boost; c.brake = player.brake;
      }
      // A blacked-out pilot's hands go slack.
      if (p.pilot.unconscious) { p.ctl.pitch = 0; p.ctl.roll *= 0.5; }
      stepFlight(p.fs, p.ctl, this.envFor(p), p.mods, dt, this.rng);
      p.pilot.step(p.fs.nz, dt);
      if (p.flash > 0) p.flash -= dt;
    }
  }
}
