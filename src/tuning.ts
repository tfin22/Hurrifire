// Every tuning value in the game lives here (aircraft performance figures live
// in content/aircraft.ts). Values are SI unless the name says otherwise.

export const TUNING = {
  sim: {
    hz: 50,
    dt: 1 / 50,
    maxStepsPerFrame: 40,
    timeCompression: [1, 2, 4, 8] as const,
    /** Hostile within this range forces time compression back to x1 (m). */
    compressionDropRange: 9000,
  },

  input: {
    /** Stick curve: out = sign * (lin * |x| + (1 - lin) * |x|^expo). Soft centre, firm edges. */
    stickExpo: 2.2,
    stickLinear: 0.35,
    deadzone: 0.04,
    /** Floating stick radius as a fraction of margin width. */
    stickRadiusFrac: 0.33,
    tiltRangeDeg: 28,
    keyboardRampPerSec: 4.0,
    keyboardReturnPerSec: 6.0,
    throttleKeyRate: 0.6,
    gamepadDeadzone: 0.12,
  },

  render: {
    fovDeg: 62,
    near: 1.0,
    /** Aircraft drawn as a single pixel beyond this projected radius (px) ... */
    pixelBelowPx: 0.9,
    /** ... and a small cluster below this. */
    clusterBelowPx: 2.2,
    lodLowBelowPx: 9,
    lodMedBelowPx: 22,
    /** Fog: distance (m) at which each fog step applies. */
    fogSteps: [11000, 24000, 42000] as const,
    terrainNearM: 2200,
    terrainMidM: 9000,
    terrainFarM: 26000,
    terrainVeryFarM: 60000,
    retroFps: 12.5,
    cloudDrawRange: 30000,
  },

  flight: {
    /** Side force coefficient per radian of sideslip. */
    sideForce: 0.35,
    /** Dynamic pressure (Pa) for full control authority (~55 m/s at sea level). */
    qRef: 1800,
    /** How far past the stall angle full back stick can drive the wing. */
    overStall: 1.12,
    maxPitchRate: 2.0,
    /** Sideslip per unit rudder (rad). */
    rudderBeta: 0.18,
    adverseYaw: -0.03,
    /** Fraction of torque swing auto-rudder leaves uncorrected in the air. */
    autoRudderAirResidual: 0.1,
    weathercock: 3.0,
    rollLag: 9,
    wingDrop: 1.4,
    spinBuild: 0.9,
    spinRecover: 1.2,
    spinRoll: 2.6,
    spinYaw: 1.1,
    /** Load factor below which a carburetted Merlin cuts out. */
    cutoutG: -0.15,
    /** Seconds of rough running after the negative G ends. */
    cutoutRecover: 0.8,
    /** Fuel fraction at which the engine starts to cough and surge. */
    coughFuelFrac: 0.012,
    tempRate: 0.05,
    seizeTemp: 140,
    slideFriction: 0.55,
    brakeFriction: 0.3,
    sideFriction: 0.8,
    groundRudder: 0.6,
    groundTorque: 2.2,
    groundInstability: 1.4,
    /** Auto-rudder effectiveness on the ground run (drops at full throttle). */
    autoRudderGround: 0.95,
    groundLoopSlip: 0.42,
    noseOverPitch: -0.12,
  },

  guns: {
    /** Linear air drag on rounds (1/s): a .303 slows from 745 to ~550 m/s in a second. */
    dragPerSec: 0.3,
    maxLife: 2.6,
    /** Each simulated rifle-calibre bullet stands for this many rounds. */
    roundsPerBullet: 2,
    gunnerRange: 650,
    /** Seconds to change an MG 15 drum. */
    drumChange: 3.5,
    convergenceYards: [250, 300, 400] as const,
  },

  damage: {
    /** Fire intensity growth per second (reaches 1 = tank explodes). */
    fireSpread: 0.035,
    /** Chance per second a fire is blown out in a fast dive. */
    fireBlowOut: 0.04,
    fireBlowOutSpeed: 150,
    /** Glycol leak: cooling lost per unit severity. */
    glycolCooling: 0.92,
    oilPerSec: 0.02,
    /** Probabilities per point of damage. */
    pGlycolEngine: 0.12,
    pOilEngine: 0.07,
    pGlycolRadiator: 0.35,
    pOilCooler: 0.35,
    pFireFuel: 0.06,
    pFireExplosiveMul: 3,
    pWound: 0.35,
    pKillPilot: 0.06,
    pGearDamage: 0.3,
    pFlapsDamage: 0.4,
    controlDamagePerPoint: 0.12,
  },

  ai: {
    skills: {
      green: { spot: 0.65, aim: 0.3, fireRange: 520, minSpeed: 0, aggression: 0.9, gLimit: 5.0, think: 0.8 },
      average: { spot: 1.0, aim: 0.6, fireRange: 360, minSpeed: 72, aggression: 0.6, gLimit: 5.8, think: 0.5 },
      experte: { spot: 1.4, aim: 0.88, fireRange: 240, minSpeed: 88, aggression: 0.35, gLimit: 6.4, think: 0.3 },
    },
    spotting: {
      /** Range (m) at which a 10 m-span aircraft fades from view for an average pilot. */
      baseRange: 4500,
      rearFactor: 0.15,
      belowNoseFactor: 0.45,
      sunFactor: 0.08,
      groundBackFactor: 0.7,
      certainRange: 250,
      perCheck: 0.55,
      memory: 18,
      checkInterval: 0.5,
    },
    threatRange: 900,
    threatAimDeg: 30,
    threatTailDeg: 70,
    /** 109s break off for France at this fuel fraction (they have little time over England). */
    bingoFuel109: 0.42,
    groundAvoidAgl: 280,
    extendSeconds: 6,
    zoomSeconds: 6,
    buntSeconds: 1.3,
    diveSeconds: 7,
    /** Seconds after a fatal hit before crew start to jump. */
    bailDelay: [2, 6] as const,
  },

  assist: {
    /** Enemy markers appear inside this range (m). */
    markerRange: 4000,
  },

  effects: {
    /** G at which greying starts, and the G-seconds of reserve before full blackout. */
    greyStartG: 4.3,
    blackoutG: 6.2,
    /** Stress per second per G above greyStartG; 1.0 = fully grey, 1.3–2.3 = blacking out. */
    gTolerancePerSec: 0.25,
    gRecoveryPerSec: 0.5,
    redoutStartG: -2.0,
    stallBuffetShakePx: 2,
    cloudFadeRate: 2.5,
    sunDazzleConeDeg: 14,
  },
};

export type Tuning = typeof TUNING;
