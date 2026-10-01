// Converts the indexed framebuffer to RGBA once per frame through a palette
// lookup table, applying palette fades (greyout, blackout, redout, cloud
// whiteout, sun dazzle, fade to black) the Amiga way: by rewriting colour
// registers, quantised to 12 bits so fades step visibly.
//
// Radial effects (the grey tunnel closing in under G) use a per-pixel ring
// index: there are RINGS copies of the 256-entry LUT, one per distance band
// from the view centre.

import { FrameBuffer, H, W } from './framebuffer';
import { COPPER_BASE, COPPER_COUNT, NUM_COLOURS, PALETTE_12, rgb12to24 } from './palette';

export interface ScreenEffects {
  /** Greyout tunnel, 0..1 (1 = fully greyed to the centre). */
  grey: number;
  /** Blackout, 0..1. */
  black: number;
  /** Redout, 0..1. */
  red: number;
  /** Cloud whiteout, 0..1. */
  white: number;
  /** Sun dazzle wash, 0..1. */
  dazzle: number;
  /** Global fade to black (screen transitions), 0..1. */
  fade: number;
  /** Red flicker at the edges (wounded pilot), 0..1. */
  woundEdge: number;
  /** Palette-cycle phase for title screens etc. */
  cycle?: number;
}

export const noEffects = (): ScreenEffects => ({ grey: 0, black: 0, red: 0, white: 0, dazzle: 0, fade: 0, woundEdge: 0 });

const RINGS = 8;

export class Display {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private img: ImageData;
  private out: Uint32Array;
  private lut = new Uint32Array(256 * RINGS);
  private ring = new Uint8Array(W * H);
  /** 0..255 RGB for the copper entries (32..255), written by the sky renderer. */
  readonly copper = new Uint8Array(COPPER_COUNT * 3);
  /** Base palette as 24-bit RGB; may be modified for palette cycling. */
  readonly base = new Uint8Array(NUM_COLOURS * 3);
  private ringCentreY = -1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('No 2D context');
    this.ctx = ctx;
    this.img = ctx.createImageData(W, H);
    this.out = new Uint32Array(this.img.data.buffer);
    this.resetPalette();
    this.setRingCentre(H / 2);
  }

  resetPalette(): void {
    for (let i = 0; i < NUM_COLOURS; i++) {
      const [r, g, b] = rgb12to24(PALETTE_12[i]);
      this.base[i * 3] = r; this.base[i * 3 + 1] = g; this.base[i * 3 + 2] = b;
    }
  }

  /** The tunnel effects centre on the 3D view, which sits above the instrument panel. */
  setRingCentre(cy: number): void {
    cy = Math.round(cy);
    if (cy === this.ringCentreY) return;
    this.ringCentreY = cy;
    const maxR = Math.hypot(W / 2, Math.max(cy, H - cy));
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const r = Math.hypot((x + 0.5 - W / 2) * 0.9, y + 0.5 - cy) / maxR;
        this.ring[y * W + x] = Math.min(RINGS - 1, Math.floor(r * r * 1.6 * RINGS));
      }
    }
  }

  private buildLut(fx: ScreenEffects): void {
    const q = (v: number) => (Math.max(0, Math.min(15, Math.round(v / 17))) * 17) | 0;
    for (let ring = 0; ring < RINGS; ring++) {
      const e = ring / (RINGS - 1); // 0 centre .. 1 edge
      const tunnel = clamp01((fx.grey * 1.7 - (1 - e)) * 2.2);
      const greyAmt = clamp01(fx.grey * 1.4) * (0.35 + 0.65 * e);
      const dark = clamp01(Math.max(fx.black, tunnel * 0.85 + fx.black));
      const redAmt = clamp01(fx.red * (0.5 + 0.5 * e) + fx.woundEdge * e * e);
      const base = ring * 256;
      for (let i = 0; i < 256; i++) {
        let r: number, g: number, b: number;
        if (i < NUM_COLOURS) {
          r = this.base[i * 3]; g = this.base[i * 3 + 1]; b = this.base[i * 3 + 2];
        } else {
          const k = (i - COPPER_BASE) * 3;
          r = this.copper[k]; g = this.copper[k + 1]; b = this.copper[k + 2];
        }
        if (fx.white > 0) {
          const t = fx.white;
          r += (205 - r) * t; g += (210 - g) * t; b += (215 - b) * t;
        }
        if (fx.dazzle > 0) {
          const t = fx.dazzle;
          r += (255 - r) * t; g += (250 - g) * t; b += (235 - b) * t;
        }
        if (greyAmt > 0) {
          const l = 0.3 * r + 0.59 * g + 0.11 * b;
          r += (l - r) * greyAmt; g += (l - g) * greyAmt; b += (l - b) * greyAmt;
        }
        if (redAmt > 0) {
          r += (200 - r) * redAmt; g += (20 - g) * redAmt; b += (20 - b) * redAmt;
        }
        const k = (1 - dark) * (1 - fx.fade);
        r *= k; g *= k; b *= k;
        this.lut[base + i] = 0xff000000 | (q(b) << 16) | (q(g) << 8) | q(r);
      }
    }
  }

  present(fb: FrameBuffer, fx: ScreenEffects): void {
    this.buildLut(fx);
    const px = fb.px, out = this.out, lut = this.lut, ring = this.ring;
    const n = W * H;
    for (let i = 0; i < n; i++) out[i] = lut[(ring[i] << 8) | px[i]];
    this.ctx.putImageData(this.img, 0, 0);
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
