// The deterministic simulation world: every aircraft, bullet, parachute,
// falling wing and smoke puff, stepped at 50 Hz from a seeded RNG and the
// player's recorded controls. Rendering only reads it.

import { Quat, Vec3 } from '../core/math';
import { Rng } from '../core/rng';
import { AIRCRAFT, AircraftId, Side, ZoneId } from '../content/aircraft';
import { ControlFrame } from '../input/input';
import { PART } from '../render/model';
import { TUNING } from '../tuning';
import { AIContext } from './ai/types';
import { Bullet, hitZone, stepBullet, targetScale } from './ballistics';
import { applyHit, controllable, DamageEvent, flightMods, tickDamage } from './damage';
import { FlightEnv, GroundResponse, stepFlight, TouchdownInfo } from './flight';
import { GroundModel, SURFACE_FRICTION } from './ground';
import { evaluateTouchdown, obstacleImpact, worseOf } from './landing';
import { stepGunner } from './guns';
import { CloudField } from './clouds';
import type { Balloon } from '../content/world/objects';
import { Bomb, Raid } from './raid';
import { Plane } from './plane';

export interface Weather {
  wind: Vec3;
  cloudBase: number;
  cloudTop: number;
  cloudCover: number;
  haze: number;
}

export type ParticleKind = 'white' | 'black' | 'fire' | 'spark' | 'flash' | 'debris' | 'dust' | 'splash' | 'flak' | 'pall';

export interface Particle {
  pos: Vec3;
  vel: Vec3;
  age: number;
  life: number;
  kind: ParticleKind;
  size: number;
}

export class Parachute {
  readonly pos = new Vec3();
  readonly vel = new Vec3();
  age = 0;
  landed = false;
  overSea = false;
  constructor(readonly side: Side, readonly fromPlane: number, readonly isPlayer: boolean, readonly name: string) {}
}

/** A piece that has come off (a wing) tumbling down. */
export class Fragment {
  readonly pos = new Vec3();
  readonly vel = new Vec3();
  q = new Quat();
  spin = new Vec3();
  age = 0;
  constructor(readonly typeId: AircraftId, readonly part: number) {}
}

export interface GroundFire {
  pos: Vec3;
  until: number;
  size: number;
}

export type WorldEventKind =
  | 'hit' | 'playerHit' | 'shotDown' | 'bail' | 'chuteLanded' | 'crash' | 'explode' | 'wingOff'
  | 'fire' | 'glycol' | 'oil' | 'pilotWounded' | 'pilotKilled' | 'crewHit' | 'gearDamaged' | 'flapsDamaged'
  | 'landed' | 'ditched' | 'bombsGone' | 'jettison' | 'bounce' | 'touchdown' | 'groundLoop' | 'noseOver'
  | 'obstacle' | 'liftoff' | 'chuteOpen' | 'engineStart' | 'engineCough' | 'engineStop';

export interface WorldEvent {
  kind: WorldEventKind;
  t: number;
  planeId: number;
  otherId?: number;
  zone?: ZoneId;
  pos?: Vec3;
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
  /** Player assists (from settings; kept with the world so a replay matches). */
  stallGuard = false;
  bigTargets = false;
  /** Arcade mode: the player's aircraft is quicker and tougher, and never blacks out. */
  arcade = false;
  readonly bullets: Bullet[] = [];
  readonly particles: Particle[] = [];
  readonly parachutes: Parachute[] = [];
  readonly fragments: Fragment[] = [];
  readonly groundFires: GroundFire[] = [];
  cloudField: CloudField | null = null;
  readonly raids: Raid[] = [];
  readonly bombs: Bomb[] = [];
  /** Where a bomb lands: craters, wrecked hangars, the raid's tally (set by the sortie). */
  onBombImpact: ((b: Bomb, raid: Raid | undefined) => void) | null = null;
  /** RAF fighters within this range of a raid's plot make it real. */
  raidSpawnRange = 30000;
  /** Barrage balloons (and their cables) — dangerous to fly into. */
  balloons: Balloon[] = [];
  /** Per-tick events (consumed by the screen for sound, R/T, haptics). */
  events: WorldEvent[] = [];
  /** Persistent log for the debrief. */
  readonly log: WorldEvent[] = [];
  /** Hook for landing.ts (set by the sortie layer). */
  touchdown: ((p: Plane, info: TouchdownInfo) => GroundResponse) | null = null;
  /** Where each side calls home. */
  homes: Record<Side, Vec3> = { raf: new Vec3(0, 1000, 0), lw: new Vec3(95000, 3000, -45000) };
  cheats = { invulnerable: false, unlimitedAmmo: false };
  private nextId = 1;
  private ctx: AIContext;

  /** The AI's view of the world (for driving the player's seat in tests and the replay autopilot). */
  get aiContext(): AIContext {
    this.ctx.time = this.time;
    return this.ctx;
  }

  constructor(readonly seed: number, readonly ground: GroundModel, weather?: Partial<Weather>) {
    this.rng = new Rng(seed);
    this.weather = { wind: new Vec3(), cloudBase: 1500, cloudTop: 2200, cloudCover: 0.3, haze: 0.3, ...weather };
    this.ctx = {
      time: 0,
      dt: TUNING.sim.dt,
      rng: this.rng.fork('ai'),
      planes: this.planes,
      sun: this.sun,
      losClear: (a, b) => this.losClear(a, b),
      home: (side) => this.homes[side as Side],
      groundAt: (x, z) => this.ground.heightAt(x, z),
    };
  }

  get time(): number {
    return this.tick * TUNING.sim.dt;
  }

  addRaid(r: Raid): Raid {
    r.sun = this.sun;
    r.drop = (raid, p, jettison) => this.dropBombs(raid, p, jettison);
    this.raids.push(r);
    return r;
  }

  dropBombs(raid: Raid, p: Plane, jettison: boolean): void {
    if (p.bombs <= 0) return;
    const sticks = Math.max(1, Math.round(p.bombs / 250));
    for (let i = 0; i < sticks; i++) {
      const b = new Bomb(raid.id, p.id, p.bombs / sticks);
      b.pos.copy(p.pos).addScaled(p.fs.forward(), -i * 12);
      b.pos.y -= 1.5;
      b.vel.copy(p.fs.vel);
      this.bombs.push(b);
    }
    raid.bombsDropped += p.bombs;
    p.bombs = 0;
    this.emit({ kind: jettison ? 'jettison' : 'bombsGone', planeId: p.id, pos: p.pos.clone() });
  }

  private raidsStep(dt: number): void {
    for (const r of this.raids) {
      r.step(dt, this.time);
      if (!r.spawned && r.started) {
        for (const p of this.planes) {
          if (p.side !== 'raf' || !p.alive) continue;
          if (p.pos.distTo(r.plot) < this.raidSpawnRange) { r.spawn(this, this.rng.fork(`raid${r.id}`)); break; }
        }
      }
    }
    for (const b of this.bombs) {
      b.vel.y -= 9.81 * dt;
      b.vel.scale(1 - 0.02 * dt);
      b.pos.addScaled(b.vel, dt);
    }
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      const h = this.ground.heightAt(b.pos.x, b.pos.z);
      if (b.pos.y > h) continue;
      this.bombs.splice(i, 1);
      b.pos.y = h;
      const sea = this.ground.surfaceAt(b.pos.x, b.pos.z) === 'sea';
      for (let k = 0; k < 4; k++) this.puff(b.pos.clone().add(new Vec3(this.rng.signed() * 10, 2, this.rng.signed() * 10)), sea ? 'splash' : k < 2 ? 'flash' : 'pall', sea ? 6 : 8, sea ? 3 : k < 2 ? 0.6 : 20, new Vec3(0, 4, 0));
      // Aircraft on the ground nearby are damaged.
      for (const p of this.planes) {
        if (!p.fs.onGround || p.pos.distTo(b.pos) > 45) continue;
        for (const e of applyHit(p.damage, p.type, 'fuselage', 12, true, -1, this.rng)) this.onDamageEvent(p, e, -1);
      }
      const raid = this.raids.find((r) => r.id === b.raidId);
      if (raid && Math.hypot(b.pos.x - raid.target.x, b.pos.z - raid.target.z) < 600) raid.bombsOnTarget += b.kg;
      this.onBombImpact?.(b, raid);
    }
  }

  addPlane(type: AircraftId, side: Side, callsign: string, fuelFrac = 1, convergenceM = 274): Plane {
    const p = new Plane(this.nextId++, AIRCRAFT[type], side, callsign, fuelFrac, convergenceM);
    this.planes.push(p);
    return p;
  }

  planeById(id: number): Plane | undefined {
    return this.planes.find((p) => p.id === id);
  }

  /** Is a straight line clear of cloud? */
  losClear(a: Vec3, b: Vec3): boolean {
    return this.cloudField ? this.cloudField.losClear(a, b) : true;
  }

  /** How deep inside a cloud a point is (0 = clear, 1 = solid). */
  cloudDensityAt(p: Vec3): number {
    return this.cloudField ? this.cloudField.densityAt(p) : 0;
  }

  /** Live aircraft per side, rebuilt each tick. */
  private rafLive: Plane[] = [];
  private lwLive: Plane[] = [];
  private envCache = new Map<number, FlightEnv>();

  envFor(p: Plane): FlightEnv {
    let e = this.envCache.get(p.id);
    if (!e) { e = this.makeEnv(p); this.envCache.set(p.id, e); }
    e.autoRudder = p.isPlayer ? this.autoRudder : true;
    e.stallGuard = p.isPlayer && this.stallGuard;
    e.arcade = p.isPlayer && this.arcade;
    e.wind = this.weather.wind;
    return e;
  }

  private makeEnv(p: Plane): FlightEnv {
    const g = { h: 0, friction: 0, soft: false };
    return {
      wind: this.weather.wind,
      groundAt: (x, z) => {
        const s = SURFACE_FRICTION[this.ground.surfaceAt(x, z)];
        g.h = this.ground.heightAt(x, z);
        g.friction = s.friction;
        g.soft = s.soft;
        return g;
      },
      onTouchdown: (info) => this.onTouchdown(p, info),
      autoRudder: p.isPlayer ? this.autoRudder : true,
    };
  }

  private onTouchdown(p: Plane, info: TouchdownInfo): GroundResponse {
    if (p.status === 'wreck') {
      this.crash(p);
      return { action: 'stop' };
    }
    if (this.touchdown) return this.touchdown(p, info);
    const surface = this.ground.surfaceAt(info.pos.x, info.pos.z);
    const r = evaluateTouchdown({
      sinkRate: info.sinkRate, airspeed: info.airspeed, stallSpeed: info.stallSpeed, groundSpeed: info.groundSpeed,
      bank: info.bankRad, pitch: info.pitchRad, drift: info.drift, gear: info.gear, surface,
      threePoint: p.type.groundAttitude, fire: p.damage.fire, nosesUnder: p.type.id === 'spitfire',
      bounces: p.landing.bounces, luck: this.rng.next(),
    });
    const L = p.landing;
    L.contacts.push({ sink: info.sinkRate, speed: info.airspeed, bank: info.bankRad, pitch: info.pitchRad, drift: info.drift, surface, kind: r.kind });
    if (r.kind === 'bounce') {
      L.bounces++;
      this.emit({ kind: 'bounce', planeId: p.id, pos: info.pos.clone() }, false);
      return { action: 'bounce', bounceVy: r.bounceVy };
    }
    L.result = worseOf(L.result, r);
    L.field = this.ground.fieldAt?.(info.pos.x, info.pos.z) ?? null;
    this.emit({ kind: 'touchdown', planeId: p.id, pos: info.pos.clone() }, false);
    switch (r.kind) {
      case 'crashFatal':
        this.crash(p);
        return { action: 'stop' };
      case 'ditched':
        this.ditch(p);
        return { action: 'stop' };
      case 'groundLoop':
        p.fs.groundLooping = (info.bankRad || info.drift) > 0 ? 1 : -1;
        return { action: 'roll' };
      case 'greaser':
      case 'roll':
        return { action: 'roll' };
      default:
        // Nose-over, belly, crash-landing: it slides to a stop.
        if (r.kind === 'noseOver') p.fs.groundPitch = -0.6;
        for (let i = 0; i < 4; i++) this.puff(info.pos, 'dust', 4 + this.rng.next() * 4, 2);
        return { action: 'stop' };
    }
  }

  private ditch(p: Plane): void {
    p.status = 'ditched';
    p.fs.stopped = true;
    p.fs.vel.set(0, 0, 0);
    for (let i = 0; i < 8; i++) this.puff(p.pos, 'splash', 4 + this.rng.next() * 6, 2.5);
    this.emit({ kind: 'ditched', planeId: p.id, pos: p.pos.clone() });
  }

  /** On the ground: hedges, trees, water and craters in the roll-out; physics events. */
  private groundRoll(p: Plane): void {
    const fs = p.fs;
    for (const e of fs.events) {
      if (e === 'groundLoop') {
        p.landing.result = worseOf(p.landing.result, { kind: 'groundLoop', aircraft: 'minor', pilot: 'fine', reason: 'ground-looped', severity: 1.2 });
        this.emit({ kind: 'groundLoop', planeId: p.id, pos: p.pos.clone() });
      }
      if (e === 'noseOver') {
        p.landing.result = worseOf(p.landing.result, { kind: 'noseOver', aircraft: 'damaged', pilot: 'shaken', reason: 'tipped onto its nose', severity: 1.3 });
        this.emit({ kind: 'noseOver', planeId: p.id, pos: p.pos.clone() });
      }
      if (e === 'liftoff') {
        p.landing = { bounces: 0, result: null, contacts: [], field: null, at: null };
        this.emit({ kind: 'liftoff', planeId: p.id }, false);
      }
    }
    const speed = Math.hypot(fs.vel.x, fs.vel.z);
    if (!fs.onGround || fs.stopped || (speed < 0.6 && (fs.throttle < 0.15 || fs.engine === 'off') && p.landing.result)) {
      if ((fs.stopped || speed < 0.6) && p.status === 'flying' && fs.onGround) this.stopOnGround(p);
      return;
    }
    const g = this.ground;
    const f = p.landing.field ?? g.fieldAt?.(p.pos.x, p.pos.z) ?? null;
    let hit: 'hedge' | 'trees' | 'buildings' | 'water' | 'crater' | null = null;
    if (f && (p.pos.x < f.x0 || p.pos.x >= f.x1 || p.pos.z < f.z0 || p.pos.z >= f.z1)) {
      const side = p.pos.x < f.x0 ? 0 : p.pos.x >= f.x1 ? 1 : p.pos.z < f.z0 ? 2 : 3;
      if (f.hedge[side]) hit = 'hedge';
      p.landing.field = g.fieldAt?.(p.pos.x, p.pos.z) ?? null;
    }
    const surf = g.surfaceAt(p.pos.x, p.pos.z);
    if (!hit && (surf === 'woodland' || surf === 'orchard' || surf === 'hops')) hit = 'trees';
    if (!hit && surf === 'town') hit = 'buildings';
    if (!hit && (surf === 'water' || surf === 'sea')) hit = 'water';
    if (!hit) for (const c of g.cratersNear?.(p.pos.x, p.pos.z) ?? []) if (Math.hypot(p.pos.x - c.x, p.pos.z - c.z) < c.r) hit = 'crater';
    if (hit) {
      const r = obstacleImpact(speed, hit, fs.gear > 0.98 && !fs.sliding);
      if (r) {
        p.landing.result = worseOf(p.landing.result, r);
        this.emit({ kind: 'obstacle', planeId: p.id, pos: p.pos.clone() });
        if (r.kind === 'crashFatal') { this.crash(p); return; }
        if (hit === 'water') { this.ditch(p); return; }
        fs.vel.scale(hit === 'hedge' ? 0.25 : 0.1);
        fs.sliding = true;
        if (r.kind === 'noseOver') fs.groundPitch = -0.6;
        for (let i = 0; i < 3; i++) this.puff(p.pos, 'dust', 5, 2);
      }
    }
  }

  /** Down and stopped: the landing is over. */
  private stopOnGround(p: Plane): void {
    if (!p.landing.result) return; // parked before take-off
    p.status = 'landed';
    p.landing.at = p.pos.clone();
    this.emit({ kind: 'landed', planeId: p.id, pos: p.pos.clone() });
  }

  emit(e: Omit<WorldEvent, 't'>, keep = true): void {
    const ev = { ...e, t: this.time };
    this.events.push(ev);
    if (keep) this.log.push(ev);
  }

  /** Advance one tick with the player's controls for this tick. */
  step(player: ControlFrame | null): void {
    const dt = TUNING.sim.dt;
    this.tick++;
    this.ctx.time = this.time;
    this.rafLive.length = 0;
    this.lwLive.length = 0;
    for (const p of this.planes) if (p.alive) (p.side === 'raf' ? this.rafLive : this.lwLive).push(p);
    for (const p of this.planes) {
      if (!p.airborneObject) continue;
      // Last tick's flight events have been read by now (the screen reads the player's after each tick).
      p.fs.events.length = 0;
      p.prevPos.copy(p.pos);
      if (p.isPlayer && player?.cmds) for (const cmd of player.cmds) this.playerCommand(p, cmd);
      if (p.isPlayer && player && p.status === 'flying') {
        const c = p.ctl;
        c.pitch = player.pitch; c.roll = player.roll; c.yaw = player.yaw;
        c.throttle = player.throttle; c.boost = player.boost; c.brake = player.brake;
        p.trigger = player.fire;
        // Switched off after landing: on the brakes until she stops.
        if (p.fs.onGround && p.landing.result && p.fs.engine === 'off') { c.brake = true; c.throttle = 0; }
      } else if (p.brain && p.status === 'flying') {
        p.brain.update(p, this.ctx);
      }
      if (p.status === 'wreck') {
        // Out of control: the controls are wherever they fell.
        p.trigger = false;
        p.ctl.throttle = 0;
      }
      // A blacked-out pilot's hands go slack.
      if (p.pilot.unconscious) { p.ctl.pitch = 0; p.ctl.roll *= 0.5; p.trigger = false; }
      this.gearPump(p, p.isPlayer ? !!player?.pump : true, dt);
      // Handling changes only when the damage does.
      // Handling changes only when the damage does: on a hit, or as glycol
      // and engines wear (refreshed every second, staggered by id).
      const dv = p.damage.hits;
      if (dv !== p.modsVersion || (this.tick + p.id) % 50 === 0) { p.mods = flightMods(p.damage, p.type); p.modsVersion = dv; }
      p.pilot.penalty = (p.damage.pilot === 'wounded' ? 0.8 : 0) + p.fatigue * 0.4;
      stepFlight(p.fs, p.ctl, this.envFor(p), p.mods, dt, this.rng);
      // Arcade: no greying or blacking out for the player.
      p.pilot.step(p.isPlayer && this.arcade ? Math.min(p.fs.nz, 1) : p.fs.nz, dt);
      if (p.flash > 0) p.flash -= dt;
      this.damageStep(p, dt);
      if (this.balloons.length && p.status === 'flying' && p.pos.y < 2500) this.balloonStep(p);
      this.gunsStep(p, dt);
      this.bailStep(p, dt);
      this.groundRoll(p);
    }
    this.bulletsStep(dt);
    this.raidsStep(dt);
    this.objectsStep(dt);
  }

  private damageStep(p: Plane, dt: number): void {
    const d = p.damage;
    for (const e of tickDamage(d, p.fs.tas, dt, this.rng)) this.onDamageEvent(p, e, -1);
    if (d.fuelLeak > 0) p.fs.fuel = Math.max(0, p.fs.fuel - d.fuelLeak * 0.25 * dt);
    if (d.engines.some((e) => e <= 0) && p.fs.engine === 'running' && d.engines.every((e) => e <= 0)) {
      p.fs.engine = 'dead';
    }
    // Smoke trails.
    p.smokeAcc += dt;
    const period = 0.09;
    if (p.smokeAcc >= period && p.airborneObject) {
      p.smokeAcc = 0;
      const back = p.fs.forward().scale(-2);
      const at = p.pos.clone().add(back);
      if (d.fire > 0) {
        this.puff(at, 'fire', 1.2 + d.fire * 2, 0.6);
        this.puff(at, 'black', 2 + d.fire * 3, 4);
      } else if (p.status === 'wreck') this.puff(at, 'black', 2.5, 5);
      else if (d.glycol > 0.05 && p.fs.engine !== 'off') this.puff(at, 'white', 1.2 + d.glycol * 2, 3);
      else if (d.oil > 0.1) this.puff(at, 'black', 1 + d.oil, 2.5);
    }
  }

  /**
   * The Spitfire Mk I's undercarriage is raised with a hand pump. While the
   * pilot pumps, their stick hand moves and the aircraft wobbles gently.
   */
  private gearPump(p: Plane, pumping: boolean, dt: number): void {
    const fs = p.fs;
    if (p.type.gear !== 'pump' || fs.gearCmd > 0.5 || fs.gear <= 0 || fs.onGround || !pumping || p.status !== 'flying') return;
    fs.gear = Math.max(0, fs.gear - dt / (p.type.pumpStrokes * TUNING.flight.pumpStrokeSecs));
    p.pumpPhase += dt;
    const w = Math.sin(p.pumpPhase * Math.PI * 2 * TUNING.flight.pumpRate);
    p.ctl.pitch += w * TUNING.flight.pumpWobble;
    p.ctl.roll += Math.sin(p.pumpPhase * Math.PI * 2 * TUNING.flight.pumpRate + 1) * TUNING.flight.pumpWobble * 0.4;
  }

  /** Flying into a balloon or its cable does real harm. */
  private balloonStep(p: Plane): void {
    for (const b of this.balloons) {
      if (b.down) continue;
      const dx = p.pos.x - b.pos.x, dz = p.pos.z - b.pos.z;
      if (Math.abs(dx) > 30 || Math.abs(dz) > 30) continue;
      const hit = (zone: ZoneId, n: number) => {
        for (let i = 0; i < n; i++) for (const e of applyHit(p.damage, p.type, zone, 3, false, -1, this.rng)) this.onDamageEvent(p, e, -1);
      };
      if (Math.hypot(dx, p.pos.y - b.pos.y, dz) < 10) {
        b.down = true;
        this.puff(b.pos, 'flash', 8, 1);
        hit(this.rng.chance(0.5) ? 'wingL' : 'wingR', 6);
        hit('fuselage', 3);
      } else if (p.pos.y < b.pos.y && Math.hypot(dx, dz) < 2.5 + p.type.span * 0.3) {
        // The cable: it saws into a wing.
        b.down = true;
        hit(dx > 0 ? 'wingL' : 'wingR', 12);
      }
    }
  }

  private puff(pos: Vec3, kind: ParticleKind, size: number, life: number, vel?: Vec3): void {
    if (this.particles.length > 900) this.particles.shift();
    this.particles.push({ pos: pos.clone(), vel: vel ? vel.clone() : new Vec3(this.rng.signed(), 0.5 + this.rng.next(), this.rng.signed()), age: 0, life, kind, size });
  }

  private gunsStep(p: Plane, dt: number): void {
    p.firing = false;
    if (p.status !== 'flying') return;
    const rot = (v: Vec3) => p.fs.q.rotate(v);
    if (p.trigger && p.armament.guns.length) {
      p.firing = p.armament.fire(p.pos, p.fs.vel, rot, p.id, p.side, dt, this.rng, this.bullets, p.isPlayer && this.cheats.unlimitedAmmo);
    }
    if (p.gunners.length) {
      const pool = p.side === 'lw' ? this.rafLive : this.lwLive;
      const targets: { id: number; pos: Vec3; vel: Vec3 }[] = [];
      for (const t of pool) if (t.pos.distSqTo(p.pos) < 700 * 700) targets.push({ id: t.id, pos: t.pos, vel: t.fs.vel });
      if (targets.length) {
        const gunnerSkill = p.skill.aim * 0.8;
        const toBody = (v: Vec3) => p.fs.q.unrotate(v);
        for (let i = 0; i < p.gunners.length; i++) {
          const g = p.gunners[i];
          if (i + 1 >= p.crewAboard + (p.gunners.length >= p.type.crew ? 1 : 0)) g.alive = false;
          if (stepGunner(g, p.pos, p.fs.vel, toBody, rot, targets, gunnerSkill, p.id, p.side, dt, this.rng, this.bullets)) p.firing = true;
        }
      }
    }
  }

  private bulletsStep(dt: number): void {
    const bs = this.bullets;
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i];
      stepBullet(b, dt);
      if (b.dead) continue;
      for (const p of this.planes) {
        if (p.id === b.ownerId || !p.airborneObject) continue;
        // Big targets: the player's rounds hit enemies as large as they're drawn.
        const me = this.player;
        const k = this.bigTargets && me && b.ownerId === me.id && p.side !== me.side ? targetScale(p.pos.distTo(me.pos)) : 1;
        const r = (p.type.span * 0.6 + 20) * k;
        if (p.pos.distSqTo(b.pos) > r * r) continue;
        if (p.isPlayer && this.cheats.invulnerable) continue;
        const a = p.fs.q.unrotate(b.prev.clone().sub(p.prevPos)).scale(1 / k);
        const c = p.fs.q.unrotate(b.pos.clone().sub(p.pos)).scale(1 / k);
        const h = hitZone(a, c, p.type.zones);
        if (!h) continue;
        b.dead = true;
        const hitPos = a.clone().lerp(c, h.t).scale(k);
        const world = p.fs.q.rotate(hitPos).add(p.pos);
        this.puff(world, 'spark', 0.6, 0.15, p.fs.vel.clone().scale(0.9));
        p.flash = 0.12;
        p.flashParts = 1 << zonePart(h.zone.id);
        const A = TUNING.arcade;
        const dmg = !this.arcade || !me ? b.damage : b.ownerId === me.id ? b.damage * A.damageDealt : p === me ? b.damage * A.damageTaken : b.damage;
        const evs = applyHit(p.damage, p.type, h.zone.id, dmg, b.explosive, b.ownerId, this.rng);
        this.emit({ kind: p.isPlayer ? 'playerHit' : 'hit', planeId: p.id, otherId: b.ownerId, zone: h.zone.id }, false);
        for (const e of evs) this.onDamageEvent(p, e, b.ownerId);
        p.brain?.onHit?.(p, b.ownerId, this.ctx);
        break;
      }
    }
    // Compact.
    let w = 0;
    for (let i = 0; i < bs.length; i++) if (!bs[i].dead) bs[w++] = bs[i];
    bs.length = w;
  }

  private onDamageEvent(p: Plane, e: DamageEvent, by: number): void {
    const map: Partial<Record<DamageEvent, WorldEventKind>> = {
      fire: 'fire', glycolLeak: 'glycol', oilLeak: 'oil', pilotWounded: 'pilotWounded', pilotKilled: 'pilotKilled',
      crewHit: 'crewHit', gearDamaged: 'gearDamaged', flapsDamaged: 'flapsDamaged',
    };
    const k = map[e];
    if (k) this.emit({ kind: k, planeId: p.id, otherId: by });
    if (e === 'crewHit' && p.crewAboard > 1) p.crewAboard--;
    if (e === 'wingOffL' || e === 'wingOffR') {
      const part = e === 'wingOffL' ? PART.WING_L : PART.WING_R;
      p.hiddenParts |= 1 << part;
      const f = new Fragment(p.type.id, part);
      f.pos.copy(p.pos);
      f.vel.copy(p.fs.vel).scale(0.8);
      f.q = p.fs.q.clone();
      f.spin.set(this.rng.signed() * 3, this.rng.signed() * 2, (e === 'wingOffL' ? 1 : -1) * 4);
      this.fragments.push(f);
      this.emit({ kind: 'wingOff', planeId: p.id, otherId: by, pos: p.pos.clone() });
    }
    if (e === 'explode') this.explodeInAir(p);
    if (p.status === 'flying' && !controllable(p.damage)) this.goDown(p);
  }

  /** Lost control: becomes a falling wreck; credit the kill. */
  goDown(p: Plane): void {
    if (p.status !== 'flying') return;
    p.status = 'wreck';
    p.downAt = this.time;
    let best = -1, bd = 0;
    for (const [id, v] of Object.entries(p.damage.by)) if (v > bd) { bd = v; best = +id; }
    p.killedBy = best;
    this.emit({ kind: 'shotDown', planeId: p.id, otherId: best, pos: p.pos.clone() });
    if (p.damage.pilot !== 'killed' || p.crewAboard > 1) {
      p.bailing = true;
      p.bailTimer = this.rng.range(TUNING.ai.bailDelay[0], TUNING.ai.bailDelay[1]);
    }
    if (p.isPlayer) p.bailing = false; // the player decides for themselves
  }

  private explodeInAir(p: Plane): void {
    if (p.status === 'flying') this.goDown(p);
    p.status = 'destroyed';
    for (let i = 0; i < 14; i++) {
      this.puff(p.pos, i < 6 ? 'flash' : 'black', 4 + this.rng.next() * 6, i < 6 ? 0.6 : 6,
        p.fs.vel.clone().scale(0.5).add(new Vec3(this.rng.signed() * 15, this.rng.signed() * 15, this.rng.signed() * 15)));
    }
    for (let i = 0; i < 4; i++) {
      const f = new Fragment(p.type.id, -1);
      f.pos.copy(p.pos);
      f.vel.copy(p.fs.vel).scale(0.5).add(new Vec3(this.rng.signed() * 20, this.rng.signed() * 10, this.rng.signed() * 20));
      f.spin.set(this.rng.signed() * 5, this.rng.signed() * 5, this.rng.signed() * 5);
      this.fragments.push(f);
    }
    // A crew member or two may be thrown clear.
    if (!p.isPlayer && p.crewAboard > 0 && this.rng.chance(0.3)) this.spawnChute(p, 'thrown clear');
    this.emit({ kind: 'explode', planeId: p.id, pos: p.pos.clone() });
  }

  crash(p: Plane): void {
    if (p.status === 'crashed') return;
    const wasFlying = p.status === 'flying';
    if (wasFlying) this.goDown(p);
    p.status = 'crashed';
    p.fs.stopped = true;
    p.fs.vel.set(0, 0, 0);
    const sea = this.ground.surfaceAt(p.pos.x, p.pos.z) === 'sea';
    for (let i = 0; i < 10; i++) this.puff(p.pos, sea ? 'splash' : i < 5 ? 'flash' : 'black', 5 + this.rng.next() * 8, sea ? 2 : i < 5 ? 0.7 : 8);
    if (!sea) this.groundFires.push({ pos: p.pos.clone(), until: this.time + 600, size: p.type.span });
    // Was it seen to crash? Any enemy (of the victim) within sight.
    for (const q of this.planes) {
      if (q.side === p.side || !q.alive) continue;
      if (q.pos.distTo(p.pos) < 7000 && this.losClear(q.pos, p.pos)) { p.seenCrash = true; break; }
    }
    this.emit({ kind: 'crash', planeId: p.id, pos: p.pos.clone() });
  }

  /** Commands that change the player's aircraft. (Sortie-level ones are handled by the sortie.) */
  playerCommand(p: Plane, cmd: string): void {
    const fs = p.fs;
    switch (cmd) {
      case 'gear':
        if (fs.type.gear === 'fixed' || fs.onGround) break;
        if (fs.type.gear === 'pump' && fs.gearCmd < 0.5 && fs.gear > 0.02) break; // keep pumping
        fs.gearCmd = fs.gearCmd > 0.5 ? 0 : 1;
        break;
      case 'flaps':
        fs.flapsCmd = fs.flapsCmd > 0.5 ? 0 : 1;
        break;
      case 'bailOut':
        if (!fs.onGround && fs.agl > 120) this.bailOut(p);
        break;
      case 'engineOff':
        // Down after a landing: switch off, and she brakes to a stop.
        if (fs.onGround && p.landing.result && (fs.engine === 'running' || fs.engine === 'coughing')) {
          fs.engine = 'off';
          this.emit({ kind: 'engineStop', planeId: p.id }, false);
        }
        break;
    }
  }

  /** Begin bailing out (player request or AI decision). */
  bailOut(p: Plane): void {
    if (p.status !== 'flying' && p.status !== 'wreck') return;
    p.bailing = true;
    p.bailTimer = p.isPlayer ? 2.0 : 0.5; // canopy, roll inverted / climb out
  }

  private bailStep(p: Plane, dt: number): void {
    if (!p.bailing || p.crewAboard <= 0) return;
    if (p.status !== 'flying' && p.status !== 'wreck') return;
    p.bailTimer -= dt;
    if (p.bailTimer > 0) return;
    const agl = p.pos.y - this.ground.heightAt(p.pos.x, p.pos.z);
    if (agl < 120) { p.bailing = false; return; } // too low to jump
    this.spawnChute(p, p.isPlayer ? 'pilot' : 'crew');
    p.bailTimer = this.rng.range(0.8, 1.6);
    if (p.crewAboard <= 0) {
      if (p.status === 'flying') { this.goDown(p); p.status = 'wreck'; }
      p.bailing = false;
    }
  }

  private spawnChute(p: Plane, name: string): void {
    const c = new Parachute(p.side, p.id, p.isPlayer && p.crewAboard === p.type.crew, name);
    c.pos.copy(p.pos).add(p.fs.up().scale(2));
    c.vel.copy(p.fs.vel).scale(0.5);
    this.parachutes.push(c);
    p.crewAboard--;
    this.emit({ kind: 'bail', planeId: p.id, pos: c.pos.clone() });
  }

  private objectsStep(dt: number): void {
    const w = this.weather.wind;
    for (const c of this.parachutes) {
      if (c.landed) continue;
      c.age += dt;
      // Free fall briefly, then the canopy opens and drift takes over.
      if (c.age < 2) {
        c.vel.y -= 9.81 * dt;
        c.vel.scale(1 - 0.5 * dt);
      } else {
        c.vel.x += (w.x - c.vel.x) * Math.min(1, dt * 1.5);
        c.vel.z += (w.z - c.vel.z) * Math.min(1, dt * 1.5);
        c.vel.y += (-6 - c.vel.y) * Math.min(1, dt * 2);
      }
      c.pos.addScaled(c.vel, dt);
      const h = this.ground.heightAt(c.pos.x, c.pos.z);
      if (c.pos.y <= h + 0.5) {
        c.pos.y = h;
        c.landed = true;
        c.overSea = this.ground.surfaceAt(c.pos.x, c.pos.z) === 'sea';
        this.emit({ kind: 'chuteLanded', planeId: c.fromPlane, pos: c.pos.clone() });
      }
    }
    for (const f of this.fragments) {
      f.age += dt;
      f.vel.y -= 9.81 * dt;
      f.vel.scale(1 - 0.15 * dt);
      f.pos.addScaled(f.vel, dt);
      f.q.integrateBody(f.spin.x, f.spin.y, f.spin.z, dt);
    }
    for (let i = this.fragments.length - 1; i >= 0; i--) {
      const f = this.fragments[i];
      if (f.pos.y < this.ground.heightAt(f.pos.x, f.pos.z)) this.fragments.splice(i, 1);
    }
    for (const pt of this.particles) {
      pt.age += dt;
      pt.pos.addScaled(pt.vel, dt);
      pt.vel.scale(1 - dt * 0.8);
      if (pt.kind === 'black' || pt.kind === 'white' || pt.kind === 'pall') { pt.vel.y += 0.6 * dt; pt.size += dt * 1.2; pt.pos.addScaled(w, dt); }
      if (pt.kind === 'debris') pt.vel.y -= 9.81 * dt;
    }
    let k = 0;
    for (const pt of this.particles) if (pt.age < pt.life) this.particles[k++] = pt;
    this.particles.length = k;
    // Burning wrecks on the ground send up a pall of smoke.
    if (this.tick % 25 === 0) {
      for (const g of this.groundFires) {
        if (this.time > g.until) continue;
        this.puff(g.pos.clone().add(new Vec3(this.rng.signed() * 4, 3, this.rng.signed() * 4)), 'pall', g.size * 0.4, 40, new Vec3(0, 3, 0));
      }
    }
  }
}

function zonePart(z: ZoneId): number {
  switch (z) {
    case 'wingL': case 'fuelL': case 'engineL': return PART.WING_L;
    case 'wingR': case 'fuelR': case 'engineR': case 'aileron': return PART.WING_R;
    case 'elevator': case 'rudder': case 'tail': return PART.TAIL;
    default: return PART.BODY;
  }
}
