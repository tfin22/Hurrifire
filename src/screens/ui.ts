// Small UI toolkit for the 2D screens: Amiga-style menus driven by keys,
// gamepad and taps on the 320×256 image.

import type { InputState } from '../input/input';
import { drawText, drawTextCentered, textWidth, wrapText } from '../render/font';
import { FrameBuffer, W } from '../render/framebuffer';
import { C } from '../render/palette';
import { fillRect, hline, rectOutline } from '../render/raster';

export interface MenuItem {
  label: string;
  act: () => void;
  disabled?: boolean;
  /** Left/right change a value. */
  adjust?: (dir: -1 | 1) => void;
}

export class Menu {
  sel = 0;
  constructor(public items: MenuItem[], public x = 80, public y = 100, public w = 160, public rowH = 13) {}

  /** Handle input; returns true if something was activated. */
  input(s: InputState): boolean {
    const n = this.items.length;
    while (s.consume('up')) this.sel = (this.sel + n - 1) % n;
    while (s.consume('down')) this.sel = (this.sel + 1) % n;
    const it = this.items[this.sel];
    if (s.consume('left')) it?.adjust?.(-1);
    if (s.consume('right')) it?.adjust?.(1);
    for (const t of s.taps) {
      const i = Math.floor((t.y - this.y + 2) / this.rowH);
      if (i >= 0 && i < n && t.x >= this.x - 10 && t.x <= this.x + this.w + 10) {
        const item = this.items[i];
        if (item.disabled) continue;
        if (item.adjust && t.x > this.x + this.w * 0.75) { item.adjust(1); this.sel = i; continue; }
        if (item.adjust && t.x < this.x + this.w * 0.25) { item.adjust(-1); this.sel = i; continue; }
        this.sel = i;
        item.act();
        return true;
      }
    }
    if (s.consume('ok') && it && !it.disabled) { it.act(); return true; }
    return false;
  }

  draw(fb: FrameBuffer, title?: string): void {
    if (title) drawTextCentered(fb, title, this.x + this.w / 2, this.y - 18, C.SIGHT, 'topaz', C.BLACK);
    this.items.forEach((it, i) => {
      const y = this.y + i * this.rowH;
      const on = i === this.sel;
      if (on) fillRect(fb, this.x - 6, y - 2, this.w + 12, this.rowH - 1, C.SMOKE);
      const col = it.disabled ? C.GREY_D : on ? C.WHITE : C.CHALK;
      if (it.adjust) {
        drawText(fb, '<', this.x - 4, y, on ? C.SIGHT : C.GREY_D);
        drawText(fb, '>', this.x + this.w - 3, y, on ? C.SIGHT : C.GREY_D);
        drawTextCentered(fb, it.label, this.x + this.w / 2, y, col);
      } else drawTextCentered(fb, it.label, this.x + this.w / 2, y, col);
    });
  }
}

/** A bevelled Workbench-style panel. */
export function panel(fb: FrameBuffer, x: number, y: number, w: number, h: number, fill: number = C.PANEL): void {
  fillRect(fb, x, y, w, h, fill);
  hline(fb, x, x + w - 1, y, C.GREY_L);
  hline(fb, x, x + w - 1, y + h - 1, C.BLACK);
  rectOutline(fb, x - 1, y - 1, w + 2, h + 2, C.BLACK);
}

/** Word-wrapped paragraph; returns the y after it. */
export function paragraph(fb: FrameBuffer, text: string, x: number, y: number, w: number, c: number, font: 'topaz' | 'hand' | 'tiny' = 'topaz', lineH = 10): number {
  for (const line of wrapText(text, w, font)) {
    drawText(fb, line, x, y, c, font);
    y += lineH;
  }
  return y;
}

export function centreX(s: string): number {
  return (W - textWidth(s)) / 2;
}

/** "Press to continue" helper: any tap, ok or back. */
export function anyContinue(s: InputState): boolean {
  return s.taps.length > 0 || s.consume('ok') || s.consume('back') || s.consume('tallyHo');
}
