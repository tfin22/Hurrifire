// 2D rasterisation into the indexed framebuffer: convex scanline polygon fill
// (the workhorse of the 3D renderer), lines, rectangles and circles.
// Every primitive respects the framebuffer's clip rectangle, which is how
// screen-edge clipping is done after projection.

import { FrameBuffer, H, W } from './framebuffer';

const leftX = new Float32Array(H);
const rightX = new Float32Array(H);

/** Running count of filled polygons, for the debug overlay. */
export const rasterStats = { polys: 0 };

/**
 * Fill a convex polygon with vertices (xs[i], ys[i]) in screen pixels.
 * Pixel-centre sampling with a top-left rule, so adjacent polygons that share
 * an edge neither overlap nor leave gaps.
 */
export function fillConvex(fb: FrameBuffer, xs: ArrayLike<number>, ys: ArrayLike<number>, n: number, c: number): void {
  if (n < 3) return;
  let minY = Infinity, maxY = -Infinity;
  let minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < n; i++) {
    const y = ys[i], x = xs[i];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  }
  if (maxX < fb.x0 || minX >= fb.x1) return;
  const y0 = Math.max(fb.y0, Math.ceil(minY - 0.5));
  const y1 = Math.min(fb.y1 - 1, Math.ceil(maxY - 0.5) - 1);
  if (y0 > y1) return;
  for (let y = y0; y <= y1; y++) {
    leftX[y] = Infinity;
    rightX[y] = -Infinity;
  }
  for (let i = 0; i < n; i++) {
    let xa = xs[i], ya = ys[i];
    const j = i + 1 === n ? 0 : i + 1;
    let xb = xs[j], yb = ys[j];
    if (ya === yb) continue;
    if (ya > yb) {
      let t = xa; xa = xb; xb = t;
      t = ya; ya = yb; yb = t;
    }
    const ys0 = Math.max(y0, Math.ceil(ya - 0.5));
    const ye = Math.min(y1, Math.ceil(yb - 0.5) - 1);
    if (ys0 > ye) continue;
    const slope = (xb - xa) / (yb - ya);
    let x = xa + (ys0 + 0.5 - ya) * slope;
    for (let y = ys0; y <= ye; y++) {
      if (x < leftX[y]) leftX[y] = x;
      if (x > rightX[y]) rightX[y] = x;
      x += slope;
    }
  }
  const px = fb.px;
  const cx0 = fb.x0, cx1 = fb.x1;
  for (let y = y0; y <= y1; y++) {
    const l = leftX[y];
    if (l === Infinity) continue;
    let xl = Math.ceil(l - 0.5);
    let xr = Math.ceil(rightX[y] - 0.5); // exclusive
    if (xl < cx0) xl = cx0;
    if (xr > cx1) xr = cx1;
    if (xl < xr) px.fill(c, y * W + xl, y * W + xr);
  }
  rasterStats.polys++;
}

export function fillRect(fb: FrameBuffer, x: number, y: number, w: number, h: number, c: number): void {
  const xa = Math.max(fb.x0, x | 0), xb = Math.min(fb.x1, (x + w) | 0);
  const ya = Math.max(fb.y0, y | 0), yb = Math.min(fb.y1, (y + h) | 0);
  if (xa >= xb) return;
  const px = fb.px;
  for (let yy = ya; yy < yb; yy++) px.fill(c, yy * W + xa, yy * W + xb);
}

/** Checkerboard-stippled rectangle: the Amiga's poor man's transparency. */
export function stippleRect(fb: FrameBuffer, x: number, y: number, w: number, h: number, c: number, phase = 0): void {
  const xa = Math.max(fb.x0, x | 0), xb = Math.min(fb.x1, (x + w) | 0);
  const ya = Math.max(fb.y0, y | 0), yb = Math.min(fb.y1, (y + h) | 0);
  const px = fb.px;
  for (let yy = ya; yy < yb; yy++) {
    for (let xx = xa + ((xa + yy + phase) & 1); xx < xb; xx += 2) px[yy * W + xx] = c;
  }
}

export function rectOutline(fb: FrameBuffer, x: number, y: number, w: number, h: number, c: number): void {
  hline(fb, x, x + w - 1, y, c);
  hline(fb, x, x + w - 1, y + h - 1, c);
  vline(fb, x, y, y + h - 1, c);
  vline(fb, x + w - 1, y, y + h - 1, c);
}

export function pset(fb: FrameBuffer, x: number, y: number, c: number): void {
  x = Math.floor(x); y = Math.floor(y);
  if (x < fb.x0 || x >= fb.x1 || y < fb.y0 || y >= fb.y1) return;
  fb.px[y * W + x] = c;
}

export function hline(fb: FrameBuffer, xa: number, xb: number, y: number, c: number): void {
  y |= 0;
  if (y < fb.y0 || y >= fb.y1) return;
  if (xa > xb) { const t = xa; xa = xb; xb = t; }
  xa = Math.max(fb.x0, xa | 0);
  xb = Math.min(fb.x1 - 1, xb | 0);
  if (xa <= xb) fb.px.fill(c, y * W + xa, y * W + xb + 1);
}

export function vline(fb: FrameBuffer, x: number, ya: number, yb: number, c: number): void {
  x |= 0;
  if (x < fb.x0 || x >= fb.x1) return;
  if (ya > yb) { const t = ya; ya = yb; yb = t; }
  ya = Math.max(fb.y0, ya | 0);
  yb = Math.min(fb.y1 - 1, yb | 0);
  for (let y = ya; y <= yb; y++) fb.px[y * W + x] = c;
}

const OUT_L = 1, OUT_R = 2, OUT_T = 4, OUT_B = 8;
function outcode(fb: FrameBuffer, x: number, y: number): number {
  let c = 0;
  if (x < fb.x0) c |= OUT_L; else if (x > fb.x1 - 1) c |= OUT_R;
  if (y < fb.y0) c |= OUT_T; else if (y > fb.y1 - 1) c |= OUT_B;
  return c;
}

/** Bresenham line with Cohen–Sutherland clipping to the clip rectangle. */
export function line(fb: FrameBuffer, xa: number, ya: number, xb: number, yb: number, c: number): void {
  let ca = outcode(fb, xa, ya), cb = outcode(fb, xb, yb);
  for (let guard = 0; guard < 8; guard++) {
    if (!(ca | cb)) break;
    if (ca & cb) return;
    const co = ca || cb;
    let x = 0, y = 0;
    if (co & OUT_T) { x = xa + ((xb - xa) * (fb.y0 - ya)) / (yb - ya); y = fb.y0; }
    else if (co & OUT_B) { x = xa + ((xb - xa) * (fb.y1 - 1 - ya)) / (yb - ya); y = fb.y1 - 1; }
    else if (co & OUT_R) { y = ya + ((yb - ya) * (fb.x1 - 1 - xa)) / (xb - xa); x = fb.x1 - 1; }
    else { y = ya + ((yb - ya) * (fb.x0 - xa)) / (xb - xa); x = fb.x0; }
    if (co === ca) { xa = x; ya = y; ca = outcode(fb, xa, ya); }
    else { xb = x; yb = y; cb = outcode(fb, xb, yb); }
  }
  if (ca | cb) return;
  let x0 = Math.round(xa), y0 = Math.round(ya);
  const x1 = Math.round(xb), y1 = Math.round(yb);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  const px = fb.px;
  for (let i = 0; i < 2000; i++) {
    if (x0 >= fb.x0 && x0 < fb.x1 && y0 >= fb.y0 && y0 < fb.y1) px[y0 * W + x0] = c;
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/** Midpoint circle outline. */
export function circle(fb: FrameBuffer, cx: number, cy: number, r: number, c: number): void {
  cx = Math.round(cx); cy = Math.round(cy); r = Math.round(r);
  if (r <= 0) { pset(fb, cx, cy, c); return; }
  let x = r, y = 0, err = 1 - r;
  while (x >= y) {
    pset(fb, cx + x, cy + y, c); pset(fb, cx - x, cy + y, c);
    pset(fb, cx + x, cy - y, c); pset(fb, cx - x, cy - y, c);
    pset(fb, cx + y, cy + x, c); pset(fb, cx - y, cy + x, c);
    pset(fb, cx + y, cy - x, c); pset(fb, cx - y, cy - x, c);
    y++;
    if (err < 0) err += 2 * y + 1;
    else { x--; err += 2 * (y - x) + 1; }
  }
}

export function fillCircle(fb: FrameBuffer, cx: number, cy: number, r: number, c: number): void {
  const r2 = r * r;
  const y0 = Math.ceil(cy - r), y1 = Math.floor(cy + r);
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy;
    const dx = Math.sqrt(Math.max(0, r2 - dy * dy));
    hline(fb, Math.ceil(cx - dx - 0.5), Math.ceil(cx + dx - 0.5) - 1, y, c);
  }
}
