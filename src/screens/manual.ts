// The manual: Pilot's Notes, from the main menu. A contents page, then each
// chapter laid out on buff pages like the logbook, turned with left and
// right (or a tap at either edge).

import type { App, Screen } from '../app';
import { MANUAL } from '../content/text/manual';
import { noEffects, ScreenEffects } from '../render/display';
import { drawText, drawTextCentered, wrapText } from '../render/font';
import { FrameBuffer, W } from '../render/framebuffer';
import { C } from '../render/palette';
import { fillRect, hline, rectOutline } from '../render/raster';
import { Menu, panel } from './ui';

const X0 = 18, X1 = 302, TOP = 30, BOTTOM = 232, KEY_W = 74, LINE = 7;

/** One line on a page. */
interface Line {
  y: number;
  text: string;
  kind: 'h' | 'p' | 'b' | 'key' | 'row';
  x: number;
}

/** Lay a chapter out on as many pages as it takes. */
export function paginate(body: readonly string[]): Line[][] {
  const pages: Line[][] = [[]];
  let y = TOP;
  const room = (n: number) => {
    if (y + n * LINE > BOTTOM && pages[pages.length - 1].length) { pages.push([]); y = TOP; }
  };
  const put = (l: Omit<Line, 'y'>) => { pages[pages.length - 1].push({ ...l, y }); };
  /** Lines a paragraph will take. */
  const height = (para: string) => para.startsWith('# ') ? 1
    : para.startsWith('- ') ? wrapText(para.slice(2), X1 - X0 - 8, 'tiny').length
    : para.includes(' | ') ? wrapText(para.split(' | ')[1], X1 - X0 - KEY_W, 'tiny').length
    : wrapText(para, X1 - X0, 'tiny').length;
  body.forEach((para, i) => {
    if (para.startsWith('# ')) {
      // A heading goes over with the paragraph after it, never alone at the foot of a page.
      if (y > TOP) y += 4;
      room(2 + Math.min(4, body[i + 1] ? height(body[i + 1]) : 0));
      put({ text: para.slice(2), kind: 'h', x: X0 });
      y += LINE + 2;
    } else if (para.startsWith('- ')) {
      const lines = wrapText(para.slice(2), X1 - X0 - 8, 'tiny');
      room(lines.length);
      lines.forEach((t, i) => { if (i === 0) put({ text: '-', kind: 'b', x: X0 }); put({ text: t, kind: 'p', x: X0 + 8 }); y += LINE; });
      y += 1;
    } else if (para.includes(' | ')) {
      const [key, what] = para.split(' | ');
      const lines = wrapText(what, X1 - X0 - KEY_W, 'tiny');
      room(lines.length);
      put({ text: key, kind: 'key', x: X0 });
      lines.forEach((t) => { put({ text: t, kind: 'row', x: X0 + KEY_W }); y += LINE; });
      y += 1;
    } else {
      const lines = wrapText(para, X1 - X0, 'tiny');
      room(lines.length);
      lines.forEach((t) => { put({ text: t, kind: 'p', x: X0 }); y += LINE; });
      y += 3;
    }
  });
  return pages;
}

export class ManualScreen implements Screen {
  touchMode = 'menu' as const;
  music = 'title' as const;
  private menu: Menu;
  /** The chapter open, or -1 for the contents. */
  private chapter = -1;
  private page = 0;
  private pages: Line[][] = [];

  constructor(private app: App, private back: () => void) {
    this.menu = new Menu([
      ...MANUAL.map((c, i) => ({ label: c.title, act: () => this.open(i, 0) })),
      { label: 'BACK', act: () => this.back() },
    ], 70, 44, 180, 15);
  }

  private open(chapter: number, page: number): void {
    this.chapter = chapter;
    this.pages = paginate(MANUAL[chapter].body);
    this.page = page < 0 ? this.pages.length - 1 : page;
  }

  /** On a page, forwards or back; past the end of a chapter into the next. */
  private turn(d: 1 | -1): void {
    const p = this.page + d;
    if (p >= 0 && p < this.pages.length) { this.page = p; return; }
    const c = this.chapter + d;
    if (c >= 0 && c < MANUAL.length) this.open(c, d > 0 ? 0 : -1);
  }

  frame(): void {
    const s = this.app.input;
    if (this.chapter < 0) {
      if (s.consume('back')) { this.back(); return; }
      this.menu.input(s);
      return;
    }
    const toContents = () => { this.menu.sel = this.chapter; this.chapter = -1; };
    if (s.consume('back') || s.consume('ok')) { toContents(); return; }
    if (s.consume('right') || s.consume('down')) this.turn(1);
    if (s.consume('left') || s.consume('up')) this.turn(-1);
    for (const t of s.taps) {
      if (t.x < 90) this.turn(-1);
      else if (t.x > 230) this.turn(1);
      else { toContents(); break; }
    }
    s.taps.length = 0;
  }

  tick(): void {}

  render(fb: FrameBuffer): void {
    fillRect(fb, 0, 0, W, 256, C.RAF_EARTH_D);
    if (this.chapter < 0) {
      panel(fb, 40, 14, 240, 226);
      drawTextCentered(fb, "PILOT'S NOTES", 160, 20, C.SIGHT);
      drawTextCentered(fb, 'HURRICANE I AND SPITFIRE I, 1940', 160, 30, C.CHALK, 'tiny');
      this.menu.draw(fb);
      return;
    }
    // A buff page.
    fillRect(fb, 10, 6, 300, 244, C.STUBBLE);
    rectOutline(fb, 10, 6, 300, 244, C.RAF_EARTH);
    drawText(fb, `${this.chapter + 1}. ${MANUAL[this.chapter].title}`, X0, 11, C.BLUE);
    hline(fb, 14, 305, 22, C.BLUE);
    for (const l of this.pages[this.page] ?? []) {
      const col = l.kind === 'h' ? C.BLUE : l.kind === 'key' ? C.RED : C.BLACK;
      drawText(fb, l.text, l.x, l.y, col, 'tiny');
      if (l.kind === 'h') hline(fb, l.x, l.x + l.text.length * 4 - 2, l.y + 6, C.BLUE);
    }
    hline(fb, 14, 305, 236, C.GOLD);
    const n = this.pages.length;
    drawText(fb, this.chapter > 0 || this.page > 0 ? '< BACK' : '', X0, 240, C.RAF_EARTH, 'tiny');
    drawTextCentered(fb, `PAGE ${this.page + 1} OF ${n}  -  TAP HERE FOR CONTENTS`, 160, 240, C.RAF_EARTH, 'tiny');
    if (this.page < n - 1 || this.chapter < MANUAL.length - 1) drawText(fb, 'ON >', X1 - 16, 240, C.RAF_EARTH, 'tiny');
  }

  effects(): ScreenEffects {
    return noEffects();
  }
}
