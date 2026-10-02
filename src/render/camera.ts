// Camera: position, orientation and projection onto a viewport of the
// framebuffer. World → camera is c = M · (p − pos), M's rows being the
// camera's right/up/forward axes in world space.

import { Quat, Vec3 } from '../core/math';
import { TUNING } from '../tuning';

export class Camera {
  readonly pos = new Vec3();
  /** Row-major: rows are right, up, forward in world coordinates. */
  readonly m = new Float64Array(9);
  f = 266;
  cx = 160;
  cy = 128;
  near = TUNING.render.near;
  /** Viewport in framebuffer pixels. */
  vx0 = 0;
  vy0 = 0;
  vx1 = 320;
  vy1 = 256;
  /** Mirror image (rear-view mirror). */
  mirror = false;
  /** Half-angle tangents for frustum culling. */
  tanX = 1;
  tanY = 1;

  setViewport(x0: number, y0: number, x1: number, y1: number, fovDeg: number, cy?: number): void {
    this.vx0 = x0; this.vy0 = y0; this.vx1 = x1; this.vy1 = y1;
    this.cx = (x0 + x1) / 2;
    this.cy = cy ?? (y0 + y1) / 2;
    this.f = (x1 - x0) / 2 / Math.tan((fovDeg * Math.PI) / 360);
    this.tanX = (x1 - x0) / 2 / this.f;
    this.tanY = Math.max(this.cy - y0, y1 - this.cy) / this.f;
  }

  setOrientation(q: Quat): void {
    const b = q.toMat3(); // columns = body axes in world
    const m = this.m;
    m[0] = b[0]; m[1] = b[3]; m[2] = b[6];
    m[3] = b[1]; m[4] = b[4]; m[5] = b[7];
    m[6] = b[2]; m[7] = b[5]; m[8] = b[8];
  }

  right(out = new Vec3()): Vec3 { return out.set(this.m[0], this.m[1], this.m[2]); }
  up(out = new Vec3()): Vec3 { return out.set(this.m[3], this.m[4], this.m[5]); }
  forward(out = new Vec3()): Vec3 { return out.set(this.m[6], this.m[7], this.m[8]); }

  /** World point → camera space into out[0..2]. */
  toCam(x: number, y: number, z: number, out: number[] | Float64Array, o = 0): void {
    const dx = x - this.pos.x, dy = y - this.pos.y, dz = z - this.pos.z;
    const m = this.m;
    out[o] = m[0] * dx + m[1] * dy + m[2] * dz;
    out[o + 1] = m[3] * dx + m[4] * dy + m[5] * dz;
    out[o + 2] = m[6] * dx + m[7] * dy + m[8] * dz;
  }

  /** World direction → camera space. */
  dirToCam(x: number, y: number, z: number, out: number[] | Float64Array): void {
    const m = this.m;
    out[0] = m[0] * x + m[1] * y + m[2] * z;
    out[1] = m[3] * x + m[4] * y + m[5] * z;
    out[2] = m[6] * x + m[7] * y + m[8] * z;
  }

  projX(x: number, z: number): number {
    return this.mirror ? this.cx - (this.f * x) / z : this.cx + (this.f * x) / z;
  }
  projY(y: number, z: number): number {
    return this.cy - (this.f * y) / z;
  }

  /** Project a world point; returns false if behind the near plane. */
  project(p: Vec3, out: { x: number; y: number; z: number }): boolean {
    const t = [0, 0, 0];
    this.toCam(p.x, p.y, p.z, t);
    if (t[2] < this.near) return false;
    out.x = this.projX(t[0], t[2]);
    out.y = this.projY(t[1], t[2]);
    out.z = t[2];
    return true;
  }

  /** Sphere vs view frustum (camera-space centre). */
  sphereVisible(x: number, y: number, z: number, r: number): boolean {
    if (z + r < this.near) return false;
    const kx = Math.sqrt(1 + this.tanX * this.tanX), ky = Math.sqrt(1 + this.tanY * this.tanY);
    if (Math.abs(x) - z * this.tanX > r * kx) return false;
    if (Math.abs(y) - z * this.tanY > r * ky) return false;
    return true;
  }
}
