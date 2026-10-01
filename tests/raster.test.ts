import { describe, expect, it } from 'vitest';
import { FrameBuffer, W } from '../src/render/framebuffer';
import { fillConvex } from '../src/render/raster';

describe('scanline fill', () => {
  it('fills an axis-aligned square exactly', () => {
    const fb = new FrameBuffer();
    fillConvex(fb, [10, 20, 20, 10], [10, 10, 20, 20], 4, 5);
    let n = 0;
    for (const v of fb.px) if (v === 5) n++;
    expect(n).toBe(100);
    expect(fb.px[10 * W + 10]).toBe(5);
    expect(fb.px[20 * W + 20]).toBe(0);
  });
  it('leaves no gaps or overlaps between triangles sharing an edge', () => {
    const fb = new FrameBuffer();
    const pts = [[13.3, 7.9], [91.2, 30.4], [40.7, 88.8], [101.1, 95.5]];
    // Draw two triangles with an additive marker by drawing into separate buffers.
    const a = new FrameBuffer(), b = new FrameBuffer();
    fillConvex(a, [pts[0][0], pts[1][0], pts[2][0]], [pts[0][1], pts[1][1], pts[2][1]], 3, 1);
    fillConvex(b, [pts[1][0], pts[3][0], pts[2][0]], [pts[1][1], pts[3][1], pts[2][1]], 3, 1);
    fillConvex(fb, [pts[0][0], pts[1][0], pts[3][0], pts[2][0]], [pts[0][1], pts[1][1], pts[3][1], pts[2][1]], 4, 1);
    for (let i = 0; i < fb.px.length; i++) {
      expect(a.px[i] + b.px[i]).toBe(fb.px[i]);
    }
  });
  it('respects the clip rectangle', () => {
    const fb = new FrameBuffer();
    fb.setClip(0, 0, 50, 50);
    fillConvex(fb, [-1000, 1000, 1000, -1000], [-1000, -1000, 1000, 1000], 4, 3);
    let n = 0;
    for (const v of fb.px) if (v === 3) n++;
    expect(n).toBe(2500);
  });
});
