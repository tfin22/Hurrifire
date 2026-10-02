import { describe, expect, it } from 'vitest';
import { buildSamples } from '../src/audio/synth';
import { compileSong, noteHz, parseChannel } from '../src/audio/tracker';
import { DEBRIEF_SONG, TITLE_SONG } from '../src/content/music';

describe('the sample bank', () => {
  const S = buildSamples();
  it('is all 8-bit, in range, and non-empty', () => {
    for (const [name, s] of Object.entries(S)) {
      expect(s.data.length, name).toBeGreaterThan(8);
      for (const v of s.data) {
        expect(Math.abs(v)).toBeLessThanOrEqual(1);
        expect(Math.abs(Math.round(v * 127) - v * 127)).toBeLessThan(1e-3);
      }
    }
  });
  it('has the sounds the game asks for', () => {
    for (const n of ['merlin', 'merlinIdle', 'db601', 'db601Idle', 'drone', 'browning8', 'clang', 'explode', 'cough', 'buffet', 'bell', 'phone', 'rt', 'pump', 'wind', 'starter']) expect(S[n], n).toBeDefined();
  });
  it('the Merlin and the DB 601 are different notes', () => {
    expect(S.merlin.data.length).not.toBe(S.db601.data.length);
  });
  /** Energy of a sample at one frequency (a single DFT bin). */
  const at = (name: string, hz: number) => {
    const { data, rate } = S[name];
    let re = 0, im = 0;
    for (let i = 0; i < data.length; i++) { const a = (2 * Math.PI * hz * i) / rate; re += data[i] * Math.cos(a); im += data[i] * Math.sin(a); }
    return Math.hypot(re, im) / data.length;
  };
  const crest = (d: Float32Array) => { let m = 0, q = 0; for (const v of d) { m = Math.max(m, Math.abs(v)); q += v * v; } return m / Math.sqrt(q / d.length); };

  it('the Merlin fires twelve cylinders evenly: its note is 6x the crank speed (260 Hz at 2,600 rpm)', () => {
    const fire = at('merlin', 260);
    for (const off of [200, 230, 290, 320]) expect(fire, `${off} Hz`).toBeGreaterThan(at('merlin', off) * 3);
    // The banks alternate: a growl at half the firing rate; the prop throbs at 1.43 blade passes a rev.
    expect(at('merlin', 130)).toBeGreaterThan(at('merlin', 100) * 2);
    expect(at('merlin', 62)).toBeGreaterThan(at('merlin', 45) * 2);
  });

  it('the DB 601 sits at 240 Hz (2,400 rpm), with its supercharger singing above', () => {
    expect(at('db601', 240)).toBeGreaterThan(at('db601', 200) * 3);
    expect(at('db601', 1480)).toBeGreaterThan(at('db601', 1300) * 3);
  });

  it('throttled back, the Merlin crackles and pops; the fuel-injected DB 601 does not', () => {
    expect(crest(S.merlinIdle.data)).toBeGreaterThan(crest(S.merlin.data) * 1.8);
    expect(crest(S.db601Idle.data)).toBeLessThan(crest(S.merlinIdle.data) * 0.6);
  });

  it('engine loops join up without a click', () => {
    for (const n of ['merlin', 'merlinIdle', 'db601', 'drone']) {
      const d = S[n].data;
      let typical = 0;
      for (let i = 1; i < d.length; i++) typical += Math.abs(d[i] - d[i - 1]);
      typical /= d.length;
      expect(Math.abs(d[0] - d[d.length - 1]), n).toBeLessThan(typical * 8 + 0.05);
    }
  });

  it('is the same every time (seeded)', () => {
    expect(Array.from(buildSamples().clang.data)).toEqual(Array.from(S.clang.data));
  });
  it('pitched instruments know their base note', () => {
    for (const n of ['square', 'pulse', 'triangle', 'brass', 'flute']) expect(S[n].baseHz).toBeGreaterThan(100);
  });
});

describe('the tracker', () => {
  it('note names', () => {
    expect(noteHz('A4')).toBeCloseTo(440, 6);
    expect(noteHz('A5')).toBeCloseTo(880, 6);
    expect(noteHz('C4')).toBeCloseTo(261.63, 1);
    expect(noteHz('Bb3')).toBeCloseTo(noteHz('A#3'), 9);
  });
  it('parses a channel line: notes, rests, drums, instrument and volume changes', () => {
    const { events, steps } = parseChannel('D4:4 r:4 @flute !0.5 G4:8 K:2 S:2', 'square', 1);
    expect(steps).toBe(20);
    expect(events.map((e) => [e.step, e.instr, e.vol])).toEqual([[0, 'square', 1], [8, 'flute', 0.5], [16, 'kick', 0.5], [18, 'snare', 0.5]]);
  });
  it('both songs compile, with every channel of every pattern the same length', () => {
    for (const song of [TITLE_SONG, DEBRIEF_SONG]) {
      for (const [name, pat] of Object.entries(song.patterns)) {
        const lens = pat.map((l) => parseChannel(l, 'square', 1).steps);
        expect(new Set(lens).size, name).toBe(1);
        expect(lens[0] % 16, name).toBe(0); // whole bars
      }
      const c = compileSong(song);
      expect(c.channels.length).toBe(4);
      expect(c.steps).toBeGreaterThan(16 * 16);
    }
  });
});
