// Cumulus at the cloud base, generated deterministically per 5 km square
// from the day's weather. Each cloud is a cluster of flattened blobs; the
// blobs are what blocks line of sight, and what you fly through.

import { Vec3 } from '../core/math';
import { hash01 } from '../core/rng';

export interface CloudBlob {
  pos: Vec3;
  rx: number;
  ry: number;
  rz: number;
}

const CELL = 5000;

export class CloudField {
  private cache = new Map<string, CloudBlob[]>();

  constructor(
    readonly seed: number,
    readonly base: number,
    readonly top: number,
    /** 0..1 */
    readonly cover: number,
  ) {}

  cell(i: number, j: number): CloudBlob[] {
    const key = `${i},${j}`;
    let c = this.cache.get(key);
    if (c) return c;
    c = [];
    if (this.cover > 0.02) {
      const slots = 4;
      for (let s = 0; s < slots; s++) {
        if (hash01(i, j, this.seed + s * 17) > this.cover) continue;
        const cx = (i + 0.15 + 0.7 * hash01(i, j, this.seed + s * 17 + 1)) * CELL;
        const cz = (j + 0.15 + 0.7 * hash01(i, j, this.seed + s * 17 + 2)) * CELL;
        const size = 350 + 900 * hash01(i, j, this.seed + s * 17 + 3) * (0.5 + this.cover);
        const depth = Math.min(this.top - this.base, size * 0.8);
        const blobs = 2 + Math.floor(hash01(i, j, this.seed + s * 17 + 4) * 3);
        for (let b = 0; b < blobs; b++) {
          const ox = (hash01(i, j, this.seed + s * 31 + b) - 0.5) * size * 1.3;
          const oz = (hash01(i, j, this.seed + s * 37 + b) - 0.5) * size * 1.3;
          const r = size * (0.45 + 0.35 * hash01(i, j, this.seed + s * 41 + b));
          const ry = depth * (0.4 + 0.25 * hash01(i, j, this.seed + s * 43 + b));
          c.push({ pos: new Vec3(cx + ox, this.base + ry, cz + oz), rx: r, ry, rz: r * 0.9 });
        }
      }
    }
    this.cache.set(key, c);
    if (this.cache.size > 4000) this.cache.clear();
    return c;
  }

  /** All blobs in squares overlapping a box. */
  blobsIn(x0: number, z0: number, x1: number, z1: number, out: CloudBlob[] = []): CloudBlob[] {
    out.length = 0;
    const i0 = Math.floor(Math.min(x0, x1) / CELL) - 1, i1 = Math.floor(Math.max(x0, x1) / CELL) + 1;
    const j0 = Math.floor(Math.min(z0, z1) / CELL) - 1, j1 = Math.floor(Math.max(z0, z1) / CELL) + 1;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) for (const b of this.cell(i, j)) out.push(b);
    return out;
  }

  private scratch: CloudBlob[] = [];

  /** Is the straight line a→b clear of cloud? */
  losClear(a: Vec3, b: Vec3): boolean {
    // Both ends well above or well below the layer: clear.
    const top = this.top + 50, base = this.base - 50;
    if ((a.y > top && b.y > top) || (a.y < base && b.y < base) || this.cover <= 0.02) return true;
    for (const c of this.blobsIn(a.x, a.z, b.x, b.z, this.scratch)) {
      const ax = (a.x - c.pos.x) / c.rx, ay = (a.y - c.pos.y) / c.ry, az = (a.z - c.pos.z) / c.rz;
      const bx = (b.x - c.pos.x) / c.rx, by = (b.y - c.pos.y) / c.ry, bz = (b.z - c.pos.z) / c.rz;
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      const l2 = dx * dx + dy * dy + dz * dz;
      let t = l2 > 0 ? -(ax * dx + ay * dy + az * dz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + dx * t, py = ay + dy * t, pz = az + dz * t;
      if (px * px + py * py + pz * pz < 0.8) return false;
    }
    return true;
  }

  /** 0 clear .. 1 deep inside a cloud. */
  densityAt(p: Vec3): number {
    if (p.y > this.top + 50 || p.y < this.base - 50 || this.cover <= 0.02) return 0;
    let best = 0;
    for (const c of this.blobsIn(p.x - 1, p.z - 1, p.x + 1, p.z + 1, this.scratch)) {
      const x = (p.x - c.pos.x) / c.rx, y = (p.y - c.pos.y) / c.ry, z = (p.z - c.pos.z) / c.rz;
      const d = x * x + y * y + z * z;
      if (d < 1) best = Math.max(best, Math.min(1, (1 - d) * 3));
    }
    return best;
  }
}
