// The touchdown model. Pure: everything it needs is in its input, and the
// only randomness is a number passed in by the caller, used solely to make
// genuinely borderline cases uncertain.
//
// The rule: outcomes come from how you fly, not from dice. A clean approach
// is never killed by bad luck; damage makes it harder; only genuinely bad
// impacts are fatal (very high sink, steep nose-down, high speed into
// obstacles, or landing with a big fire still burning).

import type { Surface } from './ground';
import { TUNING } from '../tuning';

export type TouchdownKind =
  | 'greaser'        // clean three-pointer
  | 'bounce'         // back in the air: catch it, or it comes down harder
  | 'groundLoop'     // minor damage
  | 'noseOver'       // damaged, pilot shaken
  | 'belly'          // damaged but repairable
  | 'crashSurvived'  // write-off, pilot shaken or wounded
  | 'crashFatal'     // write-off, pilot lost
  | 'ditched'        // in the sea and got out
  | 'roll';          // rough but down: rolling out normally (wheels), not a clean three-pointer

export type AircraftCondition = 'fine' | 'minor' | 'damaged' | 'repairable' | 'writeOff';
export type PilotCondition = 'fine' | 'shaken' | 'wounded' | 'lost';

export interface TouchdownInput {
  /** Vertical speed at contact, m/s (positive down). */
  sinkRate: number;
  airspeed: number;
  /** Stall speed in the current configuration (m/s). */
  stallSpeed: number;
  groundSpeed: number;
  bank: number;
  pitch: number;
  /** Angle between track and nose (rad). */
  drift: number;
  gear: 'down' | 'partial' | 'up';
  surface: Surface;
  /** The type's three-point attitude (rad). */
  threePoint: number;
  /** 0 none … 1 about to explode. */
  fire: number;
  /** Aircraft that nose under when ditched (the Spitfire did). */
  nosesUnder?: boolean;
  /** Earlier bounces on this landing. */
  bounces?: number;
  /** In [0, 1): only consulted for borderline cases. */
  luck: number;
}

export interface TouchdownResult {
  kind: TouchdownKind;
  aircraft: AircraftCondition;
  pilot: PilotCondition;
  /** For a bounce: the upward speed it leaves the ground with. */
  bounceVy?: number;
  /** The single worst factor, for the debrief. */
  reason: string;
  /** How hard it was, 0 (feather) … 3+ (catastrophic). */
  severity: number;
}

const T = () => TUNING.landing;

type SurfaceClass = 'ideal' | 'good' | 'noseOverRisk' | 'noseOverLikely' | 'fair' | 'crash' | 'water';

/** The surface table of §5a: wheels down / wheels up. */
export function surfaceClass(s: Surface, gearDown: boolean): SurfaceClass {
  switch (s) {
    case 'airfield': return gearDown ? 'ideal' : 'good';
    case 'pasture': case 'stubble': case 'chalk': return 'good';
    case 'ploughed': return gearDown ? 'noseOverRisk' : 'good';
    case 'marsh': return gearDown ? 'noseOverLikely' : 'fair';
    case 'beach': return gearDown ? 'fair' : 'good';
    case 'orchard': case 'woodland': case 'hops': case 'town': return 'crash';
    case 'sea': case 'water': return 'water';
  }
}

/** How bad the contact itself was, component by component (1.0 = the edge of acceptable). */
export function severityParts(i: TouchdownInput) {
  const L = T();
  const k = i.airspeed / Math.max(1, i.stallSpeed);
  return {
    sink: i.sinkRate / L.sinkLimit,
    bank: Math.abs(i.bank) / L.bankLimit,
    drift: Math.abs(i.drift) / L.driftLimit,
    speed: Math.max(0, (k - L.fastRatio) / L.fastSpan),
    nose: i.pitch < 0 ? -i.pitch / L.noseDownLimit : 0,
  };
}

function worst(parts: Record<string, number>): [string, number] {
  let wk = 'none', wv = 0;
  for (const [k, v] of Object.entries(parts)) if (v > wv) { wk = k; wv = v; }
  return [wk, wv];
}

const REASON: Record<string, string> = {
  sink: 'came down too hard', bank: 'a wingtip touched', drift: 'touched down drifting sideways',
  speed: 'too fast', nose: 'nose-down', none: 'a good landing',
};

/** Is this impact bad enough to kill? Only genuinely bad ones are. */
function fatal(i: TouchdownInput, p: ReturnType<typeof severityParts>): boolean {
  const L = T();
  if (i.sinkRate > L.fatalSink) return true;
  if (p.nose > L.fatalNose && i.airspeed > i.stallSpeed * 1.1) return true;
  if (Math.abs(i.bank) > L.fatalBank && i.groundSpeed > 30) return true;
  if (i.fire > L.fatalFire) return true;
  return false;
}

export function evaluateTouchdown(i: TouchdownInput): TouchdownResult {
  const L = T();
  const gearDown = i.gear === 'down';
  const sc = surfaceClass(i.surface, gearDown);
  const p = severityParts(i);
  const [wk, wv] = worst(p);
  // Earlier bounces make each contact count for more.
  const S = wv * (1 + (i.bounces ?? 0) * 0.15);
  const reason = REASON[wk];
  const borderline = (edge: number) => Math.abs(S - edge) < L.borderline;
  const over = (edge: number) => (borderline(edge) ? i.luck < 0.5 + (S - edge) / (2 * L.borderline) : S > edge);
  const withFire = (r: TouchdownResult): TouchdownResult => {
    if (i.fire <= 0 || r.pilot === 'lost') return r;
    // Down with a fire: the aircraft is lost; a quick exit means burns at worst.
    return { ...r, aircraft: 'writeOff', pilot: i.fire > L.fatalFire ? 'lost' : r.pilot === 'fine' ? 'shaken' : 'wounded', reason: r.reason + ', still burning' };
  };

  // ---- Water: ditching.
  if (sc === 'water') {
    const pitchOk = i.pitch > 0.02 && i.pitch < 0.25;
    const gentle = i.sinkRate < L.ditchSink && i.airspeed < i.stallSpeed * 1.35 && Math.abs(i.bank) < 0.12;
    const noseUnder = (i.nosesUnder ? 1 : 0) + (gearDown ? 1 : 0);
    if (gentle && pitchOk && noseUnder < 2) {
      return { kind: 'ditched', aircraft: 'writeOff', pilot: noseUnder ? 'shaken' : 'fine', reason: 'ditched', severity: S };
    }
    if (i.sinkRate < L.ditchSink * 2 && Math.abs(i.bank) < 0.35 && i.pitch > -0.1) {
      return { kind: 'ditched', aircraft: 'writeOff', pilot: 'wounded', reason: 'ditched heavily', severity: S + 1 };
    }
    return { kind: 'crashFatal', aircraft: 'writeOff', pilot: 'lost', reason: 'went in hard and nosed under', severity: S + 2 };
  }

  // ---- Trees, hop wires, buildings: always a crash; the speed decides the rest.
  if (sc === 'crash') {
    if (fatal(i, p) || i.groundSpeed > L.obstacleFatalSpeed) {
      return { kind: 'crashFatal', aircraft: 'writeOff', pilot: 'lost', reason: `into ${i.surface === 'town' ? 'buildings' : i.surface === 'hops' ? 'the hop wires' : 'trees'} too fast`, severity: S + 2 };
    }
    return withFire({ kind: 'crashSurvived', aircraft: 'writeOff', pilot: i.groundSpeed > L.obstacleWoundSpeed ? 'wounded' : 'shaken', reason: `into ${i.surface === 'town' ? 'buildings' : 'trees'}`, severity: S + 1 });
  }

  if (fatal(i, p)) return { kind: 'crashFatal', aircraft: 'writeOff', pilot: 'lost', reason, severity: S + 2 };

  // ---- Wheels up: a deliberate belly landing is the smart call.
  if (i.gear === 'up') {
    if (!over(L.bellyOk)) return withFire({ kind: 'belly', aircraft: 'repairable', pilot: 'fine', reason: 'belly landing', severity: S });
    if (!over(L.crashEdge)) return withFire({ kind: 'crashSurvived', aircraft: 'writeOff', pilot: 'shaken', reason, severity: S });
    return withFire({ kind: 'crashSurvived', aircraft: 'writeOff', pilot: 'wounded', reason, severity: S });
  }

  // ---- One leg down: ground loop or worse.
  if (i.gear === 'partial') {
    if (!over(L.groundLoopEdge)) return withFire({ kind: 'groundLoop', aircraft: 'damaged', pilot: 'fine', reason: 'one leg collapsed', severity: S + 0.5 });
    return withFire({ kind: 'crashSurvived', aircraft: 'writeOff', pilot: 'shaken', reason: 'one leg collapsed', severity: S + 1 });
  }

  // ---- Wheels down.
  if (over(L.crashEdge)) {
    return withFire({ kind: 'crashSurvived', aircraft: 'writeOff', pilot: S > L.crashEdge * 1.4 ? 'wounded' : 'shaken', reason: `${reason}; the undercarriage gave way`, severity: S });
  }
  if (over(L.damageEdge)) {
    if (wk === 'bank' || wk === 'drift') return withFire({ kind: 'groundLoop', aircraft: 'minor', pilot: 'fine', reason, severity: S });
    if (wk === 'nose') return withFire({ kind: 'noseOver', aircraft: 'damaged', pilot: 'shaken', reason, severity: S });
    return withFire(bounce(i, S, reason));
  }
  // Soft or rough surfaces with wheels: the nose wants to go over.
  if (sc === 'noseOverLikely' && (i.groundSpeed > L.marshNoseOverSpeed || S > 0.4)) {
    return withFire({ kind: 'noseOver', aircraft: 'damaged', pilot: 'shaken', reason: 'wheels dug into soft ground', severity: S + 0.5 });
  }
  if (sc === 'noseOverRisk' && (i.groundSpeed > L.ploughNoseOverSpeed || i.pitch < i.threePoint * 0.5)) {
    return withFire({ kind: 'noseOver', aircraft: 'damaged', pilot: 'shaken', reason: 'wheels caught in the furrows', severity: S + 0.5 });
  }
  if (over(L.bounceEdge) && (wk === 'sink' || wk === 'speed')) return withFire(bounce(i, S, reason));
  const threePoint = i.pitch >= i.threePoint * L.threePointFrac;
  if (S < L.greaserEdge && threePoint) return withFire({ kind: 'greaser', aircraft: 'fine', pilot: 'fine', reason: 'a clean three-pointer', severity: S });
  return withFire({ kind: 'roll', aircraft: 'fine', pilot: 'fine', reason: threePoint ? 'a firm arrival' : 'a wheel landing', severity: S });
}

function bounce(i: TouchdownInput, S: number, reason: string): TouchdownResult {
  const L = T();
  const k = i.airspeed / Math.max(1, i.stallSpeed);
  const vy = Math.min(L.maxBounceVy, i.sinkRate * L.bounceRestitution + Math.max(0, k - 1.15) * 3);
  return { kind: 'bounce', aircraft: 'fine', pilot: 'fine', bounceVy: vy, reason: reason === 'a good landing' ? 'bounced' : reason, severity: S };
}

/** Hitting an obstacle during the roll-out at a given speed. */
export function obstacleImpact(speed: number, obstacle: 'hedge' | 'trees' | 'buildings' | 'water' | 'crater', gearDown: boolean): TouchdownResult | null {
  const L = T();
  if (speed < L.obstacleHarmless) return null;
  const what = obstacle === 'hedge' ? 'the hedge' : obstacle === 'crater' ? 'a bomb crater' : obstacle;
  if (obstacle === 'crater') {
    if (speed < 12) return { kind: 'noseOver', aircraft: 'damaged', pilot: 'shaken', reason: `ran into ${what}`, severity: 1.2 };
    return { kind: 'crashSurvived', aircraft: 'writeOff', pilot: speed > 25 ? 'wounded' : 'shaken', reason: `ran into ${what}`, severity: 2 };
  }
  const hard = obstacle === 'trees' || obstacle === 'buildings';
  if (speed > (hard ? L.obstacleFatalSpeed * 0.75 : L.obstacleFatalSpeed)) return { kind: 'crashFatal', aircraft: 'writeOff', pilot: 'lost', reason: `ran into ${what} at speed`, severity: 3 };
  if (speed > (hard ? 10 : 16)) return { kind: 'crashSurvived', aircraft: 'writeOff', pilot: speed > L.obstacleWoundSpeed ? 'wounded' : 'shaken', reason: `ran into ${what}`, severity: 2 };
  if (!gearDown) return { kind: 'belly', aircraft: 'repairable', pilot: 'fine', reason: `slid into ${what}`, severity: 1 };
  return { kind: 'noseOver', aircraft: 'damaged', pilot: 'shaken', reason: `tipped up in ${what}`, severity: 1.2 };
}

/** Roll-out distance (m) from a touchdown ground speed on a surface. */
export function rolloutDistance(groundSpeed: number, surface: Surface, gearDown: boolean, braking = true): number {
  const L = T();
  const mu = gearDown ? (L.rollMu[surface] ?? 0.1) + (braking ? L.brakeMu : 0) : L.bellyMu;
  return (groundSpeed * groundSpeed) / (2 * mu * 9.81);
}

const ORDER: TouchdownKind[] = ['greaser', 'roll', 'bounce', 'groundLoop', 'belly', 'noseOver', 'ditched', 'crashSurvived', 'crashFatal'];
const PILOT_ORDER: PilotCondition[] = ['fine', 'shaken', 'wounded', 'lost'];
const AC_ORDER: AircraftCondition[] = ['fine', 'minor', 'repairable', 'damaged', 'writeOff'];

/** Combine two results, keeping the worse of each part. */
export function worseOf(a: TouchdownResult | null, b: TouchdownResult | null): TouchdownResult | null {
  if (!a) return b;
  if (!b) return a;
  const k = ORDER.indexOf(a.kind) >= ORDER.indexOf(b.kind) ? a : b;
  return {
    ...k,
    pilot: PILOT_ORDER[Math.max(PILOT_ORDER.indexOf(a.pilot), PILOT_ORDER.indexOf(b.pilot))],
    aircraft: AC_ORDER[Math.max(AC_ORDER.indexOf(a.aircraft), AC_ORDER.indexOf(b.aircraft))],
  };
}
