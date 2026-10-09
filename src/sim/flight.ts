// The flight model. Arcade-sim, energy based, the same physics for the player
// and every AI aircraft.
//
// Forces: thrust (falls off above full-throttle height), drag (∝ V², plus
// induced, flaps, gear, damage, high-speed rise), lift from angle of attack
// (capped by the stall), side force, gravity.
//
// Rotation uses a command model rather than raw moments, which keeps it
// tunable and stable at 50 Hz:
//   pitch: the stick commands a load factor; neutral stick ≈ 1 g ("trimmed").
//          The elevator drives angle of attack towards what that load factor
//          needs, limited by the stall — so full back stick at low speed stalls,
//          at high speed it pulls the G limit. Turn performance therefore comes
//          from lift limits and G, and costs energy through induced drag.
//   roll:  rate ∝ stick, peaking at a mid speed and getting heavy when fast.
//   yaw:   weathercock towards the airflow; rudder (or auto-rudder) sets the
//          sideslip; torque swings the nose at high power and low speed.

import { airDensity, clamp, G, Quat, Vec3 } from '../core/math';
import { Rng } from '../core/rng';
import { AircraftType, elevatorG, massOf, stallSpeed } from '../content/aircraft';
import { TUNING } from '../tuning';

export interface FlightControls {
  pitch: number;
  roll: number;
  yaw: number;
  throttle: number;
  boost: boolean;
  brake: boolean;
  /** Dive brakes (Ju 87). */
  airbrake?: boolean;
}

/** Damage effects on handling, produced by damage.ts. Neutral values = undamaged. */
export interface FlightMods {
  aileron: number;
  aileronBias: number;
  elevator: number;
  elevatorBias: number;
  rudder: number;
  rudderBias: number;
  extraDrag: number;
  liftMul: number;
  /** Roll tendency from asymmetric wing damage (rad/s). */
  rollBias: number;
  /** Per-engine power multipliers. */
  power: number[];
  flapsWork: boolean;
  /** 1 = gear normal, 'one' = one leg won't lock, 'none' = won't lower. */
  gearFault: 'ok' | 'one' | 'none';
  /** Pilot control responsiveness (wounded, fatigued). */
  pilot: number;
  /** Cooling effectiveness (glycol leak lowers it). */
  coolant: number;
}

export const neutralMods = (engines = 1): FlightMods => ({
  aileron: 1, aileronBias: 0, elevator: 1, elevatorBias: 0, rudder: 1, rudderBias: 0,
  extraDrag: 0, liftMul: 1, rollBias: 0, power: new Array(engines).fill(1), flapsWork: true, gearFault: 'ok', pilot: 1, coolant: 1,
});

export type EngineState = 'off' | 'starting' | 'running' | 'coughing' | 'dead' | 'seized';

export interface TouchdownInfo {
  sinkRate: number;
  airspeed: number;
  groundSpeed: number;
  stallSpeed: number;
  bankRad: number;
  pitchRad: number;
  /** Angle between the track and the nose (rad). */
  drift: number;
  gear: 'down' | 'partial' | 'up';
  pos: Vec3;
  heading: number;
}

export interface GroundResponse {
  /** 'roll' = now rolling on the ground; 'bounce' = back in the air with rebound vy; 'stop' = slide to a halt (belly / wreck). */
  action: 'roll' | 'bounce' | 'stop';
  bounceVy?: number;
  /** Friction multiplier for the surface. */
  friction?: number;
}

export interface FlightEnv {
  wind: Vec3;
  /** Ground height and rolling friction at x, z. */
  groundAt(x: number, z: number): { h: number; friction: number; soft: boolean };
  /** Called at the moment of ground contact from the air. */
  onTouchdown?(info: TouchdownInfo): GroundResponse;
  autoRudder: boolean;
  /** Full back stick holds the wing at the buffet rather than stalling it (the player's assist). */
  stallGuard?: boolean;
  /** Arcade handling: more thrust, quicker controls, no cut-out, no spins (the player's choice). */
  arcade?: boolean;
}

export type FlightEventKind =
  | 'stall' | 'spin' | 'cutout' | 'cough' | 'fuelOut' | 'seize' | 'overspeed' | 'overG'
  | 'liftoff' | 'groundLoop' | 'noseOver' | 'stopped' | 'boostOverheat';

export class FlightState {
  readonly pos = new Vec3();
  readonly vel = new Vec3();
  q = new Quat();
  // Body rates (rad/s): roll right +, pitch up +, yaw right +.
  p = 0;
  qr = 0;
  r = 0;
  throttle = 0.8;
  rpm = 0;
  boostLb = 0;
  fuel: number;
  /** Radiator (coolant) temperature °C. */
  radTemp = 70;
  oilTemp = 60;
  engine: EngineState = 'running';
  cutoutT = 0;
  /** Seconds spent below the cut-out load factor. */
  negGT = 0;
  coughT = 0;
  surge = 1;
  boostOn = false;
  boostUsed = 0;
  /** Flaps and undercarriage positions, 0..1 (gear 1 = down). */
  flaps = 0;
  flapsCmd = 0;
  gear = 0;
  gearCmd = 0;
  /** Gear failed to lock (one leg). */
  gearLegsDown = 2;
  onGround = false;
  /** Tail-up fraction on the ground run. */
  tailUp = 0;
  groundHeading = 0;
  groundPitch = 0;
  groundLooping = 0;
  /** Sliding to a stop on the belly / as a wreck. */
  sliding = false;
  stopped = false;
  // Derived (read-only for others).
  tas = 0;
  ias = 0;
  alpha = 0;
  beta = 0;
  nz = 1;
  nyLat = 0;
  vs = 0;
  stalled = false;
  buffet = 0;
  /** Nose-up trim wound in to help a heavy elevator (0..1): full back stick at speed gradually wins back G. */
  trim = 0;
  spin = 0;
  spinDir = 1;
  heading = 0;
  pitch = 0;
  roll = 0;
  agl = 1000;
  events: FlightEventKind[] = [];
  time = 0;

  constructor(readonly type: AircraftType, fuelFrac = 1) {
    this.fuel = type.fuelCapacity * fuelFrac;
    this.rpm = 2600;
  }

  get mass(): number {
    return massOf(this.type, this.fuel);
  }

  forward(out = new Vec3()): Vec3 { return this.q.rotate(AXIS_Z, out); }
  up(out = new Vec3()): Vec3 { return this.q.rotate(AXIS_Y, out); }
  right(out = new Vec3()): Vec3 { return this.q.rotate(AXIS_X, out); }

  /** Place in flight at a position, heading (rad), speed (TAS m/s). */
  setAirborne(pos: Vec3, heading: number, speed: number, pitch = 0): void {
    this.pos.copy(pos);
    this.q = Quat.fromEuler(heading, pitch, 0);
    this.forward(this.vel).scale(speed);
    this.p = this.qr = this.r = 0;
    this.onGround = false;
    this.gear = this.type.gear === 'fixed' ? 1 : 0;
    this.gearCmd = this.gear;
    this.flaps = this.flapsCmd = 0;
    this.engine = 'running';
    this.rpm = 2600;
    updateDerived(this, 0);
    this.ias = speed * Math.sqrt(airDensity(pos.y) / 1.225);
  }

  /** Sit on the ground at rest in the three-point attitude. */
  setOnGround(pos: Vec3, heading: number): void {
    this.pos.copy(pos);
    this.groundHeading = heading;
    this.groundPitch = this.type.groundAttitude;
    this.q = Quat.fromEuler(heading, this.groundPitch, 0);
    this.vel.set(0, 0, 0);
    this.p = this.qr = this.r = 0;
    this.onGround = true;
    this.tailUp = 0;
    this.gear = 1;
    this.gearCmd = 1;
    this.throttle = 0;
    this.stopped = false;
    this.sliding = false;
    updateDerived(this, 0);
  }
}

/** Engine power factor with altitude: rises to full-throttle height then falls away. */
export function altitudePowerFactor(t: AircraftType, h: number): number {
  if (h <= t.critAlt) return 0.86 + 0.14 * (Math.max(0, h) / t.critAlt);
  return Math.exp(-(h - t.critAlt) / t.lapse);
}

export function rollRateMax(t: AircraftType, v: number): number {
  if (v < t.rollPeakV) return t.rollRate * clamp(v / t.rollPeakV, 0.15, 1);
  if (v < t.rollHeavyV) return t.rollRate;
  // Ailerons stiffen at high speed.
  return t.rollRate * Math.max(0.3, 1 - ((v - t.rollHeavyV) / (t.rollHeavyV * 0.6)) * 0.7);
}

function clOf(t: AircraftType, alpha: number, flaps: number, liftMul: number): number {
  const as = t.alphaStall - flaps * 0.03;
  const flapCl = flaps * t.flapCl;
  let cl: number;
  if (alpha <= as && alpha >= -as * 0.85) cl = t.cl0 + t.clAlpha * alpha + flapCl;
  else if (alpha > as) {
    const clMax = t.cl0 + t.clAlpha * as + flapCl;
    cl = clMax * Math.max(0.55, 1 - (alpha - as) * 2.2);
  } else {
    const clMin = t.cl0 + t.clAlpha * (-as * 0.85) + flapCl;
    cl = clMin * Math.max(0.55, 1 - (-as * 0.85 - alpha) * 2.2);
  }
  return cl * liftMul;
}

/** Load factor commanded by the stick. */
/**
 * Stick to load factor. Pulling is progressive (small pulls are gentle, the
 * last part of the travel is where the G is). Pushing unloads to zero G over
 * most of the forward travel; only the last part goes negative, so easing
 * into a dive doesn't cut the Merlin, but a hard bunt does.
 */
export function commandedG(t: AircraftType, pitchIn: number, gMax = t.maxG): number {
  const T = TUNING.flight;
  if (pitchIn >= 0) return 1 + Math.pow(pitchIn, T.pullCurve) * (gMax - 1);
  const x = -pitchIn, P = T.pushToZeroG;
  if (x <= P) return 1 - Math.pow(x / P, 1.3);
  return ((x - P) / (1 - P)) * t.minG;
}

const tmpF = new Vec3(), tmpU = new Vec3(), tmpR = new Vec3();

function updateDerived(s: FlightState, _dt: number): void {
  const f = s.forward(tmpF), u = s.up(tmpU), r = s.right(tmpR);
  s.heading = Math.atan2(f.x, f.z);
  if (s.heading < 0) s.heading += Math.PI * 2;
  s.pitch = Math.asin(clamp(f.y, -1, 1));
  s.roll = Math.atan2(-r.y, u.y);
  s.vs = s.vel.y;
  s.tas = s.vel.len();
}

/**
 * Advance one fixed step. Mutates s; pushes events. Deterministic for a
 * given rng state.
 */
const AXIS_X = new Vec3(1, 0, 0), AXIS_Y = new Vec3(0, 1, 0), AXIS_Z = new Vec3(0, 0, 1);
/** Scratch vectors for stepFlight (not re-entrant; the sim is single-threaded). */
const SV = {
  vAir: new Vec3(), f: new Vec3(), u: new Vec3(), rt: new Vec3(), vb: new Vec3(), force: new Vec3(),
  vhat: new Vec3(), lift: new Vec3(), spec: new Vec3(), acc: new Vec3(), an: new Vec3(),
};

export function stepFlight(s: FlightState, c: FlightControls, env: FlightEnv, mods: FlightMods, dt: number, rng: Rng): void {
  const t = s.type;
  const T = TUNING.flight;
  s.time += dt;
  if (s.stopped) {
    s.vel.set(0, 0, 0);
    s.p = s.qr = s.r = 0;
    engineStep(s, c, mods, dt, 0, rng);
    updateDerived(s, dt);
    return;
  }

  // ---- Configuration: flaps and undercarriage.
  if (mods.flapsWork) s.flaps += clamp(s.flapsCmd - s.flaps, -dt * 0.35, dt * 0.35);
  if (t.gear === 'hydraulic') {
    const target = mods.gearFault === 'none' && s.gearCmd > 0.5 ? s.gear : s.gearCmd;
    s.gear += clamp(target - s.gear, -dt / 7, dt / 7);
  } else if (t.gear === 'fixed') s.gear = 1;
  // ('pump' gear is moved by the pump in the caller; lowering is by gravity.)
  if (t.gear === 'pump' && s.gearCmd > 0.5 && mods.gearFault !== 'none') s.gear = Math.min(1, s.gear + dt / 4);
  s.gearLegsDown = s.gear > 0.98 ? (mods.gearFault === 'one' ? 1 : 2) : 0;

  const rho = airDensity(s.pos.y);
  const vAir = SV.vAir.set(s.vel.x - env.wind.x, s.vel.y - env.wind.y, s.vel.z - env.wind.z);
  const V = vAir.len();
  const qbar = 0.5 * rho * V * V;
  const f = s.forward(SV.f), u = s.up(SV.u), rt = s.right(SV.rt);
  const vb = s.q.unrotate(vAir, SV.vb);
  const alpha = V > 1 ? Math.atan2(-vb.y, vb.z) : 0;
  const beta = V > 1 ? Math.atan2(vb.x, vb.z) : 0;
  s.alpha = alpha;
  s.beta = beta;
  s.tas = V;
  s.ias = V * Math.sqrt(rho / 1.225);
  const m = s.mass;
  const S = t.wingArea;

  // ---- Engine and thrust.
  const powerFrac = engineStep(s, c, mods, dt, V, rng, !!env.arcade);
  const power = t.power * t.engines * powerFrac * altitudePowerFactor(t, s.pos.y) * (env.arcade ? TUNING.arcade.thrust : 1);
  const thrust = (t.propEff * power) / Math.max(V, t.thrustV0);

  // ---- Aerodynamic forces.
  const cl = clOf(t, alpha, s.flaps, mods.liftMul);
  const AR = (t.span * t.span) / S;
  const k = 1 / (Math.PI * AR * t.oswald);
  const rise = V > t.dragRiseV ? t.dragRiseK * ((V - t.dragRiseV) / t.dragRiseV) ** 2 : 0;
  const stallDrag = alpha > t.alphaStall ? (alpha - t.alphaStall) * 0.8 : 0;
  const windmill = s.engine === 'running' || s.engine === 'coughing' ? 0 : 0.008;
  const cd = t.cd0 * (1 + rise) + k * cl * cl + s.flaps * t.flapCd + s.gear * t.gearCd + mods.extraDrag + stallDrag + windmill + (c.airbrake ? t.diveBrakeCd ?? 0 : 0);
  const force = SV.force.set(0, 0, 0);
  if (V > 0.5) {
    const vhat = SV.vhat.copy(vAir).scale(1 / V);
    const liftDir = SV.lift.crossOf(vhat, rt).normalize();
    force.addScaled(liftDir, qbar * S * cl);
    force.addScaled(vhat, -qbar * S * cd);
    // Side force from sideslip (fuselage + fin).
    force.addScaled(rt, -qbar * S * T.sideForce * Math.sin(beta));
  }
  force.addScaled(f, thrust);
  const specific = SV.spec.copy(force).scale(1 / m); // non-gravitational acceleration
  s.nz = specific.dot(u) / G;
  s.nyLat = specific.dot(rt) / G;
  const acc = SV.acc.copy(specific);
  acc.y -= G;

  if (s.onGround) {
    groundStep(s, c, env, mods, dt, acc, thrust, V);
    updateDerived(s, dt);
    return;
  }

  // ---- Translational integration (semi-implicit Euler).
  s.vel.addScaled(acc, dt);
  s.pos.addScaled(s.vel, dt);

  // ---- Rotation: command model.
  const authority = clamp(qbar / T.qRef, 0.12, 1);
  const pilot = mods.pilot;
  const vs = stallSpeed(t, m, rho, s.flaps);
  // Path rotation rates: how fast the velocity vector is turning in body axes.
  let pathPitch = 0, pathYaw = 0;
  if (V > 5) {
    const vhat = SV.vhat.copy(vAir).scale(1 / V);
    const an = SV.an.copy(acc).addScaled(vhat, -acc.dot(vhat));
    const np = SV.lift.crossOf(vhat, rt).normalize();
    pathPitch = an.dot(np) / V;
    pathYaw = an.dot(rt) / V;
  }
  // Pitch: stick → load factor → angle of attack.
  const pitchIn = clamp(c.pitch + mods.elevatorBias, -1, 1);
  // Full back stick pulls what the pilot's arm can manage: on a heavy elevator
  // at speed, less than the airframe could take. Held there, the pilot winds
  // in nose-up trim, and slowly gets more.
  const eg = elevatorG(t, s.ias);
  if (eg < t.maxG && pitchIn > 0.8) s.trim = Math.min(1, s.trim + dt * T.trimRate);
  else s.trim = Math.max(0, s.trim - dt * T.trimRate * 2);
  const gCmd = commandedG(t, pitchIn, env.arcade ? t.maxG : eg + s.trim * (t.maxG - eg) * T.trimGain);
  const clReq = (gCmd * m * G) / Math.max(qbar * S * mods.liftMul, 1);
  let alphaReq = (clReq - t.cl0 - s.flaps * t.flapCl) / t.clAlpha;
  const asEff = t.alphaStall - s.flaps * 0.03;
  // Only the last part of the stick travel takes the wing past the stall.
  const stallLimit = pitchIn > T.stallStick && !env.stallGuard && !env.arcade ? T.overStall : T.softStall;
  alphaReq = clamp(alphaReq, -asEff * 0.95, asEff * stallLimit);
  const quick = env.arcade ? TUNING.arcade.pitch : 1;
  const kA = t.pitchGain * authority * mods.elevator * (0.55 + 0.45 * pilot) * quick;
  let qr = pathPitch + kA * (alphaReq - alpha);
  qr = clamp(qr, -T.maxPitchRate * quick, T.maxPitchRate * quick);

  // Roll.
  let pCmd = c.roll * rollRateMax(t, V) * mods.aileron * (0.6 + 0.4 * pilot) * (env.arcade ? TUNING.arcade.roll : 1) + mods.aileronBias + mods.rollBias;
  // Yaw: sideslip target from rudder or auto-rudder; torque at high power, low speed.
  const torqueBeta = t.torque * powerFrac * clamp(1 - V / 110, 0, 1);
  let betaTarget: number;
  // Manual rudder still works with auto-rudder on (side-slipping off height).
  if (env.autoRudder) betaTarget = torqueBeta * T.autoRudderAirResidual + mods.rudderBias * 0.5 - c.yaw * T.rudderBeta * mods.rudder;
  else betaTarget = -c.yaw * T.rudderBeta * mods.rudder + torqueBeta + mods.rudderBias + T.adverseYaw * s.p;
  let r = pathYaw + T.weathercock * authority * (beta - betaTarget);

  // ---- Stall, wing drop and spin.
  const stalledNow = alpha > asEff || alpha < -asEff * 0.9;
  s.buffet = clamp((alpha - asEff * 0.82) / (asEff * 0.18), 0, 1);
  if (stalledNow && !s.stalled) {
    s.events.push('stall');
    // Wing drop direction: sideslip first, else a coin from the seeded rng.
    s.spinDir = Math.abs(beta) > 0.02 ? (beta > 0 ? -1 : 1) : rng.chance(0.5) ? 1 : -1;
  }
  s.stalled = stalledNow;
  const antiRudder = env.autoRudder ? 1 : clamp(-c.yaw * s.spinDir, 0, 1);
  if (stalledNow && V < vs * 1.6) {
    pCmd *= 0.35;
    pCmd += s.spinDir * T.wingDrop * clamp((alpha - asEff) / 0.1, 0.3, 1);
    // Yawing while stalled develops into a spin.
    const yawing = Math.abs(s.r) > 0.35 || Math.abs(beta) > 0.1 || c.yaw * s.spinDir > 0.3;
    if (yawing && alphaReq > asEff * 0.98 && !env.arcade) s.spin = Math.min(1, s.spin + dt * T.spinBuild);
  }
  if (alphaReq < asEff * 0.9) {
    // Stick forward: recovery, quicker with opposite rudder.
    s.spin = Math.max(0, s.spin - dt * (T.spinRecover * (0.25 + 0.75 * antiRudder)));
  }
  if (s.spin > 0) {
    if (s.spin > 0.5 && !s.events.includes('spin') && s.spin - dt * T.spinBuild <= 0.5) s.events.push('spin');
    pCmd = pCmd * (1 - s.spin) + s.spinDir * T.spinRoll * s.spin;
    r = r * (1 - s.spin) + s.spinDir * T.spinYaw * s.spin;
    qr = qr * (1 - s.spin) + (kA * (asEff * 1.3 - alpha)) * s.spin;
  }

  s.p += (pCmd - s.p) * Math.min(1, dt * T.rollLag * (0.5 + 0.5 * pilot));
  s.qr = qr;
  s.r = clamp(r, -2, 2);
  s.q.integrateBody(-s.qr, s.r, -s.p, dt);

  // ---- Limits and warnings.
  if (V > t.vne && !s.events.includes('overspeed')) s.events.push('overspeed');
  if (s.nz > t.maxG * 1.15) s.events.push('overG');

  // ---- Ground contact from the air.
  const gnd = env.groundAt(s.pos.x, s.pos.z);
  const contactH = s.gear > 0.5 ? t.gearHeight * (s.gear > 0.98 ? 1 : 0.6) : 0.55;
  s.agl = s.pos.y - gnd.h;
  if (s.pos.y < gnd.h + contactH) {
    const info: TouchdownInfo = {
      sinkRate: Math.max(0, -s.vel.y),
      airspeed: V,
      groundSpeed: Math.hypot(s.vel.x, s.vel.z),
      stallSpeed: vs,
      bankRad: s.roll,
      pitchRad: s.pitch,
      drift: driftAngle(s),
      gear: s.gear > 0.98 ? (s.gearLegsDown === 2 ? 'down' : 'partial') : s.gear > 0.2 ? 'partial' : 'up',
      pos: s.pos.clone(),
      heading: s.heading,
    };
    const resp = env.onTouchdown ? env.onTouchdown(info) : defaultTouchdown(info);
    s.pos.y = gnd.h + contactH;
    if (resp.action === 'bounce') {
      s.vel.y = resp.bounceVy ?? 1;
    } else {
      s.onGround = true;
      s.vel.y = 0;
      s.groundHeading = s.heading;
      s.groundPitch = clamp(s.pitch, -0.1, t.groundAttitude);
      s.tailUp = s.groundPitch < t.groundAttitude * 0.5 ? 1 : 0;
      s.sliding = resp.action === 'stop';
      s.p = s.qr = s.r = 0;
      s.spin = 0;
    }
  }
  updateDerived(s, dt);
  s.agl = s.pos.y - gnd.h;
}

function driftAngle(s: FlightState): number {
  const gs = Math.hypot(s.vel.x, s.vel.z);
  if (gs < 2) return 0;
  const track = Math.atan2(s.vel.x, s.vel.z);
  let d = track - s.heading;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function defaultTouchdown(info: TouchdownInfo): GroundResponse {
  if (info.sinkRate > 3.5) return { action: 'bounce', bounceVy: info.sinkRate * 0.3 };
  return { action: info.gear === 'down' ? 'roll' : 'stop' };
}

/** Engine, fuel and temperatures. Returns the delivered power fraction. */
function engineStep(s: FlightState, c: FlightControls, mods: FlightMods, dt: number, V: number, rng: Rng, noCutout = false): number {
  const t = s.type;
  const T = TUNING.flight;
  s.throttle = clamp(c.throttle, 0, 1);
  const running = s.engine === 'running' || s.engine === 'coughing';
  // Negative-G cut-out: float carburettors starve; fuel injection doesn't care.
  // The float chamber needs a moment of real negative G to starve the carburettor.
  s.negGT = s.nz < T.cutoutG && !noCutout ? s.negGT + dt : 0;
  if (running && !t.fuelInjected && s.negGT > T.cutoutDelay) {
    if (s.cutoutT <= 0) s.events.push('cutout');
    s.cutoutT = T.cutoutRecover;
  } else if (s.cutoutT > 0) s.cutoutT -= dt;

  // Emergency boost ("through the gate").
  s.boostOn = c.boost && running && s.throttle > 0.9;
  if (s.boostOn) {
    s.boostUsed += dt;
    if (s.boostUsed > t.boostSeconds && !s.events.includes('boostOverheat')) s.events.push('boostOverheat');
  }

  // Fuel: starvation coughs before it stops.
  const lowFuel = s.fuel < t.fuelCapacity * T.coughFuelFrac;
  if (running && s.fuel <= 0) {
    s.engine = 'dead';
    s.events.push('fuelOut');
  } else if (running && lowFuel && s.engine === 'running') {
    s.engine = 'coughing';
    s.events.push('cough');
  }
  if (s.engine === 'coughing') {
    s.coughT -= dt;
    if (s.coughT <= 0) {
      s.surge = rng.chance(0.45) ? 0.15 : 0.9;
      s.coughT = rng.range(0.25, 0.8);
      if (s.surge < 0.5) s.events.push('cough');
    }
  } else s.surge = 1;

  const engineHealth = mods.power.reduce((a, b) => a + b, 0) / mods.power.length;
  let frac = 0;
  if (running) {
    frac = (0.06 + 0.94 * s.throttle) * engineHealth * s.surge;
    if (s.boostOn) frac *= t.boostMul;
    if (s.cutoutT > 0) frac *= 0.05;
    const burn = t.fuelBurn * (0.2 + 0.8 * frac) * (s.boostOn ? 1.35 : 1);
    s.fuel = Math.max(0, s.fuel - burn * dt);
  }
  // RPM (constant-speed unit holds it when running) and boost gauge.
  const targetRpm = running ? 1800 + 1200 * Math.min(1, s.throttle) + (s.boostOn ? 150 : 0) : s.engine === 'starting' ? 600 : Math.min(1400, V * 9);
  s.rpm += (targetRpm * (s.cutoutT > 0 ? 0.85 : 1) - s.rpm) * Math.min(1, dt * 2.5);
  s.boostLb = running ? -4 + 10.25 * s.throttle + (s.boostOn ? 5.75 : 0) : -6;
  // Temperatures: heat from power, cooling with airflow.
  const cooling = (0.25 + Math.min(1.2, V / 90)) * mods.coolant;
  const base = s.boostOn ? frac / t.boostMul : frac;
  const heat = running ? 26 * base * base + (s.boostOn ? 12 : 0) : 0;
  s.radTemp += (heat - (s.radTemp - 60) * cooling * 0.6) * dt * T.tempRate;
  s.oilTemp += ((s.radTemp * 0.7 + 10) - s.oilTemp) * dt * 0.05;
  if (s.boostOn && s.boostUsed > t.boostSeconds) s.radTemp += dt * 1.5;
  if (s.radTemp > T.seizeTemp && running) {
    s.engine = 'seized';
    s.events.push('seize');
  }
  return frac;
}

/** Taildragger ground handling: rolling, steering, torque swing, tail-up, ground loops. */
function groundStep(s: FlightState, c: FlightControls, env: FlightEnv, mods: FlightMods, dt: number, acc: Vec3, thrust: number, V: number): void {
  const t = s.type;
  const T = TUNING.flight;
  const gnd = env.groundAt(s.pos.x, s.pos.z);
  const m = s.mass;
  const lift = Math.max(0, (acc.y + G) * m - thrust * Math.sin(s.groundPitch));
  const N = Math.max(0, m * G - lift);
  const vs = stallSpeed(t, m, 1.225, s.flaps);
  const hx = Math.sin(s.groundHeading), hz = Math.cos(s.groundHeading);
  // Horizontal velocity split into along-track and sideways.
  let vAlong = s.vel.x * hx + s.vel.z * hz;
  let vSide = s.vel.x * hz - s.vel.z * hx;
  const sliding = s.sliding || s.gear < 0.98 || s.gearLegsDown < 2;
  // Forward forces: thrust and drag along the ground (from acc), friction.
  const fwdAcc = acc.x * hx + acc.z * hz;
  const mu = sliding ? T.slideFriction + gnd.friction : (gnd.friction + (c.brake ? T.brakeFriction : 0));
  const fric = (mu * N) / m;
  vAlong += fwdAcc * dt;
  if (Math.abs(vAlong) <= fric * dt) vAlong = 0;
  else vAlong -= Math.sign(vAlong) * fric * dt;
  // Tyres resist sideways motion.
  const sideFric = ((sliding ? 0.5 : T.sideFriction) * N) / m;
  if (Math.abs(vSide) <= sideFric * dt) vSide = 0;
  else vSide -= Math.sign(vSide) * sideFric * dt;

  // Yaw: rudder (with slipstream), torque swing and the taildragger's
  // instability — with the CG behind the main wheels, a yaw rate feeds
  // itself once rolling, and must be caught with rudder.
  const slip = Math.atan2(vSide, Math.max(1, Math.abs(vAlong)));
  const slipstream = (thrust / m) * 3;
  const rudderAuth = clamp((V + slipstream) / 35, 0.1, 1) * T.groundRudder * mods.rudder;
  const powerFrac = clamp(s.throttle, 0, 1) * (s.engine === 'running' ? 1 : 0);
  const rolling = clamp(Math.abs(vAlong) / 5, 0, 1); // can't pivot when stationary
  const torque = -t.torque * T.groundTorque * powerFrac * clamp(1 - V / (vs * 1.2), 0, 1) * rolling;
  const instability = sliding ? 0 : T.groundInstability * s.r * clamp(Math.abs(vAlong) / 20, 0, 1.5) + mods.rudderBias * 0.2 * rolling;
  let rudder: number;
  if (env.autoRudder && !sliding) {
    // Auto-rudder: holds the nose straight, less perfectly at full throttle.
    const eff = T.autoRudderGround * (1 - 0.1 * powerFrac);
    const want = (-(torque + instability) * eff - s.r * 0.8) / Math.max(rudderAuth, 0.05);
    rudder = clamp(want + c.yaw, -1, 1);
  } else rudder = clamp(c.yaw, -1, 1);
  let yawRate = (rudder * rudderAuth) * rolling + torque + instability;
  if (s.groundLooping !== 0) {
    yawRate = s.groundLooping * 2.2;
    vAlong *= 1 - dt * 1.5;
  }
  if (s.sliding) yawRate *= 0.3;
  s.r += (yawRate - s.r) * Math.min(1, dt * 4);
  s.r = clamp(s.r, -2.5, 2.5);
  s.groundHeading += s.r * dt;
  if (!sliding && s.groundLooping === 0 && V > 7 && (Math.abs(slip) > T.groundLoopSlip || Math.abs(s.r) > T.groundLoopRate)) {
    s.groundLooping = s.r < 0 ? -1 : 1;
    s.events.push('groundLoop');
  }

  // Tail: comes up with speed and forward stick; held down by back stick.
  if (!sliding) {
    const tailUpWanted = (V > vs * 0.5 && c.pitch < -0.15) || (V > vs * 0.8 && c.pitch < 0.25);
    const tailDown = V < vs * 0.35 || c.pitch > 0.45;
    if (tailUpWanted && !tailDown) s.tailUp = Math.min(1, s.tailUp + dt * (V > vs * 0.6 ? 1.2 : 0.4));
    else if (tailDown || V < vs * 0.5) s.tailUp = Math.max(0, s.tailUp - dt * 0.8);
    // Tail up too early with the stick hard forward: it wallows, the nose digs in.
    let pitchTarget = t.groundAttitude * (1 - s.tailUp) - (c.pitch < -0.6 && s.tailUp > 0.9 ? (-c.pitch - 0.6) * 0.25 : 0);
    if (c.brake && s.tailUp > 0.5 && V > 10) pitchTarget -= 0.08;
    if (gnd.soft && V > 12) pitchTarget -= 0.04;
    s.groundPitch += (pitchTarget - s.groundPitch) * Math.min(1, dt * 3);
    if (s.groundPitch < T.noseOverPitch && V > 5) {
      s.events.push('noseOver');
      s.sliding = true;
      vAlong *= 0.2;
    }
  } else {
    s.groundPitch += (t.groundAttitude * 0.15 - s.groundPitch) * Math.min(1, dt * 3);
  }
  s.vel.x = hx * vAlong + hz * vSide;
  s.vel.z = hz * vAlong - hx * vSide;
  s.vel.y = 0;
  s.pos.addScaled(s.vel, dt);
  // Lift-off when the wing carries the weight (after the take-off run).
  const contactH = s.gear > 0.5 && !s.sliding ? t.gearHeight : 0.55;
  s.pos.y = env.groundAt(s.pos.x, s.pos.z).h + contactH;
  if (!sliding && lift > m * G * 1.01 && V > vs * 0.95) {
    s.onGround = false;
    s.vel.y = 0.5;
    s.events.push('liftoff');
    s.q = Quat.fromEuler(s.groundHeading, s.groundPitch, 0);
    return;
  }
  s.q = Quat.fromEuler(s.groundHeading, s.groundPitch, s.sliding ? 0.04 : 0);
  if (Math.hypot(s.vel.x, s.vel.z) < 0.3 && s.throttle < 0.15 && (s.sliding || c.brake || s.groundLooping)) {
    s.stopped = s.sliding || s.groundLooping !== 0;
    s.vel.set(0, 0, 0);
    if (s.stopped) s.events.push('stopped');
  }
  if (s.groundLooping !== 0 && Math.hypot(s.vel.x, s.vel.z) < 1) {
    s.stopped = true;
    s.events.push('stopped');
  }
  s.p = 0;
  s.qr = 0;
}
