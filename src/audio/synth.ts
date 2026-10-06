// The sample bank, synthesised at startup. Nothing is sampled from anywhere:
// every sound is built here from oscillators and seeded noise, then crushed
// to 8 bits at a low rate, which is most of the Amiga's character.

import { Rng } from '../core/rng';

export interface Sample {
  data: Float32Array;
  rate: number;
  /** Loop the whole sample (engines, wind, instruments). */
  loop: boolean;
  /** For pitched instruments: the frequency the sample plays at rate 1. */
  baseHz?: number;
}

/** Quantise to signed 8-bit, as Paula played it. */
export function crush8(d: Float32Array): Float32Array {
  for (let i = 0; i < d.length; i++) d[i] = Math.round(Math.max(-1, Math.min(1, d[i])) * 127) / 127;
  return d;
}

const TAU = Math.PI * 2;

function build(rate: number, secs: number, f: (t: number, i: number) => number): Float32Array {
  const n = Math.max(1, Math.round(rate * secs));
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = f(i / rate, i);
  return d;
}

/** One-pole low-pass over a buffer (in place). */
function lowpass(d: Float32Array, k: number): Float32Array {
  let y = 0;
  for (let i = 0; i < d.length; i++) { y += (d[i] - y) * k; d[i] = y; }
  return d;
}

function normalise(d: Float32Array, peak = 0.95): Float32Array {
  let m = 0;
  for (const v of d) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / m;
  return d;
}

/** A single cycle of a waveform, for looped instruments. */
function cycle(len: number, f: (ph: number) => number): Float32Array {
  const d = new Float32Array(len);
  for (let i = 0; i < len; i++) d[i] = f(i / len);
  return d;
}

/** How a V12 sounds, for `v12()`. */
export interface V12Spec {
  /** Crank rpm the loop is built at (playback rate 1). */
  rpm: number;
  /** Crank revolutions in the loop: even (a 4-stroke cycle is two). */
  revs: number;
  /** Exhaust note: the ring of each firing pulse (Hz) and how fast it dies (1/s). */
  body: number;
  decay: number;
  /** Share of each pulse that is noise rather than tone: the rasp. */
  noise: number;
  /** Second bank's pulses relative to the first: the growl at half the firing rate. */
  bank: number;
  /** Fixed spread between cylinders, and random spread cycle to cycle. */
  cylVar: number;
  cycleVar: number;
  /** Propeller blade passes per crank revolution (blades x reduction gear), and how much they throb. */
  blades: number;
  prop: number;
  /** Supercharger whine, as a harmonic of the crank, and its level. */
  whine: number;
  whineAmp: number;
  /** Chance per firing of a misfire, and of an exhaust pop (the Merlin on the overrun). */
  misfire?: number;
  pops?: number;
  /** Final low-pass (0..1, lower is duller). */
  lp?: number;
}

/**
 * A V12 aero engine loop, built from what the engine does: twelve cylinders
 * firing evenly, six times a revolution, alternating bank to bank through
 * the exhaust stubs, each with a slightly different voice; the propeller's
 * blades chopping through the slipstream; the supercharger singing above
 * it all. Every component makes a whole number of cycles in the loop, so it
 * repeats seamlessly, and the whole thing pitches up and down with the rpm.
 */
export function v12(rng: Rng, rate: number, e: V12Spec): Float32Array {
  const crankHz = e.rpm / 60;
  const n = Math.round((rate * e.revs) / crankHz);
  const d = new Float32Array(n);
  const perRev = n / e.revs;
  const fireEvery = perRev / 6;
  const cyl = Array.from({ length: 12 }, () => 1 - e.cylVar * rng.next());
  // One firing pulse: a ringing thump with a burst of noise on the front.
  const pulseLen = Math.ceil(rate * 0.03);
  const tone = new Float32Array(pulseLen), hiss = new Float32Array(pulseLen);
  for (let j = 0; j < pulseLen; j++) {
    const t = j / rate;
    tone[j] = Math.sin(TAU * e.body * t) * Math.exp(-t * e.decay);
    hiss[j] = Math.exp(-t * e.decay * 2.2);
  }
  const fires = e.revs * 6;
  for (let k = 0; k < fires; k++) {
    if (e.misfire && rng.chance(e.misfire)) continue;
    const amp = cyl[k % 12] * (k % 2 ? e.bank : 1) * (1 - e.cycleVar * rng.next());
    const at = Math.round(k * fireEvery);
    for (let j = 0; j < pulseLen; j++) {
      const v = tone[j] * (1 - e.noise) + (rng.next() * 2 - 1) * hiss[j] * e.noise;
      d[(at + j) % n] += v * amp;
    }
    // Overrun: unburnt mixture banging in the stubs.
    if (e.pops && rng.chance(e.pops)) {
      const len = Math.round(rate * 0.006), big = 1.6 + rng.next() * 1.4;
      for (let j = 0; j < len; j++) d[(at + j) % n] += (rng.next() * 2 - 1) * big * (1 - j / len);
    }
  }
  // Propeller and supercharger: whole numbers of cycles over the loop.
  const bladeCycles = Math.round(e.blades * e.revs);
  const whineCycles = e.whine * e.revs;
  for (let i = 0; i < n; i++) {
    const ph = i / n;
    const chop = Math.sin(TAU * bladeCycles * ph);
    // The blades chop the exhaust note (a throb) more than they add a note of their own.
    d[i] = d[i] * (1 + e.prop * chop) + e.prop * 0.12 * chop + e.whineAmp * Math.sin(TAU * whineCycles * ph);
  }
  return crush8(normalise(lowpass(d, e.lp ?? 0.6), 0.9));
}

/**
 * Twin engines out of step: the drone of a German bomber overhead. The two
 * engines run a few rpm apart, so their propellers beat against each other:
 * the throbbing "vrrm-vrrm" everyone in southern England learned to know.
 */
function twinDrone(rng: Rng, rate: number, a: V12Spec, b: V12Spec): Float32Array {
  const ea = v12(rng, rate, a), eb = v12(rng, rate, b);
  const n = Math.min(ea.length, eb.length);
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = ea[i] + eb[i];
  return crush8(normalise(lowpass(d, 0.35), 0.9));
}

/** Short burst of noise with an envelope: gunfire, impacts, bursts. */
function noiseHit(rng: Rng, rate: number, secs: number, decay: number, tone: number, lp: number): Float32Array {
  return crush8(normalise(lowpass(build(rate, secs, (t) => ((rng.next() * 2 - 1) * (1 - tone) + Math.sin(TAU * 90 * t) * tone) * Math.exp(-t * decay)), lp)));
}

/** A Browning volley loop: shots from several guns at slightly different rates. */
function volley(rng: Rng, rate: number, guns: number): Float32Array {
  const secs = 0.5;
  const d = new Float32Array(Math.round(rate * secs));
  const shot = noiseHit(rng, rate, 0.035, 90, 0.25, 0.7);
  for (let g = 0; g < guns; g++) {
    const interval = rate / (19 + g * 0.6); // ~1150 rounds a minute each
    for (let t = rng.next() * interval; t < d.length; t += interval * (0.95 + rng.next() * 0.1)) {
      const s = Math.floor(t);
      for (let j = 0; j < shot.length && s + j < d.length; j++) d[s + j] += shot[j] * 0.6;
    }
  }
  return crush8(normalise(d, 0.9));
}

/** A struck metal: a few inharmonic partials ringing down. */
function metal(rate: number, secs: number, f0: number, partials: number[], decay: number): Float32Array {
  return crush8(normalise(build(rate, secs, (t) => partials.reduce((a, p, k) => a + Math.sin(TAU * f0 * p * t) * Math.exp(-t * decay * (1 + k * 0.4)) / (k + 1), 0))));
}

export function buildSamples(seed = 1940): Record<string, Sample> {
  const rng = new Rng(seed);
  const R = 11025;
  const S: Record<string, Sample> = {};
  // Engines, at twice the rate of the rest so the supercharger can sing.
  const E = 22050;
  // Merlin III: 2,600 rpm, firing at 260 Hz; de Havilland three-blade prop
  // geared 0.477 (blade passes 1.43 a rev); deep note, bank-to-bank growl.
  const merlin: V12Spec = { rpm: 2600, revs: 28, body: 150, decay: 360, noise: 0.3, bank: 0.78, cylVar: 0.14, cycleVar: 0.06, blades: 3 * 0.477, prop: 0.22, whine: 30, whineAmp: 0.05 };
  S.merlin = { data: v12(rng, E, merlin), rate: E, loop: true };
  // Throttled back: lumpy, and crackling and popping on the overrun.
  S.merlinIdle = { data: v12(rng, E, { ...merlin, cycleVar: 0.4, noise: 0.45, misfire: 0.07, pops: 0.07, whineAmp: 0.02, prop: 0.3 }), rate: E, loop: true };
  // DB 601: fuel-injected inverted V12, 2,400 rpm, VDM prop geared 0.645;
  // a harder, raspier note, the supercharger's whine well up, and no pops.
  const db601: V12Spec = { rpm: 2400, revs: 30, body: 230, decay: 560, noise: 0.55, bank: 0.9, cylVar: 0.08, cycleVar: 0.08, blades: 3 * 0.645, prop: 0.26, whine: 37, whineAmp: 0.09 };
  S.db601 = { data: v12(rng, E, db601), rate: E, loop: true };
  S.db601Idle = { data: v12(rng, E, { ...db601, cycleVar: 0.25, misfire: 0.02, whineAmp: 0.04 }), rate: E, loop: true };
  // Jumo 211 pair (He 111, Ju 88, the Stuka's single): heard from outside, a
  // muffled drone, the two engines 60 rpm apart so the props beat.
  const jumo: V12Spec = { rpm: 2280, revs: 76, body: 120, decay: 300, noise: 0.35, bank: 0.85, cylVar: 0.1, cycleVar: 0.1, blades: 3 * 0.645, prop: 0.5, whine: 30, whineAmp: 0.01, lp: 0.4 };
  S.drone = { data: twinDrone(rng, R, jumo, { ...jumo, rpm: 2340, revs: 78 }), rate: R, loop: true };
  S.radial = { data: v12(rng, R, { ...merlin, body: 110, noise: 0.5, cycleVar: 0.3, whineAmp: 0 }), rate: R, loop: true };
  S.starter = { data: crush8(normalise(build(R, 1.6, (t) => Math.sin(TAU * (60 + 140 * t) * t) * 0.6 + (rng.next() - 0.5) * 0.3))), rate: R, loop: false };
  S.cough = { data: crush8(normalise(build(R, 0.6, (t) => (rng.next() * 2 - 1) * (Math.sin(TAU * 7 * t) > 0.2 ? 1 : 0.15) * Math.exp(-t * 4)))), rate: R, loop: false };
  // Guns.
  S.browning4 = { data: volley(rng, R, 4), rate: R, loop: true };
  S.browning8 = { data: volley(rng, R, 8), rate: R, loop: true };
  S.cannon = { data: noiseHit(rng, R, 0.25, 18, 0.6, 0.35), rate: R, loop: false };
  S.enemyFire = { data: crush8(normalise(volley(rng, R, 2).map((v) => v * 0.4))), rate: R, loop: false };
  // Being hit, and things blowing up.
  S.clang = { data: metal(R, 0.35, 420, [1, 2.76, 5.4, 8.9], 14), rate: R, loop: false };
  S.thud = { data: noiseHit(rng, R, 0.18, 30, 0.5, 0.25), rate: R, loop: false };
  // Our rounds striking home: a bright, short metallic tick over a click.
  const tickRing = metal(R, 0.08, 1500, [1, 2.6, 4.1], 70);
  const tickClick = noiseHit(rng, R, 0.08, 220, 0, 0.9);
  S.tick = { data: crush8(normalise(tickRing.map((v, i) => v * 0.7 + tickClick[i] * 0.5))), rate: R, loop: false };
  S.explode = { data: noiseHit(rng, R, 1.4, 3.2, 0.2, 0.12), rate: R, loop: false };
  // Wind, buffet, R/T: loops of filtered noise.
  S.wind = { data: crush8(normalise(lowpass(build(R, 1, () => rng.next() * 2 - 1), 0.12))), rate: R, loop: true };
  S.buffet = { data: crush8(normalise(build(R, 0.5, (t) => (rng.next() * 2 - 1) * (0.5 + 0.5 * Math.sin(TAU * 14 * t))).map((v, i, a) => (i ? (v + a[i - 1]) / 2 : v)))), rate: R, loop: true };
  const hiss = build(R, 0.8, () => rng.next() * 2 - 1);
  const crackle = lowpass(hiss.map((v, i) => v * 0.3 + (i % 397 < 4 ? 1 : 0)), 0.5);
  S.rt = { data: crush8(normalise(crackle.map((v, i) => v - (i ? crackle[i - 1] * 0.8 : 0)), 0.5)), rate: R, loop: false };
  // Around the airfield.
  S.bell = { data: crush8(metal(R, 2.5, 880, [1, 2.4, 3.9, 5.2], 1.6).map((v, i) => v * (Math.sin((TAU * 16 * i) / R) > -0.2 ? 1 : 0.3))), rate: R, loop: false };
  S.phone = { data: crush8(normalise(build(R, 2, (t) => { const on = t % 0.6 < 0.4 && t < 1.2 ? 1 : 0; return on * (Math.sin(TAU * 400 * t) + Math.sin(TAU * 450 * t)) * 0.5; }))), rate: R, loop: false };
  S.pump = { data: noiseHit(rng, R, 0.06, 60, 0.7, 0.5), rate: R, loop: false };
  S.click = { data: noiseHit(rng, R, 0.02, 200, 0.3, 0.8), rate: R, loop: false };
  S.thump = { data: noiseHit(rng, R, 0.3, 14, 0.8, 0.2), rate: R, loop: false };
  // Instruments for the tracker: single cycles (pitched, looped) and drums.
  const I = 16726; // one cycle of 64 samples at this rate plays C5-ish
  const len = 64;
  const instr = (name: string, f: (ph: number) => number) => { S[name] = { data: crush8(cycle(len, f)), rate: I, loop: true, baseHz: I / len }; };
  instr('square', (p) => (p < 0.5 ? 0.6 : -0.6));
  instr('pulse', (p) => (p < 0.25 ? 0.55 : -0.55));
  instr('triangle', (p) => (p < 0.5 ? 4 * p - 1 : 3 - 4 * p) * 0.9);
  instr('brass', (p) => (2 * p - 1) * 0.5 + Math.sin(TAU * p) * 0.3);
  instr('flute', (p) => Math.sin(TAU * p) * 0.8 + Math.sin(TAU * 2 * p) * 0.1);
  S.snare = { data: noiseHit(rng, R, 0.2, 22, 0.15, 0.6), rate: R, loop: false };
  S.kick = { data: crush8(normalise(build(R, 0.25, (t) => Math.sin(TAU * (110 * Math.exp(-t * 18) + 45) * t) * Math.exp(-t * 12)))), rate: R, loop: false };
  S.hat = { data: noiseHit(rng, R, 0.05, 80, 0, 0.95), rate: R, loop: false };
  return S;
}
