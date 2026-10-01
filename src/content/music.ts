// Music: two original tunes for the tracker. A stirring march in D for the
// title, and a quiet tune in D minor for the debrief. No music in flight.

import type { Song } from '../audio/tracker';

const CHORDS: Record<string, [string, string, string]> = {
  D: ['D', 'F#', 'A'], G: ['G', 'B', 'D'], A: ['A', 'C#', 'E'], Em: ['E', 'G', 'B'], Bm: ['B', 'D', 'F#'],
  Dm: ['D', 'F', 'A'], Bb: ['Bb', 'D', 'F'], C: ['C', 'E', 'G'], F: ['F', 'A', 'C'], Gm: ['G', 'Bb', 'D'],
};

/** Each bar is one chord, or two split by '/'. */
const halves = (bar: string) => (bar.includes('/') ? bar.split('/') : [bar, bar]);

/** March bass: root and fifth on the beat. */
function marchBass(bars: string[]): string {
  return bars.map((b) => halves(b).map((c) => `${CHORDS[c][0]}2:4 ${CHORDS[c][2]}2:4`).join(' ')).join(' ');
}

/** Off-beat chord stabs, alternating third and fifth. */
function stabs(bars: string[]): string {
  return bars.map((b) => halves(b).map((c) => `r:2 ${CHORDS[c][1]}4:2 r:2 ${CHORDS[c][2]}4:2`).join(' ')).join(' ');
}

/** Bass drum on 1 and 3, snare on 2 and 4; a roll into the next section on the last bar. */
function marchDrums(n: number, fill = true): string {
  const bar = 'K:4 S:4 K:4 S:4';
  const roll = 'K:4 S:2 S:2 S:2 S:2 S:1 S:1 S:1 S:1';
  return Array.from({ length: n }, (_, i) => (fill && i === n - 1 ? roll : bar)).join(' ');
}

/** Slow tune: a whole-bar bass note and a held chord tone. */
function slowBass(bars: string[]): string {
  return bars.map((b) => halves(b).map((c) => `${CHORDS[c][0]}2:8`).join(' ')).join(' ');
}
function slowPad(bars: string[]): string {
  return bars.map((b) => halves(b).map((c) => `${CHORDS[c][1]}4:8`).join(' ')).join(' ');
}
function arpeggio(bars: string[]): string {
  return bars.map((b) => halves(b).map((c) => { const [r, t, f] = CHORDS[c]; return `${r}3:2 ${f}3:2 ${t}4:2 ${f}3:2`; }).join(' ')).join(' ');
}

const TITLE_A = 'D4:4 F#4:2 A4:2 D5:6 C#5:2 B4:4 A4:4 F#4:4 A4:4 G4:4 B4:2 D5:2 G5:6 F#5:2 E5:8 r:4 A4:4 '
  + 'D5:4 C#5:2 B4:2 A4:4 F#4:4 G4:4 B4:4 E5:4 D5:2 C#5:2 D5:6 A4:2 F#4:4 E4:4 D4:12 r:4';
const TITLE_A_CH = ['D', 'D', 'G', 'A', 'D', 'Em/A', 'D/A', 'D'];
const TITLE_B = 'B4:6 C#5:2 D5:4 B4:4 F#5:8 E5:4 D5:4 C#5:6 D5:2 E5:4 C#5:4 A4:12 r:4 '
  + 'G4:4 A4:2 B4:2 C#5:4 D5:4 E5:4 F#5:4 G5:4 E5:4 F#5:4 D5:4 E5:4 C#5:4 D5:12 r:4';
const TITLE_B_CH = ['Bm', 'Bm', 'A', 'A', 'G', 'Em', 'D/A', 'D'];
const INTRO_CH = ['D', 'D/A'];

export const TITLE_SONG: Song = {
  bpm: 112,
  channels: [
    { instr: 'brass', vol: 0.55, pan: -0.5 },
    { instr: 'pulse', vol: 0.25, pan: 0.5 },
    { instr: 'triangle', vol: 0.6, pan: 0.5 },
    { instr: 'kick', vol: 0.5, pan: -0.5 },
  ],
  patterns: {
    intro: ['r:32', stabs(INTRO_CH), marchBass(INTRO_CH), 'S:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1 ' + 'K:4 S:4 K:4 S:2 S:2'],
    a: [TITLE_A, stabs(TITLE_A_CH), marchBass(TITLE_A_CH), marchDrums(8)],
    b: ['@square ' + TITLE_B + ' @brass', stabs(TITLE_B_CH), marchBass(TITLE_B_CH), marchDrums(8)],
  },
  order: ['intro', 'a', 'b', 'a'],
  loop: true,
};

const DEBRIEF_MEL = 'A4:8 F4:4 G4:4 A4:4 C5:4 Bb4:8 G4:8 E4:4 F4:4 G4:12 r:4 '
  + 'F4:8 D4:4 E4:4 F4:4 A4:4 G4:8 E4:6 F4:2 D4:8 D4:12 r:4';
const DEBRIEF_CH = ['Dm', 'F/Bb', 'C', 'C', 'Dm', 'F/Gm', 'Gm/A', 'Dm'];

export const DEBRIEF_SONG: Song = {
  bpm: 72,
  channels: [
    { instr: 'flute', vol: 0.5, pan: -0.4 },
    { instr: 'triangle', vol: 0.3, pan: 0.4 },
    { instr: 'triangle', vol: 0.5, pan: 0.4 },
    { instr: 'pulse', vol: 0.12, pan: -0.4 },
  ],
  patterns: {
    a: [DEBRIEF_MEL, slowPad(DEBRIEF_CH), slowBass(DEBRIEF_CH), arpeggio(DEBRIEF_CH)],
    b: ['r:128', slowPad(DEBRIEF_CH), slowBass(DEBRIEF_CH), arpeggio(DEBRIEF_CH)],
  },
  order: ['b', 'a', 'a', 'b'],
  loop: true,
};
