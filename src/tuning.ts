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
    fogSteps: [9000, 16000, 26000] as const,
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
