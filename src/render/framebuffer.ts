// The indexed 8-bit framebuffer: Amiga PAL lowres, 320×256.

export const W = 320;
export const H = 256;

export class FrameBuffer {
  readonly w = W;
  readonly h = H;
  readonly px = new Uint8Array(W * H);
  // Clip rectangle, half-open: [x0, x1) × [y0, y1).
  x0 = 0;
  y0 = 0;
  x1 = W;
  y1 = H;

  setClip(x0: number, y0: number, x1: number, y1: number): void {
    this.x0 = Math.max(0, x0 | 0);
    this.y0 = Math.max(0, y0 | 0);
    this.x1 = Math.min(W, x1 | 0);
    this.y1 = Math.min(H, y1 | 0);
  }

  resetClip(): void {
    this.x0 = 0; this.y0 = 0; this.x1 = W; this.y1 = H;
  }

  clear(c: number): void {
    this.px.fill(c);
  }
}
