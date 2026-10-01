// Aircraft performance and equipment. These aim for plausible *relative*
// performance, not exact historical figures (see DECISIONS.md).
// SI units: kg, m, m², W, m/s, radians.

export type AircraftId = 'spitfire' | 'hurricane' | 'bf109' | 'bf110' | 'do17' | 'he111' | 'ju88' | 'ju87';
export type Side = 'raf' | 'lw';
export type Role = 'fighter' | 'heavyFighter' | 'bomber' | 'diveBomber';

export interface GunType {
  name: string;
  /** Rounds per second. */
  rate: number;
  muzzle: number;
  /** Damage per round. */
  damage: number;
  /** Explosive shells start fires more readily and tear structure. */
  explosive: boolean;
  /** Dispersion half-angle (rad). */
  spread: number;
  tracerEvery: number;
}

export const GUNS = {
  browning303: { name: '.303 Browning', rate: 19.2, muzzle: 745, damage: 1, explosive: false, spread: 0.0035, tracerEvery: 5 },
  mg17: { name: 'MG 17', rate: 19.5, muzzle: 755, damage: 1, explosive: false, spread: 0.004, tracerEvery: 4 },
  mgff: { name: 'MG FF 20mm', rate: 8.7, muzzle: 600, damage: 7, explosive: true, spread: 0.005, tracerEvery: 3 },
  mg15: { name: 'MG 15', rate: 16, muzzle: 755, damage: 1, explosive: false, spread: 0.008, tracerEvery: 3 },
} satisfies Record<string, GunType>;
export type GunId = keyof typeof GUNS;

export interface GunMount {
  gun: GunId;
  /** Body position (m). */
  pos: [number, number, number];
  rounds: number;
  /** Fired by the forward trigger (pilot) or a gunner. */
}

export interface Gunner {
  name: string;
  pos: [number, number, number];
  /** Centre of the firing arc (body direction) and its half-angle (rad). */
  dir: [number, number, number];
  arc: number;
  gun: GunId;
  rounds: number;
}

export type ZoneId =
  | 'engine' | 'engineL' | 'engineR' | 'radiator' | 'oil' | 'fuel' | 'fuelL' | 'fuelR'
  | 'aileron' | 'elevator' | 'rudder' | 'wingL' | 'wingR' | 'fuselage' | 'tail'
  | 'pilot' | 'crew' | 'gear' | 'flaps';

export interface ZoneDef {
  id: ZoneId;
  pos: [number, number, number];
  r: number;
  hp: number;
}

export interface AircraftType {
  id: AircraftId;
  name: string;
  short: string;
  side: Side;
  role: Role;
  crew: number;
  /** Loaded mass without fuel (kg). */
  emptyMass: number;
  fuelCapacity: number; // kg
  wingArea: number;
  span: number;
  length: number;
  cd0: number;
  oswald: number;
  clAlpha: number;
  cl0: number;
  alphaStall: number;
  flapCl: number;
  flapCd: number;
  gearCd: number;
  /** Per engine. */
  power: number;
  engines: number;
  propEff: number;
  /** Full-throttle height (m): power holds to here, then falls away. */
  critAlt: number;
  /** Power lapse scale height above critAlt (m). */
  lapse: number;
  /** Speed below which thrust stops rising (static thrust limit). */
  thrustV0: number;
  /** Compressibility / high-speed drag rise starts here (TAS m/s). */
  dragRiseV: number;
  dragRiseK: number;
  fuelInjected: boolean;
  /** Max roll rate (rad/s), the speed it peaks at, and where ailerons get heavy. */
  rollRate: number;
  rollPeakV: number;
  rollHeavyV: number;
  /** Max load factor the pilot can pull (stick force / structure). */
  maxG: number;
  minG: number;
  /** Elevator response gain (1/s). */
  pitchGain: number;
  /** Structural speed limit (TAS m/s) — above this things start to break. */
  vne: number;
  /** Best glide speed (IAS m/s) and gliding ratio, used by Assist and the glide-range tests. */
  bestGlide: number;
  /** Fuel burn at full power (kg/s, all engines). */
  fuelBurn: number;
  /** Emergency boost: power multiplier and seconds available before overheating. */
  boostMul: number;
  boostSeconds: number;
  /** Take-off torque swing (rad of sideslip at full power, zero speed). */
  torque: number;
  /** Three-point ground attitude (rad nose-up) and ground height of CG (m). */
  groundAttitude: number;
  gearHeight: number;
  gear: 'pump' | 'hydraulic' | 'fixed';
  /** Hand-pump strokes to raise (Spitfire Mk I). */
  pumpStrokes: number;
  /** Damage robustness multiplier on zone HP. */
  robust: number;
  /** Forward guns (pilot's trigger). */
  guns: GunMount[];
  gunners: Gunner[];
  zones: ZoneDef[];
  /** Engine note: base pitch multiplier for the drone. */
  engineNote: number;
  /** Wingspan in feet, for the gunsight's span setting. */
  spanFt: number;
  bombLoad: number;
}

const ftSpan = (m: number) => Math.round(m * 3.28084);

const fighterZones = (len: number, span: number, nose: number): ZoneDef[] => [
  { id: 'engine', pos: [0, 0, nose - 1.2], r: 0.7, hp: 14 },
  { id: 'radiator', pos: [1.0, -0.6, 0.4], r: 0.45, hp: 6 },
  { id: 'oil', pos: [0, -0.4, nose - 0.6], r: 0.4, hp: 6 },
  { id: 'fuel', pos: [0, 0.2, 0.9], r: 0.55, hp: 9 },
  { id: 'pilot', pos: [0, 0.6, -0.2], r: 0.4, hp: 6 },
  { id: 'wingL', pos: [-span * 0.3, -0.4, 0.3], r: span * 0.22, hp: 30 },
  { id: 'wingR', pos: [span * 0.3, -0.4, 0.3], r: span * 0.22, hp: 30 },
  { id: 'aileron', pos: [span * 0.38, -0.3, -0.5], r: 0.6, hp: 8 },
  { id: 'flaps', pos: [-1.4, -0.45, -0.6], r: 0.5, hp: 6 },
  { id: 'gear', pos: [-0.9, -0.6, 0.6], r: 0.45, hp: 6 },
  { id: 'fuselage', pos: [0, 0.1, -2.2], r: 0.7, hp: 24 },
  { id: 'elevator', pos: [0, 0.2, -len * 0.48], r: 0.8, hp: 8 },
  { id: 'rudder', pos: [0, 0.9, -len * 0.5], r: 0.5, hp: 8 },
  { id: 'tail', pos: [0, 0.3, -len * 0.42], r: 0.75, hp: 22 },
];

const twinZones = (len: number, span: number, ex: number, nose: number, crewZ: number): ZoneDef[] => [
  { id: 'engineL', pos: [-ex, -0.1, 1.2], r: 0.9, hp: 16 },
  { id: 'engineR', pos: [ex, -0.1, 1.2], r: 0.9, hp: 16 },
  { id: 'fuelL', pos: [-ex * 0.6, -0.1, 0.0], r: 0.9, hp: 12 },
  { id: 'fuelR', pos: [ex * 0.6, -0.1, 0.0], r: 0.9, hp: 12 },
  { id: 'pilot', pos: [0, 0.3, nose - 1.2], r: 0.6, hp: 8 },
  { id: 'crew', pos: [0, 0.3, crewZ], r: 0.8, hp: 10 },
  { id: 'wingL', pos: [-span * 0.33, -0.1, 0], r: span * 0.2, hp: 45 },
  { id: 'wingR', pos: [span * 0.33, -0.1, 0], r: span * 0.2, hp: 45 },
  { id: 'aileron', pos: [-span * 0.4, 0, -0.8], r: 0.8, hp: 10 },
  { id: 'fuselage', pos: [0, 0, -len * 0.2], r: 1.0, hp: 40 },
  { id: 'elevator', pos: [0, 0.4, -len * 0.47], r: 1.2, hp: 12 },
  { id: 'rudder', pos: [0, 1.2, -len * 0.5], r: 0.8, hp: 10 },
  { id: 'tail', pos: [0, 0.5, -len * 0.42], r: 1.0, hp: 34 },
  { id: 'gear', pos: [ex, -0.6, 0.5], r: 0.6, hp: 8 },
  { id: 'flaps', pos: [ex * 1.1, -0.2, -1.2], r: 0.8, hp: 8 },
];

const mg15 = (name: string, pos: [number, number, number], dir: [number, number, number], arcDeg: number, drums = 8): Gunner => ({
  name, pos, dir, arc: (arcDeg * Math.PI) / 180, gun: 'mg15', rounds: 75 * drums,
});

export const AIRCRAFT: Record<AircraftId, AircraftType> = {
  spitfire: {
    id: 'spitfire', name: 'Spitfire Mk I', short: 'Spitfire', side: 'raf', role: 'fighter', crew: 1,
    emptyMass: 2440, fuelCapacity: 278, wingArea: 22.48, span: 11.23, length: 9.12,
    cd0: 0.0182, oswald: 0.86, clAlpha: 4.6, cl0: 0.12, alphaStall: 0.27, flapCl: 0.55, flapCd: 0.06, gearCd: 0.022,
    power: 768_000, engines: 1, propEff: 0.75, critAlt: 5200, lapse: 7000, thrustV0: 62,
    dragRiseV: 185, dragRiseK: 3.0, fuelInjected: false,
    rollRate: 1.7, rollPeakV: 85, rollHeavyV: 150, maxG: 7.5, minG: -3, pitchGain: 6.5, vne: 210,
    bestGlide: 72, fuelBurn: 0.085, boostMul: 1.25, boostSeconds: 300, torque: 0.09,
    groundAttitude: 0.2, gearHeight: 1.85, gear: 'pump', pumpStrokes: 18, robust: 1.0,
    guns: [-3.5, -3.1, -2.6, -2.15, 2.15, 2.6, 3.1, 3.5].map((x) => ({ gun: 'browning303' as GunId, pos: [x, -0.42 + Math.abs(x) * 0.1, 0.9] as [number, number, number], rounds: 300 })),
    gunners: [], zones: fighterZones(9.1, 11.2, 4.0), engineNote: 1.0, spanFt: 0, bombLoad: 0,
  },
  hurricane: {
    id: 'hurricane', name: 'Hurricane Mk I', short: 'Hurricane', side: 'raf', role: 'fighter', crew: 1,
    emptyMass: 2780, fuelCapacity: 300, wingArea: 23.92, span: 12.19, length: 9.84,
    cd0: 0.0218, oswald: 0.8, clAlpha: 4.5, cl0: 0.15, alphaStall: 0.315, flapCl: 0.6, flapCd: 0.07, gearCd: 0.024,
    power: 768_000, engines: 1, propEff: 0.73, critAlt: 4600, lapse: 6000, thrustV0: 58,
    dragRiseV: 170, dragRiseK: 3.5, fuelInjected: false,
    rollRate: 1.55, rollPeakV: 80, rollHeavyV: 160, maxG: 7.5, minG: -3, pitchGain: 6.0, vne: 195,
    bestGlide: 70, fuelBurn: 0.087, boostMul: 1.25, boostSeconds: 300, torque: 0.08,
    groundAttitude: 0.2, gearHeight: 1.95, gear: 'hydraulic', pumpStrokes: 0, robust: 1.5,
    guns: [-2.75, -2.55, -2.35, -2.15, 2.15, 2.35, 2.55, 2.75].map((x) => ({ gun: 'browning303' as GunId, pos: [x, -0.45, 0.8] as [number, number, number], rounds: 334 })),
    gunners: [], zones: fighterZones(9.8, 12.2, 4.2), engineNote: 0.97, spanFt: 0, bombLoad: 0,
  },
  bf109: {
    id: 'bf109', name: 'Bf 109E', short: 'Bf 109', side: 'lw', role: 'fighter', crew: 1,
    emptyMass: 2330, fuelCapacity: 290, wingArea: 16.2, span: 9.87, length: 8.64,
    cd0: 0.0225, oswald: 0.82, clAlpha: 4.4, cl0: 0.12, alphaStall: 0.29, flapCl: 0.5, flapCd: 0.06, gearCd: 0.022,
    power: 820_000, engines: 1, propEff: 0.74, critAlt: 4300, lapse: 5600, thrustV0: 58,
    dragRiseV: 205, dragRiseK: 2.0, fuelInjected: true,
    rollRate: 1.6, rollPeakV: 90, rollHeavyV: 150, maxG: 7.5, minG: -3.5, pitchGain: 6.0, vne: 225,
    bestGlide: 75, fuelBurn: 0.09, boostMul: 1.15, boostSeconds: 300, torque: 0.1,
    groundAttitude: 0.22, gearHeight: 1.8, gear: 'hydraulic', pumpStrokes: 0, robust: 1.0,
    guns: [
      { gun: 'mg17', pos: [-0.25, 0.35, 2.2], rounds: 1000 },
      { gun: 'mg17', pos: [0.25, 0.35, 2.2], rounds: 1000 },
      { gun: 'mgff', pos: [-2.0, -0.4, 0.8], rounds: 60 },
      { gun: 'mgff', pos: [2.0, -0.4, 0.8], rounds: 60 },
    ],
    gunners: [], zones: fighterZones(8.6, 9.9, 3.8), engineNote: 0.85, spanFt: 0, bombLoad: 0,
  },
  bf110: {
    id: 'bf110', name: 'Bf 110C', short: 'Bf 110', side: 'lw', role: 'heavyFighter', crew: 2,
    emptyMass: 6100, fuelCapacity: 950, wingArea: 38.4, span: 16.25, length: 12.1,
    cd0: 0.025, oswald: 0.8, clAlpha: 4.6, cl0: 0.14, alphaStall: 0.26, flapCl: 0.6, flapCd: 0.06, gearCd: 0.02,
    power: 820_000, engines: 2, propEff: 0.74, critAlt: 4500, lapse: 6500, thrustV0: 60,
    dragRiseV: 190, dragRiseK: 2.5, fuelInjected: true,
    rollRate: 0.95, rollPeakV: 100, rollHeavyV: 160, maxG: 6.0, minG: -2.5, pitchGain: 4.0, vne: 205,
    bestGlide: 80, fuelBurn: 0.17, boostMul: 1.1, boostSeconds: 300, torque: 0.02,
    groundAttitude: 0.18, gearHeight: 2.1, gear: 'hydraulic', pumpStrokes: 0, robust: 1.3,
    guns: [
      { gun: 'mg17', pos: [-0.2, 0.2, 5.0], rounds: 1000 }, { gun: 'mg17', pos: [0.2, 0.2, 5.0], rounds: 1000 },
      { gun: 'mg17', pos: [-0.25, 0.05, 5.0], rounds: 1000 }, { gun: 'mg17', pos: [0.25, 0.05, 5.0], rounds: 1000 },
      { gun: 'mgff', pos: [-0.2, -0.4, 3.0], rounds: 180 }, { gun: 'mgff', pos: [0.2, -0.4, 3.0], rounds: 180 },
    ],
    gunners: [mg15('rear gunner', [0, 0.6, -1.5], [0, 0.35, -1], 55)],
    zones: twinZones(12.1, 16.2, 2.6, 4.5, -1.5), engineNote: 0.85, spanFt: 0, bombLoad: 0,
  },
  do17: {
    id: 'do17', name: 'Do 17Z', short: 'Do 17', side: 'lw', role: 'bomber', crew: 4,
    emptyMass: 7300, fuelCapacity: 1150, wingArea: 55, span: 18.0, length: 15.8,
    cd0: 0.026, oswald: 0.8, clAlpha: 4.7, cl0: 0.15, alphaStall: 0.26, flapCl: 0.6, flapCd: 0.06, gearCd: 0.02,
    power: 750_000, engines: 2, propEff: 0.72, critAlt: 4000, lapse: 6000, thrustV0: 60,
    dragRiseV: 170, dragRiseK: 2.5, fuelInjected: false,
    rollRate: 0.8, rollPeakV: 90, rollHeavyV: 140, maxG: 4.0, minG: -1.5, pitchGain: 3.0, vne: 180,
    bestGlide: 75, fuelBurn: 0.14, boostMul: 1.05, boostSeconds: 120, torque: 0.01,
    groundAttitude: 0.18, gearHeight: 2.3, gear: 'hydraulic', pumpStrokes: 0, robust: 1.4,
    guns: [],
    gunners: [
      mg15('nose', [0, -0.1, 6.5], [0, -0.1, 1], 35),
      mg15('dorsal', [0, 0.9, 1.6], [0, 0.4, -1], 55),
      mg15('ventral', [0, -1.0, 1.2], [0, -0.45, -1], 45),
      mg15('beam', [0.6, 0.4, 2.2], [1, 0.1, -0.3], 45),
    ],
    zones: twinZones(15.8, 18, 3.0, 6.5, 1.5), engineNote: 0.8, spanFt: 0, bombLoad: 1000,
  },
  he111: {
    id: 'he111', name: 'He 111H', short: 'He 111', side: 'lw', role: 'bomber', crew: 5,
    emptyMass: 11200, fuelCapacity: 2000, wingArea: 87.6, span: 22.6, length: 16.4,
    cd0: 0.027, oswald: 0.82, clAlpha: 4.9, cl0: 0.15, alphaStall: 0.25, flapCl: 0.6, flapCd: 0.06, gearCd: 0.02,
    power: 1_000_000, engines: 2, propEff: 0.72, critAlt: 4000, lapse: 6000, thrustV0: 60,
    dragRiseV: 165, dragRiseK: 2.5, fuelInjected: true,
    rollRate: 0.55, rollPeakV: 90, rollHeavyV: 130, maxG: 3.5, minG: -1.2, pitchGain: 2.5, vne: 170,
    bestGlide: 75, fuelBurn: 0.18, boostMul: 1.05, boostSeconds: 120, torque: 0.01,
    groundAttitude: 0.16, gearHeight: 2.6, gear: 'hydraulic', pumpStrokes: 0, robust: 1.9,
    guns: [],
    gunners: [
      mg15('nose', [0, 0, 7.2], [0, -0.15, 1], 40),
      mg15('dorsal', [0, 1.3, -1.2], [0, 0.35, -1], 55),
      mg15('ventral', [0, -1.3, -0.4], [0, -0.4, -1], 45),
      mg15('beam port', [-0.9, 0.3, -1.6], [-1, 0.0, -0.2], 45),
      mg15('beam starboard', [0.9, 0.3, -1.6], [1, 0.0, -0.2], 45),
    ],
    zones: twinZones(16.4, 22.6, 3.4, 7.0, -1.0), engineNote: 0.72, spanFt: 0, bombLoad: 2000,
  },
  ju88: {
    id: 'ju88', name: 'Ju 88A', short: 'Ju 88', side: 'lw', role: 'bomber', crew: 4,
    emptyMass: 9800, fuelCapacity: 1300, wingArea: 54.5, span: 18.3, length: 14.4,
    cd0: 0.0235, oswald: 0.8, clAlpha: 4.7, cl0: 0.14, alphaStall: 0.25, flapCl: 0.6, flapCd: 0.06, gearCd: 0.02,
    power: 880_000, engines: 2, propEff: 0.74, critAlt: 4500, lapse: 6200, thrustV0: 60,
    dragRiseV: 185, dragRiseK: 2.5, fuelInjected: true,
    rollRate: 0.85, rollPeakV: 95, rollHeavyV: 150, maxG: 4.5, minG: -1.8, pitchGain: 3.2, vne: 200,
    bestGlide: 80, fuelBurn: 0.18, boostMul: 1.05, boostSeconds: 120, torque: 0.01,
    groundAttitude: 0.17, gearHeight: 2.4, gear: 'hydraulic', pumpStrokes: 0, robust: 1.5,
    guns: [{ gun: 'mg15', pos: [0.3, 0.6, 5.2], rounds: 600 }],
    gunners: [
      mg15('dorsal', [0, 1.2, 3.4], [0, 0.35, -1], 50),
      mg15('ventral', [0, -1.1, 3.0], [0, -0.4, -1], 40),
    ],
    zones: twinZones(14.4, 18.3, 2.9, 6.0, 3.0), engineNote: 0.78, spanFt: 0, bombLoad: 1400,
  },
  ju87: {
    id: 'ju87', name: 'Ju 87B Stuka', short: 'Ju 87', side: 'lw', role: 'diveBomber', crew: 2,
    emptyMass: 3900, fuelCapacity: 350, wingArea: 31.9, span: 13.8, length: 11.0,
    cd0: 0.034, oswald: 0.78, clAlpha: 4.6, cl0: 0.18, alphaStall: 0.27, flapCl: 0.6, flapCd: 0.06, gearCd: 0,
    power: 820_000, engines: 1, propEff: 0.7, critAlt: 3500, lapse: 5500, thrustV0: 55,
    dragRiseV: 165, dragRiseK: 2.5, fuelInjected: true,
    rollRate: 1.1, rollPeakV: 75, rollHeavyV: 130, maxG: 6.0, minG: -2, pitchGain: 4.0, vne: 170,
    bestGlide: 65, fuelBurn: 0.09, boostMul: 1.05, boostSeconds: 60, torque: 0.06,
    groundAttitude: 0.2, gearHeight: 2.2, gear: 'fixed', pumpStrokes: 0, robust: 1.1,
    guns: [{ gun: 'mg17', pos: [-2.3, -0.5, 0.8], rounds: 500 }, { gun: 'mg17', pos: [2.3, -0.5, 0.8], rounds: 500 }],
    gunners: [mg15('rear gunner', [0, 0.7, -1.6], [0, 0.3, -1], 55, 6)],
    zones: fighterZones(11, 13.8, 4.2), engineNote: 0.8, spanFt: 0, bombLoad: 500,
  },
};

for (const t of Object.values(AIRCRAFT)) t.spanFt = ftSpan(t.span);

export const RAF_FIGHTERS: AircraftId[] = ['spitfire', 'hurricane'];
export const LW_TYPES: AircraftId[] = ['bf109', 'bf110', 'do17', 'he111', 'ju88', 'ju87'];

/** Total mass with fuel. */
export function massOf(t: AircraftType, fuel: number): number {
  return t.emptyMass + fuel;
}

/** Clean-configuration stall speed (TAS, m/s) at density rho, 1 g. */
export function stallSpeed(t: AircraftType, mass: number, rho = 1.225, flaps = 0): number {
  const clMax = t.cl0 + t.clAlpha * t.alphaStall + flaps * t.flapCl;
  return Math.sqrt((2 * mass * 9.81) / (rho * t.wingArea * clMax));
}
