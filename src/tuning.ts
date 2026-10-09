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
    terrainNearM: 3500,
    terrainMidM: 14000,
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
    /** Short of that stick travel, the wing is held just below the stall (buffeting). */
    stallStick: 0.88,
    softStall: 0.97,
    /** Stick-to-G curve when pulling (1 = linear; higher = gentler small pulls). */
    pullCurve: 1.5,
    /** Fraction of forward stick travel that unloads to zero G; the rest goes negative. */
    pushToZeroG: 0.7,
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
    cutoutG: -0.2,
    /** Seconds of negative G before the Merlin cuts out. */
    cutoutDelay: 0.25,
    /** Seconds of rough running after the negative G ends. */
    cutoutRecover: 0.8,
    /** Fuel fraction at which the engine starts to cough and surge. */
    coughFuelFrac: 0.012,
    tempRate: 0.05,
    seizeTemp: 140,
    /** Sliding on the belly (or as a wreck): this much friction, plus the surface's rolling friction. */
    slideFriction: 0.45,
    /** A heavy elevator (the 109) held full back at speed: trim wound in per second (0..1), and how much of the lost G it gives back. */
    trimRate: 0.3,
    trimGain: 0.6,
    /** The player's aircraft: stick inside this counts as neutral, which holds the path and the speed it was trimmed for. */
    trimStick: 0.05,
    /** How strongly it seeks that speed (0 = only holds the path), and limits on the correction ((V/Vtrim)² clamp). */
    trimSpeedGain: 0.6,
    trimSpeedK: [0.6, 1.4] as const,
    brakeFriction: 0.3,
    sideFriction: 0.8,
    groundRudder: 0.6,
    groundTorque: 2.2,
    /** Taildragger yaw divergence gain (per rad/s of yaw rate, scaled by speed/20 m/s). */
    groundInstability: 1.6,
    /** Auto-rudder effectiveness on the ground run (drops at full throttle). */
    autoRudderGround: 0.97,
    groundLoopSlip: 0.42,
    /** Yaw rate (rad/s) on the ground run that becomes a ground loop. */
    groundLoopRate: 0.9,
    noseOverPitch: -0.12,
    /** Spitfire hand pump: seconds per stroke, strokes per second of wobble, and how much it wobbles the stick. */
    pumpStrokeSecs: 0.4,
    pumpRate: 1.25,
    pumpWobble: 0.16,
  },

  guns: {
    /** Linear air drag on rounds (1/s): a .303 slows from 745 to ~550 m/s in a second. */
    dragPerSec: 0.3,
    maxLife: 2.6,
    /** Each simulated rifle-calibre bullet stands for this many rounds. */
    roundsPerBullet: 2,
    gunnerRange: 650,
    /** Gunner aim error (m) = (base − skill) × (3 + range / errRange). */
    gunnerErrBase: 2.2,
    gunnerErrRange: 40,
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
    /** AI against AI: how hard an attacker pulls for the lead (x the usual 6 G per radian of aim error). Pull hard or sit in lag. */
    attackGain: 3,
    /** AI against AI: a wing-loading ratio beyond this makes one the better turner (and the other the worse). */
    turnEdge: 1.1,
    /** The better turner, stuck in lag: throttle back to this to slow towards corner speed. */
    turnFightThrottle: 0.45,
    /** ...and it will fight down to this times its stall speed before running. */
    turnFightStall: 1.25,
    /** The worse turner gives up a turning fight after this long without the lead (s). */
    refuseTurnAfter: 5,
    /** AI against AI: aim wander grows by 1 for every this many m/s of closing speed above `closureEasy` (head-on passes are hard). */
    closureEasy: 50,
    closureHard: 80,
    /** AI against AI: fire inside this aim error (deg) as well as when the lead sits inside a wingspan. */
    snapDeg: { green: 4, average: 2.5, experte: 2 } as Record<string, number>,
    /** How well a pilot judges when to start a pull-out, drawn afresh each dive (1 = right): green pilots sometimes leave it too late. */
    pullOutJudgement: { green: [0.45, 1.05], average: [1, 1.1], experte: [1, 1] } as Record<string, readonly [number, number]>,
    /** An out-turned 109 pushes over and dives away down to this airspeed (m/s IAS), not just when fast. */
    buntMinIasOutTurned: 60,
    /** Having dived away, a fighter this close to its bingo fuel (fraction) goes home rather than coming back. */
    goHomeMargin: 0.08,
    /** A Spitfire or Hurricane with a 109 (heavy elevator) behind: the chance it dives for the deck rather than breaking, between these heights (m). */
    diveOutChance: 0.4,
    /** ...only with him still out of gun range (m): from close behind, a straight dive is just a better target. */
    diveOutMinRange: 700,
    diveOutMinAgl: 1200,
    diveOutMaxAgl: 6000,
    /** How fast (rad/s) a pilot can roll the wings level to pull out of a dive, slow and fast (ailerons stiffen with speed). */
    recoveryRollRate: [1.8, 0.45] as const,
    /** ...between these airspeeds (m/s IAS). */
    recoveryRollIas: [100, 250] as const,
    extendSeconds: 6,
    zoomSeconds: 6,
    buntSeconds: 1.3,
    diveSeconds: 7,
    /** Spotting multiplier for a pilot holding a tight vic (watching the leader, not the sky). */
    vicSpotFactor: 0.45,
    /** Seconds after a fatal hit before crew start to jump. */
    bailDelay: [2, 6] as const,
    /**
     * Enemy difficulty (a setting): a grade shift, then multipliers on top.
     * Flight school: a grade greener and sloppier with it. Veterans of the
     * Spanish Civil War: a grade sharper, better eyes, aim and reactions.
     * Arcade's own grade off still applies on top.
     */
    enemy: {
      school: { shift: -1, aim: 0.7, spot: 0.8, think: 1.4, gLimit: -0.5, wander: 3.5 },
      normal: { shift: 0, aim: 1, spot: 1, think: 1, gLimit: 0, wander: 1 },
      veteran: { shift: 1, aim: 1.12, spot: 1.15, think: 0.8, gLimit: 0.3, wander: 0.6 },
    },
    /** Escorts hear "bombers under attack": they learn of the attacker this long after (s), if within range (m). */
    escortReaction: { green: 6, average: 3.5, experte: 2 } as Record<string, number>,
    escortAlarmRange: 5000,
    /** How long an alarm stays fresh (s). */
    escortAlarmMemory: 20,
    /** Bomber crews' nerve: starting value by skill; at zero they jettison and turn for home. */
    bomberNerve: { green: 0.75, average: 1.0, experte: 1.3 } as Record<string, number>,
    /** Nerve lost to a burst of fire (at most once per `nerveHitGap` s). */
    nerveHit: 0.1,
    nerveHitGap: 2,
    /** Nerve lost to a fighter coming head-on through the formation. */
    nerveHeadOn: 0.3,
    headOnRange: 700,
    headOnDeg: 25,
    /** A head-on pass counts if the fighter is firing, or passes this close (m); one per this many s. */
    headOnClose: 200,
    headOnGap: 4,
    /** Nerve lost when a bomber close by goes down, within this range (m). */
    nerveLoss: 0.25,
    lossRange: 800,
    /** Crews on the bomb run are committed: nerve losses scaled by this. */
    bombRunNerve: 0.5,
    /** Nerve regained per second, after this long unmolested (s). */
    nerveRecovery: 0.015,
    nerveCalm: 15,
  },

  campaign: {
    /** Sorties a reprimand (written up) puts promotion back by. */
    writeUpSorties: 3,
    /** Pilots on strength at the start, and the level replacements top up to. */
    startPilots: 18,
    establishment: 16,
    /** Aircraft on strength, and the level replacements top up to. */
    startAircraft: 16,
    /** Aircraft in a squadron scramble, and in a flight. */
    squadronSize: 12,
    flightSize: 6,
    /** Fatigue added per sortie flown, recovered per night off. */
    fatiguePerSortie: 0.13,
    fatigueRecovery: 0.22,
    /** Above this a pilot is stood down for a rest. */
    fatigueRest: 0.8,
    /** Airfield damage per bomb that burst on it (1 = closed). */
    damagePerBomb: 0.025,
    /** Airfield damage repaired per day. */
    repairPerDay: 0.25,
    /** An airfield with this much damage cannot operate. */
    closedAt: 0.6,
    /** Off-screen: chance per day a sector station is bombed in the airfields phase. */
    airfieldRaidChance: 0.22,
    /** Off-screen: chance per sortie that a pilot is lost, by phase. */
    lossPerSortie: { channel: 0.016, airfields: 0.034, london: 0.03, jabo: 0.012 },
    /** Off-screen: chance per sortie that a pilot shoots something down. */
    killPerSortie: { channel: 0.06, airfields: 0.09, london: 0.1, jabo: 0.03 },
    /** Off-screen: chance a raid met by the squadron turns back. */
    turnBackChance: 0.3,
    /** Off-screen loss multiplier for the tight vic (pairs = 1). */
    vicLossFactor: 1.35,
    /** Skill: average after this many sorties; experte after more and some kills. */
    averageAfter: 8,
    experteAfter: 25,
    experteKills: 3,
    /** Promotion to Flight Lieutenant: sorties and victories, or sorties alone. */
    fltLtSorties: 10,
    fltLtKills: 2,
    fltLtSortiesAlone: 18,
    /** Promotion to Squadron Leader: sorties at F/Lt and victories, or total sorties. */
    sqnLdrSortiesAtRank: 8,
    sqnLdrKills: 5,
    sqnLdrSortiesAlone: 40,
    /** Sorties needed to fill a vacancy left by a loss. */
    vacancySorties: 5,
    /** Days in hospital when wounded. */
    woundedDays: [4, 14] as [number, number],
  },

  escort: {
    /** Fuel left at the rendezvous over Cap Gris Nez (fraction). */
    startFuel: 0.8,
    /** The red low-fuel lamp (fraction): about ten minutes at cruise. */
    redLight: 0.2,
    /** RAF squadrons sent up: when (s after the start), what, how many, height offset and lead (m ahead of the raid). */
    raf: [
      { at: 300, type: 'hurricane', n: 12, alt: -900, ahead: 16000, skill: 'average' },
      { at: 540, type: 'spitfire', n: 12, alt: 1500, ahead: 12000, skill: 'average' },
      { at: 900, type: 'hurricane', n: 9, alt: -400, ahead: 9000, skill: 'green' },
      { at: 1500, type: 'spitfire', n: 6, alt: 600, ahead: -6000, skill: 'experte' },
    ] as { at: number; type: 'hurricane' | 'spitfire'; n: number; alt: number; ahead: number; skill: 'green' | 'average' | 'experte' }[],
    /** Seconds back over France with no enemy near before the sortie ends. */
    safeAfter: 20,
    /** No enemy within this range counts as clear (m). */
    clearRange: 8000,
  },

  sortie: {
    /** Seconds of cranking before the engine catches (or doesn't). */
    crankToCatch: 2.2,
    /** Tally-ho needs an enemy within this range (m). */
    tallyRange: 9000,
    /** Seconds before the controller answers a homing request. */
    homingDelay: 3,
    /** A forced landing in a sound aircraft is written up unless fuel is below this fraction. */
    writeUpFuel: 0.06,
    /** Leading: the squadron goes in by itself once an enemy is this close (m), or you open fire, or one of you is hit. */
    autoTallyRange: 2500,
    /** A Mayday or a wingman's call to air-sea rescue adds this to the chance of being picked up. */
    asrBonus: 0.25,
    /** The controller warns of a free hunt that comes within this range of you (m). */
    huntWarnRange: 15000,
    /** Asking for help: only against a raid this strong (aircraft, radar estimate). */
    helpMinStrength: 10,
    /** Wingmen's "break!" calls: an enemy fighter on your tail inside this range (m), at most this often (s). */
    breakCallRange: 800,
    breakCallEvery: 12,
  },

  controller: {
    firstVectorDelay: 20,
    vectorEvery: 75,
    /** "Bandits N miles" calls inside this range (m). */
    closeRange: 16000,
    closeEvery: 45,
    /** Plot position error (m, full width). */
    plotError: 3000,
    /** Speed the controller assumes the squadron makes good in the climb (m/s). */
    assumedSpeed: 105,
    /** Long intercepts get "buster". */
    busterTime: 420,
    /** Don't pancake before this many seconds. */
    minSortie: 240,
  },

  /**
   * A living sky: more than one raid at a time, 109s hunting on their own,
   * and other squadrons up besides yours. Mostly it's empty and calm; now
   * and then it's chaos.
   */
  sky: {
    /** Raids at once, by phase: weights for one, two, three. */
    raidCount: { channel: [6, 3, 1], airfields: [5, 4, 2], london: [2, 5, 3], jabo: [6, 3, 1] } as Record<string, number[]>,
    /** Chance a free hunt of 109s is roving over Kent as well. */
    freeHuntChance: { channel: 0.25, airfields: 0.4, london: 0.45, jabo: 0.5 } as Record<string, number>,
    /** Each later raid starts this long after the one before (s). */
    raidGap: [150, 420] as const,
    /** Squadrons from other sectors sent against each raid: weights for none, one, two. */
    othersPerRaid: [2, 5, 3],
    /** 12 Group's big wing, in the London phase: chance, and squadrons in it. */
    bigWingChance: 0.5,
    bigWingSquadrons: 3,
    /** Other squadrons turn into real aircraft inside this range of you (m), or of a raid in sight. */
    friendSpawnRange: 15000,
    /** Abstract climb rate (m/s) and cruise (m/s) of a squadron nobody can see. */
    climbRate: 11,
    cruise: 105,
    /** Out of sight, a squadron meeting a raid fights it in rounds of this many seconds... */
    fightRound: 20,
    /** ...each round: chance a bomber goes down, chance the raid turns back, chance we lose one. */
    roundKill: 0.35,
    roundTurnBack: 0.06,
    roundLoss: 0.08,
    /** Rounds before they're out of ammunition and go home. */
    fightRounds: 12,
    /** Formations other than the one you were vectored on are marked only inside this range (m), and never in the sun. */
    strayMarkRange: 9000,
    /** Out of everyone's sight, an aircraft that has gone home is put down at its base beyond this range (m). */
    retireRange: 30000,
  },

  claims: {
    /** A target you hit hard and saw smoking/diving away gets claimed as destroyed this often. */
    overclaimSmoking: 0.6,
    /** Damage fraction that counts as "hit hard" for a claim. */
    heavyDamage: 0.35,
  },

  landing: {
    /** Each of these is the edge of "acceptable" for that factor (severity 1.0). */
    sinkLimit: 3.0,
    bankLimit: 0.17,
    driftLimit: 0.2,
    /** Touching down faster than this × stall speed starts to count as too fast. */
    fastRatio: 1.25,
    fastSpan: 0.3,
    noseDownLimit: 0.06,
    /** Severity thresholds. */
    greaserEdge: 0.6,
    bounceEdge: 0.85,
    damageEdge: 1.5,
    crashEdge: 2.4,
    bellyOk: 1.6,
    groundLoopEdge: 1.0,
    /** Width of the band either side of a threshold where luck decides. */
    borderline: 0.12,
    /** Three-point attitude counts if pitch ≥ this fraction of the type's ground attitude. */
    threePointFrac: 0.6,
    bounceRestitution: 0.35,
    maxBounceVy: 4,
    /** Only genuinely bad impacts kill: */
    fatalSink: 9,
    fatalNose: 4,
    fatalBank: 0.75,
    fatalFire: 0.6,
    ditchSink: 2.5,
    marshNoseOverSpeed: 15,
    ploughNoseOverSpeed: 24,
    obstacleHarmless: 4,
    obstacleWoundSpeed: 20,
    obstacleFatalSpeed: 30,
    /** Rolling friction by surface with wheels, braking, and sliding on the belly. */
    rollMu: { airfield: 0.06, pasture: 0.08, stubble: 0.09, chalk: 0.08, ploughed: 0.2, marsh: 0.3, beach: 0.15 } as Record<string, number>,
    brakeMu: 0.18,
    bellyMu: 0.5,
  },

  assist: {
    /** Enemy markers appear inside this range (m). */
    markerRange: 4000,
  },

  spotting: {
    /** Formations are marked out to this range (m); reported raids to twice it. */
    groupRange: 45000,
    /** Aircraft this close to one another are one formation (m). */
    groupJoin: 2500,
    /** Inside this range a formation breaks into individually marked aircraft (m). */
    individualRange: 4500,
    /** Type labels on at most this many aircraft at once. */
    maxLabels: 6,
  },

  /** Arcade mode: the player's aircraft and the fight made friendlier. */
  arcade: {
    /** Extra engine thrust: overhaul the bombers, out-climb trouble. */
    thrust: 1.35,
    /** Quicker pitch and roll. */
    pitch: 1.5,
    roll: 1.5,
    /** The player's rounds do this much more damage; enemy rounds this much less. */
    damageDealt: 2.5,
    damageTaken: 0.5,
    /** The sortie starts in the air this far (m) ahead of the raid on its track, to one side, and above. */
    startAhead: 6000,
    startAside: 4000,
    startAbove: 800,
    /** JUMP TO RAID (after a real take-off) needs this much height under you (m). */
    jumpMinAgl: 100,
  },

  /** The docking computer: jump to final approach after a homing. */
  docking: {
    /** Only with no enemy aircraft within this range (m). */
    clearOfEnemy: 9000,
    /** Length of the final approach it puts you on (m), and how far into the run it touches down. */
    finalM: 3000,
    touchdownIn: 80,
    /** Stick deflection that takes control back. */
    takeOver: 0.35,
  },

  /** Hit feedback: how long the hit marker and kill banner show (s), and the tick's rate limit (ms). */
  feedback: {
    hitMarker: 0.22,
    killBanner: 3,
    tickEveryMs: 55,
  },

  targets: {
    /** Big targets: enemies are drawn and hit this much larger at range... */
    scale: 3.0,
    /** ...growing from true size inside `near` metres to full scale beyond `far`. */
    near: 40,
    far: 350,
  },

  effects: {
    /** G at which greying starts, and the G-seconds of reserve before full blackout. */
    greyStartG: 5.0,
    blackoutG: 6.5,
    /** Stress per second per G above greyStartG; 1.0 = fully grey, 1.3–2.3 = blacking out. */
    gTolerancePerSec: 0.15,
    gRecoveryPerSec: 0.7,
    redoutStartG: -2.0,
    stallBuffetShakePx: 2,
    cloudFadeRate: 2.5,
    sunDazzleConeDeg: 14,
  },
};

export type Tuning = typeof TUNING;
