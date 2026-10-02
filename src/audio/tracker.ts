// A small tracker: four channels, patterns, an order list, synthesised
// instruments. Patterns are written as one line of notes per channel:
//
//   "D4:4 F#4:2 A4:2 r:4 @flute G4:8 !0.5 K:4 S:4"
//
// note:length in 16th notes, r = rest, K/S/H = kick/snare/hat,
// @name = switch instrument, !v = channel volume (0..1).

export interface Song {
  bpm: number;
  channels: { instr: string; vol: number; pan: number }[];
  patterns: Record<string, string[]>;
  order: string[];
  loop: boolean;
}

export interface NoteEvent {
  /** Start, in 16th-note steps from the start of the pattern. */
  step: number;
  /** Length in steps. */
  len: number;
  instr: string;
  /** Frequency (Hz); 0 for unpitched drums. */
  hz: number;
  vol: number;
}

const SEMI: Record<string, number> = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const DRUMS: Record<string, string> = { K: 'kick', S: 'snare', H: 'hat' };

/** Note name ("F#4") to frequency, A4 = 440. */
export function noteHz(name: string): number {
  const m = /^([A-G](?:#|b)?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  const midi = (Number(m[2]) + 1) * 12 + SEMI[m[1]];
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Parse one channel line of a pattern. */
export function parseChannel(line: string, instr: string, vol: number): { events: NoteEvent[]; steps: number } {
  const events: NoteEvent[] = [];
  let step = 0;
  for (const tok of line.trim().split(/\s+/).filter(Boolean)) {
    if (tok.startsWith('@')) { instr = tok.slice(1); continue; }
    if (tok.startsWith('!')) { vol = Number(tok.slice(1)); continue; }
    const [n, l] = tok.split(':');
    const len = Number(l ?? 1);
    if (!(len > 0)) throw new Error(`bad length in ${tok}`);
    if (n !== 'r') {
      if (DRUMS[n]) events.push({ step, len, instr: DRUMS[n], hz: 0, vol });
      else events.push({ step, len, instr, hz: noteHz(n), vol });
    }
    step += len;
  }
  return { events, steps: step };
}

/** Flatten a song into per-channel events with absolute steps (one pass through the order). */
export function compileSong(song: Song): { channels: NoteEvent[][]; steps: number } {
  const channels: NoteEvent[][] = song.channels.map(() => []);
  const state = song.channels.map((c) => ({ instr: c.instr, vol: c.vol }));
  let at = 0;
  for (const name of song.order) {
    const pat = song.patterns[name];
    if (!pat) throw new Error(`no pattern ${name}`);
    let len = 0;
    pat.forEach((line, ch) => {
      const { events, steps } = parseChannel(line, state[ch].instr, state[ch].vol);
      for (const e of events) channels[ch].push({ ...e, step: e.step + at });
      // Instrument and volume changes carry into the next pattern.
      const last = [...line.matchAll(/@(\w+)/g)].pop();
      if (last) state[ch].instr = last[1];
      const v = [...line.matchAll(/!([\d.]+)/g)].pop();
      if (v) state[ch].vol = Number(v[1]);
      len = Math.max(len, steps);
    });
    at += len;
  }
  return { channels, steps: at };
}
