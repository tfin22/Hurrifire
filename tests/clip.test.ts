import { describe, expect, it } from 'vitest';
import { clipNear, clipSegmentNear } from '../src/render/clip';

const NEAR = 1;

function clip(poly: number[][]): number[][] {
  const flat = poly.flat();
  const out: number[] = [];
  const m = clipNear(flat, poly.length, NEAR, out);
  const res: number[][] = [];
  for (let i = 0; i < m; i++) res.push([out[i * 3], out[i * 3 + 1], out[i * 3 + 2]]);
  return res;
}

function area2D(p: number[][]): number {
  // Area in the x/z plane (for polygons lying in y = const).
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, , z0] = p[i];
    const [x1, , z1] = p[(i + 1) % p.length];
    a += x0 * z1 - x1 * z0;
  }
  return Math.abs(a) / 2;
}

describe('near-plane clipping (Sutherland–Hodgman)', () => {
  it('keeps a polygon entirely in front unchanged', () => {
    const tri = [[0, 0, 5], [1, 0, 6], [-1, 1, 7]];
    expect(clip(tri)).toEqual(tri);
  });

  it('rejects a polygon entirely behind', () => {
    expect(clip([[0, 0, -5], [1, 0, 0.5], [-1, 1, 0.99]])).toEqual([]);
  });

  it('keeps vertices exactly on the plane', () => {
    const tri = [[0, 0, 1], [1, 0, 1], [0, 1, 2]];
    expect(clip(tri)).toEqual(tri);
  });

  it('clips one vertex behind into a quad', () => {
    const r = clip([[0, 0, -1], [2, 0, 3], [-2, 0, 3]]);
    expect(r.length).toBe(4);
    for (const v of r) expect(v[2]).toBeGreaterThanOrEqual(NEAR - 1e-12);
  });

  it('clips two vertices behind into a triangle', () => {
    const r = clip([[0, 0, 3], [2, 0, -1], [-2, 0, -1]]);
    expect(r.length).toBe(3);
    for (const v of r) expect(v[2]).toBeGreaterThanOrEqual(NEAR - 1e-12);
  });

  it('computes intersection points on the plane at the right place', () => {
    const r = clip([[0, 0, 3], [0, 4, -1], [0, -4, -1]]);
    const onPlane = r.filter((v) => v[2] === NEAR);
    expect(onPlane.length).toBe(2);
    const ys = onPlane.map((v) => v[1]).sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(-2, 10);
    expect(ys[1]).toBeCloseTo(2, 10);
  });

  it('preserves the in-front area for a square straddling the plane', () => {
    // Square in the y=0 plane from z=-1 to z=3, x from -1 to 1: area in front = 2 * 2 = 4.
    const r = clip([[-1, 0, -1], [1, 0, -1], [1, 0, 3], [-1, 0, 3]]);
    expect(area2D(r)).toBeCloseTo(4, 10);
  });

  it('preserves winding order', () => {
    const sq = [[-1, 0, -1], [1, 0, -1], [1, 0, 3], [-1, 0, 3]];
    const signed = (p: number[][]) => {
      let a = 0;
      for (let i = 0; i < p.length; i++) a += p[i][0] * p[(i + 1) % p.length][2] - p[(i + 1) % p.length][0] * p[i][2];
      return Math.sign(a);
    };
    expect(signed(clip(sq))).toBe(signed(sq));
  });

  it('handles a polygon touching the plane at one vertex only from behind', () => {
    const r = clip([[0, 0, 1], [1, 0, 0], [-1, 0, 0]]);
    // Only the vertex on the plane survives; degenerate output, no NaNs.
    for (const v of r) for (const c of v) expect(Number.isFinite(c)).toBe(true);
    expect(r.length).toBeLessThanOrEqual(3);
  });

  it('never produces vertices behind the plane for random polygons', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 10 - 5;
    for (let k = 0; k < 500; k++) {
      const n = 3 + (k % 5);
      const poly = Array.from({ length: n }, () => [rnd(), rnd(), rnd()]);
      for (const v of clip(poly)) {
        expect(v[2]).toBeGreaterThanOrEqual(NEAR - 1e-9);
        for (const c of v) expect(Number.isFinite(c)).toBe(true);
      }
    }
  });

  it('clips segments', () => {
    const a = [0, 0, -1], b = [0, 2, 3];
    expect(clipSegmentNear(a, b, NEAR)).toBe(true);
    expect(a[2]).toBe(NEAR);
    expect(a[1]).toBeCloseTo(1, 10);
    expect(clipSegmentNear([0, 0, -2], [0, 0, 0], NEAR)).toBe(false);
  });
});
