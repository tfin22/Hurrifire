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

  effects: {
    /** G at which greying starts, and the G-seconds of reserve before full blackout. */
    greyStartG: 4.6,
    blackoutG: 6.2,
    gTolerancePerSec: 0.55,
    gRecoveryPerSec: 0.35,
    redoutStartG: -2.0,
    stallBuffetShakePx: 2,
    cloudFadeRate: 2.5,
    sunDazzleConeDeg: 14,
  },
};

export type Tuning = typeof TUNING;
