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

/**
 * An aero engine loop: firing pulses through the exhaust stacks, each with
 * its own jitter, over a rumble. `cyl` pulses per crank revolution pair.
 */
function engine(rng: Rng, rate: number, revs: number, cyl: number, harmonics: number[], rough: number): Float32Array {
  // Loop length: a whole number of firing cycles at the base rpm.
  const fireHz = (revs / 60) * (cyl / 2);
  const cycles = 24;
  const n = Math.round((rate / fireHz) * cycles);
  const d = new Float32Array(n);
  const per = n / cycles;
  for (let c = 0; c < cycles; c++) {
    const amp = 1 - rough * rng.next();
    const start = Math.round(c * per);
    for (let j = 0; j < per && start + j < n; j++) {
      const t = j / per;
      let v = 0;
      harmonics.forEach((h, k) => { v += h * Math.sin(TAU * (k + 1) * t + k * 0.7); });
      d[start + j] = v * amp * Math.exp(-t * 2.2) + (rng.next() - 0.5) * 0.25 * rough;
    }
  }
  return crush8(normalise(lowpass(d, 0.55), 0.9));
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
  // Engines: the Merlin's smooth, deep drone; the DB 601 harder-edged and a different note.
  S.merlin = { data: engine(rng, R, 2600, 12, [1, 0.6, 0.35, 0.2, 0.12], 0.18), rate: R, loop: true };
  S.db601 = { data: engine(rng, R, 2400, 12, [0.8, 0.8, 0.5, 0.35, 0.25, 0.15], 0.28), rate: R, loop: true };
  S.radial = { data: engine(rng, R, 2200, 9, [1, 0.5, 0.4, 0.1], 0.35), rate: R, loop: true };
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
