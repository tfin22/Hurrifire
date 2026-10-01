// Horizon, "copper" sky and far-ground gradient.
//
// The Amiga copper could rewrite a colour register on every scanline, giving
// smooth sky gradients that cost no palette entries. Here the 224 copper
// entries (framebuffer indices 32..255) are recomputed each frame: 128 for
// the sky, 96 for the hazy far ground. The bands are laid perpendicular to
// the horizon's "up" vector, so they rotate with roll as the horizon does.

import { Vec3 } from '../core/math';
import { Camera } from './camera';
import { FrameBuffer, W } from './framebuffer';
import { C, COPPER_BASE } from './palette';
import { fillCircle } from './raster';

export const SKY_N = 128;
export const GROUND_N = 96;
const SKY0 = COPPER_BASE;
const GROUND0 = COPPER_BASE + SKY_N;

export interface SkyParams {
  altitude: number;
  sun: Vec3;
  /** 0 clear .. 1 thick haze. */
  haze: number;
  /** Far-ground colour (RGB 0..255) — greener in July, browner in September. */
  ground: [number, number, number];
  /** Overall light, 1 = midday, lower towards evening. */
  light: number;
  /** Warmth of the horizon (evening). */
  warmth: number;
}

const EARTH_R = 6_371_000;

/** Tangent of the horizon dip below horizontal at altitude h. */
export function horizonDip(h: number): number {
  return Math.sqrt((2 * Math.max(0, h)) / EARTH_R);
}

export function buildCopper(copper: Uint8Array, p: SkyParams): void {
  const altK = Math.min(1, Math.max(0, p.altitude / 9000));
  const L = p.light;
  // Horizon: pale, hazy; zenith: deeper and bluer with height.
  const hz: [number, number, number] = [
    (192 + 30 * p.warmth) * L, (206 - 10 * p.warmth) * L, (216 - 40 * p.warmth) * L,
  ];
  const zen: [number, number, number] = [
    (78 - 40 * altK) * L, (118 - 45 * altK) * L, (196 - 25 * altK) * L,
  ];
  for (let i = 0; i < SKY_N; i++) {
    const t = Math.pow(i / (SKY_N - 1), 0.55 - 0.15 * p.haze);
    const k = i * 3;
    copper[k] = hz[0] + (zen[0] - hz[0]) * t;
    copper[k + 1] = hz[1] + (zen[1] - hz[1]) * t;
    copper[k + 2] = hz[2] + (zen[2] - hz[2]) * t;
  }
  // Ground: haze at the horizon, the base colour below; haze stronger with height.
  const gh: [number, number, number] = [hz[0] * 0.92, hz[1] * 0.93, hz[2] * 0.95];
  const g = p.ground.map((v) => v * L) as [number, number, number];
  for (let i = 0; i < GROUND_N; i++) {
    const t = Math.pow(i / (GROUND_N - 1), 0.35 + 0.5 * altK + 0.3 * p.haze);
    const k = (SKY_N + i) * 3;
    copper[k] = gh[0] + (g[0] - gh[0]) * t;
    copper[k + 1] = gh[1] + (g[1] - gh[1]) * t;
    copper[k + 2] = gh[2] + (g[2] - gh[2]) * t;
  }
}

/**
 * Fill the camera viewport with sky above the horizon and far-ground gradient
 * below it. Returns the horizon line's camera-space parameters for reuse.
 */
export function drawSky(fb: FrameBuffer, cam: Camera, p: SkyParams): void {
  // World up in camera coordinates: the y-components of the camera axes.
  const ux = cam.m[1], uy = cam.m[4], uz = cam.m[7];
  const eh = -horizonDip(p.altitude);
  const sx = cam.mirror ? -1 : 1;
  // e(x, y) = ux*sx*(x+0.5-cx)/f - uy*(y+0.5-cy)/f + uz
  const A = (ux * sx) / cam.f;
  const Ks = (SKY_N - 1) / 1.1; // e range mapped across the sky table
  const Kg = (GROUND_N - 1) / 1.6;
  const px = fb.px;
  const x0 = cam.vx0, x1 = cam.vx1;
  for (let y = cam.vy0; y < cam.vy1; y++) {
    let e = A * (x0 + 0.5 - cam.cx) - (uy * (y + 0.5 - cam.cy)) / cam.f + uz - eh;
    let o = y * W + x0;
    for (let x = x0; x < x1; x++, o++, e += A) {
      if (e >= 0) {
        const i = (e * Ks) | 0;
        px[o] = SKY0 + (i > SKY_N - 1 ? SKY_N - 1 : i);
      } else {
        const i = (-e * Kg) | 0;
        px[o] = GROUND0 + (i > GROUND_N - 1 ? GROUND_N - 1 : i);
      }
    }
  }
}

/** The sun's disc. Returns its screen position if on screen. */
export function drawSun(fb: FrameBuffer, cam: Camera, sun: Vec3): { x: number; y: number } | null {
  const t = [0, 0, 0];
  cam.dirToCam(sun.x, sun.y, sun.z, t);
  if (t[2] <= 0.05) return null;
  const x = cam.projX(t[0], t[2]), y = cam.projY(t[1], t[2]);
  const r = Math.max(3, cam.f * 0.012);
  fillCircle(fb, x, y, r * 1.8, C.CHALK);
  fillCircle(fb, x, y, r, C.WHITE);
  return { x, y };
}

/** Screen-space horizon: the two points where it crosses the viewport, or null. */
export function horizonLine(cam: Camera, altitude: number): { x0: number; y0: number; x1: number; y1: number } | null {
  const ux = cam.m[1] * (cam.mirror ? -1 : 1), uy = cam.m[4], uz = cam.m[7];
  const eh = -horizonDip(altitude);
  // ux*(x-cx)/f - uy*(y-cy)/f + uz - eh = 0
  if (Math.abs(uy) > 1e-6) {
    const yAt = (x: number) => cam.cy + (ux * (x - cam.cx) + (uz - eh) * cam.f) / uy;
    return { x0: cam.vx0, y0: yAt(cam.vx0), x1: cam.vx1, y1: yAt(cam.vx1) };
  }
  return null;
}
