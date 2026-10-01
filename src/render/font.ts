// Pixel fonts, all original glyph designs.
//   'topaz'  — chunky menu font: 5×8 glyphs drawn with doubled vertical
//              strokes (the classic Workbench look), 7px advance.
//   'hand'   — logbook font: the same skeletons drawn thin, sheared and with a
//              little deterministic wobble so it reads as handwriting.
//   'tiny'   — 3×5 for instrument faces and the HUD.

import { FrameBuffer, W } from './framebuffer';
import { hash3 } from '../core/rng';

const GLYPHS: Record<string, string> = {
  ' ': '.....|.....|.....|.....|.....|.....|.....|.....',
  '!': '..x..|..x..|..x..|..x..|..x..|.....|..x..|.....',
  '"': '.x.x.|.x.x.|.....|.....|.....|.....|.....|.....',
  '#': '.x.x.|xxxxx|.x.x.|.x.x.|xxxxx|.x.x.|.....|.....',
  '$': '..x..|.xxxx|x.x..|.xxx.|..x.x|xxxx.|..x..|.....',
  '%': 'xx...|xx..x|...x.|..x..|.x...|x..xx|...xx|.....',
  '&': '.xx..|x..x.|.xx..|.x...|x.x.x|x..x.|.xx.x|.....',
  "'": '..x..|..x..|.x...|.....|.....|.....|.....|.....',
  '(': '...x.|..x..|.x...|.x...|.x...|..x..|...x.|.....',
  ')': '.x...|..x..|...x.|...x.|...x.|..x..|.x...|.....',
  '*': '.....|..x..|x.x.x|.xxx.|x.x.x|..x..|.....|.....',
  '+': '.....|..x..|..x..|xxxxx|..x..|..x..|.....|.....',
  ',': '.....|.....|.....|.....|.....|..x..|..x..|.x...',
  '-': '.....|.....|.....|xxxxx|.....|.....|.....|.....',
  '.': '.....|.....|.....|.....|.....|.....|..x..|.....',
  '/': '....x|....x|...x.|..x..|.x...|x....|x....|.....',
  '0': '.xxx.|x...x|x..xx|x.x.x|xx..x|x...x|.xxx.|.....',
  '1': '..x..|.xx..|..x..|..x..|..x..|..x..|.xxx.|.....',
  '2': '.xxx.|x...x|....x|..xx.|.x...|x....|xxxxx|.....',
  '3': '.xxx.|x...x|....x|..xx.|....x|x...x|.xxx.|.....',
  '4': '...x.|..xx.|.x.x.|x..x.|xxxxx|...x.|...x.|.....',
  '5': 'xxxxx|x....|xxxx.|....x|....x|x...x|.xxx.|.....',
  '6': '..xx.|.x...|x....|xxxx.|x...x|x...x|.xxx.|.....',
  '7': 'xxxxx|....x|...x.|..x..|.x...|.x...|.x...|.....',
  '8': '.xxx.|x...x|x...x|.xxx.|x...x|x...x|.xxx.|.....',
  '9': '.xxx.|x...x|x...x|.xxxx|....x|...x.|.xx..|.....',
  ':': '.....|..x..|.....|.....|.....|..x..|.....|.....',
  ';': '.....|..x..|.....|.....|.....|..x..|..x..|.x...',
  '<': '...x.|..x..|.x...|x....|.x...|..x..|...x.|.....',
  '=': '.....|.....|xxxxx|.....|xxxxx|.....|.....|.....',
  '>': '.x...|..x..|...x.|....x|...x.|..x..|.x...|.....',
  '?': '.xxx.|x...x|....x|...x.|..x..|.....|..x..|.....',
  '@': '.xxx.|x...x|x.xxx|x.x.x|x.xxx|x....|.xxx.|.....',
  'A': '.xxx.|x...x|x...x|xxxxx|x...x|x...x|x...x|.....',
  'B': 'xxxx.|x...x|x...x|xxxx.|x...x|x...x|xxxx.|.....',
  'C': '.xxx.|x...x|x....|x....|x....|x...x|.xxx.|.....',
  'D': 'xxx..|x..x.|x...x|x...x|x...x|x..x.|xxx..|.....',
  'E': 'xxxxx|x....|x....|xxxx.|x....|x....|xxxxx|.....',
  'F': 'xxxxx|x....|x....|xxxx.|x....|x....|x....|.....',
  'G': '.xxx.|x...x|x....|x.xxx|x...x|x...x|.xxxx|.....',
  'H': 'x...x|x...x|x...x|xxxxx|x...x|x...x|x...x|.....',
  'I': '.xxx.|..x..|..x..|..x..|..x..|..x..|.xxx.|.....',
  'J': '..xxx|...x.|...x.|...x.|...x.|x..x.|.xx..|.....',
  'K': 'x...x|x..x.|x.x..|xx...|x.x..|x..x.|x...x|.....',
  'L': 'x....|x....|x....|x....|x....|x....|xxxxx|.....',
  'M': 'x...x|xx.xx|x.x.x|x.x.x|x...x|x...x|x...x|.....',
  'N': 'x...x|x...x|xx..x|x.x.x|x..xx|x...x|x...x|.....',
  'O': '.xxx.|x...x|x...x|x...x|x...x|x...x|.xxx.|.....',
  'P': 'xxxx.|x...x|x...x|xxxx.|x....|x....|x....|.....',
  'Q': '.xxx.|x...x|x...x|x...x|x.x.x|x..x.|.xx.x|.....',
  'R': 'xxxx.|x...x|x...x|xxxx.|x.x..|x..x.|x...x|.....',
  'S': '.xxx.|x...x|x....|.xxx.|....x|x...x|.xxx.|.....',
  'T': 'xxxxx|..x..|..x..|..x..|..x..|..x..|..x..|.....',
  'U': 'x...x|x...x|x...x|x...x|x...x|x...x|.xxx.|.....',
  'V': 'x...x|x...x|x...x|x...x|x...x|.x.x.|..x..|.....',
  'W': 'x...x|x...x|x...x|x.x.x|x.x.x|x.x.x|.x.x.|.....',
  'X': 'x...x|x...x|.x.x.|..x..|.x.x.|x...x|x...x|.....',
  'Y': 'x...x|x...x|.x.x.|..x..|..x..|..x..|..x..|.....',
  'Z': 'xxxxx|....x|...x.|..x..|.x...|x....|xxxxx|.....',
  '[': '.xxx.|.x...|.x...|.x...|.x...|.x...|.xxx.|.....',
  '\\': 'x....|x....|.x...|..x..|...x.|....x|....x|.....',
  ']': '.xxx.|...x.|...x.|...x.|...x.|...x.|.xxx.|.....',
  '^': '..x..|.x.x.|x...x|.....|.....|.....|.....|.....',
  '_': '.....|.....|.....|.....|.....|.....|.....|xxxxx',
  '`': '.x...|..x..|.....|.....|.....|.....|.....|.....',
  'a': '.....|.....|.xxx.|....x|.xxxx|x...x|.xxxx|.....',
  'b': 'x....|x....|xxxx.|x...x|x...x|x...x|xxxx.|.....',
  'c': '.....|.....|.xxx.|x....|x....|x...x|.xxx.|.....',
  'd': '....x|....x|.xxxx|x...x|x...x|x...x|.xxxx|.....',
  'e': '.....|.....|.xxx.|x...x|xxxxx|x....|.xxx.|.....',
  'f': '..xx.|.x..x|.x...|xxx..|.x...|.x...|.x...|.....',
  'g': '.....|.....|.xxxx|x...x|x...x|.xxxx|....x|.xxx.',
  'h': 'x....|x....|xxxx.|x...x|x...x|x...x|x...x|.....',
  'i': '..x..|.....|.xx..|..x..|..x..|..x..|.xxx.|.....',
  'j': '...x.|.....|..xx.|...x.|...x.|...x.|x..x.|.xx..',
  'k': 'x....|x....|x..x.|x.x..|xx...|x.x..|x..x.|.....',
  'l': '.xx..|..x..|..x..|..x..|..x..|..x..|.xxx.|.....',
  'm': '.....|.....|xx.x.|x.x.x|x.x.x|x.x.x|x...x|.....',
  'n': '.....|.....|xxxx.|x...x|x...x|x...x|x...x|.....',
  'o': '.....|.....|.xxx.|x...x|x...x|x...x|.xxx.|.....',
  'p': '.....|.....|xxxx.|x...x|x...x|xxxx.|x....|x....',
  'q': '.....|.....|.xxxx|x...x|x...x|.xxxx|....x|....x',
  'r': '.....|.....|x.xx.|xx..x|x....|x....|x....|.....',
  's': '.....|.....|.xxxx|x....|.xxx.|....x|xxxx.|.....',
  't': '.x...|.x...|xxx..|.x...|.x...|.x..x|..xx.|.....',
  'u': '.....|.....|x...x|x...x|x...x|x..xx|.xx.x|.....',
  'v': '.....|.....|x...x|x...x|x...x|.x.x.|..x..|.....',
  'w': '.....|.....|x...x|x...x|x.x.x|x.x.x|.x.x.|.....',
  'x': '.....|.....|x...x|.x.x.|..x..|.x.x.|x...x|.....',
  'y': '.....|.....|x...x|x...x|x...x|.xxxx|....x|.xxx.',
  'z': '.....|.....|xxxxx|...x.|..x..|.x...|xxxxx|.....',
  '{': '...xx|..x..|..x..|.x...|..x..|..x..|...xx|.....',
  '|': '..x..|..x..|..x..|..x..|..x..|..x..|..x..|.....',
  '}': 'xx...|..x..|..x..|...x.|..x..|..x..|xx...|.....',
  '~': '.....|.....|.x...|x.x.x|...x.|.....|.....|.....',
  '°': '.xx..|x..x.|.xx..|.....|.....|.....|.....|.....',
  '£': '..xx.|.x..x|.x...|xxx..|.x...|.x...|xxxxx|.....',
};

const TINY: Record<string, string> = {
  '0': 'xxx|x.x|x.x|x.x|xxx', '1': '.x.|xx.|.x.|.x.|xxx', '2': 'xxx|..x|xxx|x..|xxx',
  '3': 'xxx|..x|.xx|..x|xxx', '4': 'x.x|x.x|xxx|..x|..x', '5': 'xxx|x..|xxx|..x|xxx',
  '6': 'xxx|x..|xxx|x.x|xxx', '7': 'xxx|..x|.x.|.x.|.x.', '8': 'xxx|x.x|xxx|x.x|xxx',
  '9': 'xxx|x.x|xxx|..x|xxx', 'A': '.x.|x.x|xxx|x.x|x.x', 'B': 'xx.|x.x|xx.|x.x|xx.',
  'C': '.xx|x..|x..|x..|.xx', 'D': 'xx.|x.x|x.x|x.x|xx.', 'E': 'xxx|x..|xx.|x..|xxx',
  'F': 'xxx|x..|xx.|x..|x..', 'G': '.xx|x..|x.x|x.x|.xx', 'H': 'x.x|x.x|xxx|x.x|x.x',
  'I': 'xxx|.x.|.x.|.x.|xxx', 'J': '..x|..x|..x|x.x|.x.', 'K': 'x.x|x.x|xx.|x.x|x.x',
  'L': 'x..|x..|x..|x..|xxx', 'M': 'x.x|xxx|xxx|x.x|x.x', 'N': 'xx.|x.x|x.x|x.x|x.x',
  'O': '.x.|x.x|x.x|x.x|.x.', 'P': 'xx.|x.x|xx.|x..|x..', 'Q': '.x.|x.x|x.x|xx.|.xx',
  'R': 'xx.|x.x|xx.|x.x|x.x', 'S': '.xx|x..|.x.|..x|xx.', 'T': 'xxx|.x.|.x.|.x.|.x.',
  'U': 'x.x|x.x|x.x|x.x|xxx', 'V': 'x.x|x.x|x.x|x.x|.x.', 'W': 'x.x|x.x|xxx|xxx|x.x',
  'X': 'x.x|x.x|.x.|x.x|x.x', 'Y': 'x.x|x.x|.x.|.x.|.x.', 'Z': 'xxx|..x|.x.|x..|xxx',
  '-': '...|...|xxx|...|...', '.': '...|...|...|...|.x.', '/': '..x|..x|.x.|x..|x..',
  ':': '...|.x.|...|.x.|...', '+': '...|.x.|xxx|.x.|...', '%': 'x.x|..x|.x.|x..|x.x',
  ' ': '...|...|...|...|...', '<': '..x|.x.|x..|.x.|..x', '>': 'x..|.x.|..x|.x.|x..',
  "'": '.x.|.x.|...|...|...', '!': '.x.|.x.|.x.|...|.x.', '?': 'xx.|..x|.x.|...|.x.',
  '(': '.x.|x..|x..|x..|.x.', ')': '.x.|..x|..x|..x|.x.', '=': '...|xxx|...|xxx|...',
};

type Bitmap = { w: number; h: number; bits: Uint8Array };

function parse(src: Record<string, string>): Map<string, Bitmap> {
  const m = new Map<string, Bitmap>();
  for (const [ch, s] of Object.entries(src)) {
    const rows = s.split('|');
    const h = rows.length, w = rows[0].length;
    const bits = new Uint8Array(w * h);
    rows.forEach((r, y) => { for (let x = 0; x < w; x++) bits[y * w + x] = r[x] === 'x' ? 1 : 0; });
    m.set(ch, { w, h, bits });
  }
  return m;
}

const BIG = parse(GLYPHS);
const SMALL = parse(TINY);

export type FontName = 'topaz' | 'hand' | 'tiny';

export const FONT_METRICS: Record<FontName, { advance: number; line: number }> = {
  topaz: { advance: 7, line: 10 },
  hand: { advance: 6, line: 10 },
  tiny: { advance: 4, line: 6 },
};

export function textWidth(s: string, font: FontName = 'topaz'): number {
  return s.length * FONT_METRICS[font].advance;
}

function plot(fb: FrameBuffer, x: number, y: number, c: number): void {
  if (x < fb.x0 || x >= fb.x1 || y < fb.y0 || y >= fb.y1) return;
  fb.px[y * W + x] = c;
}

/** Draw text; returns the x after the last glyph. */
export function drawText(fb: FrameBuffer, s: string, x: number, y: number, c: number, font: FontName = 'topaz', shadow = -1): number {
  x = Math.round(x); y = Math.round(y);
  if (shadow >= 0) drawText(fb, s, x + 1, y + 1, shadow, font);
  const adv = FONT_METRICS[font].advance;
  for (let i = 0; i < s.length; i++) {
    let ch = s[i];
    if (font === 'tiny') ch = ch.toUpperCase();
    const g = (font === 'tiny' ? SMALL : BIG).get(ch) ?? (font === 'tiny' ? SMALL.get('?') : BIG.get('?'))!;
    const gx = x + i * adv;
    if (font === 'topaz') {
      for (let yy = 0; yy < g.h; yy++)
        for (let xx = 0; xx < g.w; xx++)
          if (g.bits[yy * g.w + xx]) { plot(fb, gx + xx, y + yy, c); plot(fb, gx + xx + 1, y + yy, c); }
    } else if (font === 'hand') {
      // Shear: top rows lean right; a per-glyph wobble of ±1px vertically.
      const wob = (hash3(s.charCodeAt(i), i, x) & 3) === 0 ? 1 : 0;
      for (let yy = 0; yy < g.h; yy++) {
        const shear = yy < 2 ? 2 : yy < 5 ? 1 : 0;
        for (let xx = 0; xx < g.w; xx++)
          if (g.bits[yy * g.w + xx]) plot(fb, gx + xx + shear - 1, y + yy + wob, c);
      }
    } else {
      for (let yy = 0; yy < g.h; yy++)
        for (let xx = 0; xx < g.w; xx++)
          if (g.bits[yy * g.w + xx]) plot(fb, gx + xx, y + yy, c);
    }
  }
  return x + s.length * adv;
}

export function drawTextCentered(fb: FrameBuffer, s: string, cx: number, y: number, c: number, font: FontName = 'topaz', shadow = -1): void {
  drawText(fb, s, cx - textWidth(s, font) / 2, y, c, font, shadow);
}

/** Word-wrap to a pixel width; returns lines. */
export function wrapText(s: string, maxW: number, font: FontName = 'topaz'): string[] {
  const adv = FONT_METRICS[font].advance;
  const maxChars = Math.max(1, Math.floor(maxW / adv));
  const out: string[] = [];
  for (const para of s.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const cand = line ? line + ' ' + word : word;
      if (cand.length > maxChars && line) { out.push(line); line = word; }
      else line = cand;
    }
    out.push(line);
  }
  return out;
}
