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
    for (const n of ['merlin', 'db601', 'browning8', 'clang', 'explode', 'cough', 'buffet', 'bell', 'phone', 'rt', 'pump', 'wind', 'starter']) expect(S[n], n).toBeDefined();
  });
  it('the Merlin and the DB 601 are different notes', () => {
    expect(S.merlin.data.length).not.toBe(S.db601.data.length);
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
