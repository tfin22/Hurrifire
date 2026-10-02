// Sutherland–Hodgman clipping of a polygon against the near plane z = near,
// in camera space. "This is where the bugs live", so it is deliberately
// simple and unit tested (tests/clip.test.ts).
//
// Polygons are flat arrays [x0,y0,z0, x1,y1,z1, ...]. The output is written
// into `out` and the vertex count returned. Keeps everything with z >= near.

export function clipNear(inp: ArrayLike<number>, n: number, near: number, out: Float64Array | number[]): number {
  if (n === 0) return 0;
  let m = 0;
  let px = inp[(n - 1) * 3], py = inp[(n - 1) * 3 + 1], pz = inp[(n - 1) * 3 + 2];
  let pIn = pz >= near;
  for (let i = 0; i < n; i++) {
    const cx = inp[i * 3], cy = inp[i * 3 + 1], cz = inp[i * 3 + 2];
    const cIn = cz >= near;
    if (cIn !== pIn) {
      // Edge crosses the plane: emit the intersection.
      const t = (near - pz) / (cz - pz);
      out[m * 3] = px + (cx - px) * t;
      out[m * 3 + 1] = py + (cy - py) * t;
      out[m * 3 + 2] = near;
      m++;
    }
    if (cIn) {
      out[m * 3] = cx;
      out[m * 3 + 1] = cy;
      out[m * 3 + 2] = cz;
      m++;
    }
    px = cx; py = cy; pz = cz; pIn = cIn;
  }
  return m;
}

/** Clip a 3D segment to z >= near. Returns false if fully behind. */
export function clipSegmentNear(a: number[], b: number[], near: number): boolean {
  const aIn = a[2] >= near, bIn = b[2] >= near;
  if (!aIn && !bIn) return false;
  if (aIn && bIn) return true;
  const t = (near - a[2]) / (b[2] - a[2]);
  const ix = a[0] + (b[0] - a[0]) * t, iy = a[1] + (b[1] - a[1]) * t;
  if (!aIn) { a[0] = ix; a[1] = iy; a[2] = near; }
  else { b[0] = ix; b[1] = iy; b[2] = near; }
  return true;
}
