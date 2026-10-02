// 3D model format and a small modelling toolkit.
//
// A model is a vertex list and a list of convex, planar polygon faces, each
// with a material (palette shading ramp), a flat normal and a centroid.
// Faces may be "decals" (roundels, crosses, fin flashes): drawn immediately
// after their parent face so they never sort behind it.
// Faces carry a part number so pieces can be hidden or shown separately (a
// wing that comes off becomes its own tumbling object).

import { MAT_ID, MaterialName } from './palette';

export interface Face {
  v: number[];
  mat: number;
  nx: number; ny: number; nz: number;
  cx: number; cy: number; cz: number;
  part: number;
  /** Index of the face this decal sits on, or -1. */
  decalOf: number;
}

export interface Model {
  name: string;
  verts: Float32Array;
  faces: Face[];
  radius: number;
  /** Detail levels, highest first; lods[0] === this. */
  lods: Model[];
}

export const PART = {
  BODY: 0,
  WING_L: 1,
  WING_R: 2,
  TAIL: 3,
  ENGINE_L: 4,
  ENGINE_R: 5,
  PROP: 6,
} as const;

type P3 = [number, number, number];

export class ModelBuilder {
  private v: number[] = [];
  private faces: { v: number[]; mat: number; decalOf: number; part: number }[] = [];
  part: number = PART.BODY;

  private vert(p: P3): number {
    this.v.push(p[0], p[1], p[2]);
    return this.v.length / 3 - 1;
  }

  /**
   * Add a polygon. If `outward` is given the winding is fixed so the normal
   * points along it. Returns the face index.
   */
  poly(mat: MaterialName, pts: P3[], outward?: P3, decalOf = -1): number {
    let p = pts;
    if (outward) {
      const n = newell(p);
      if (n[0] * outward[0] + n[1] * outward[1] + n[2] * outward[2] < 0) p = [...p].reverse();
    }
    const idx = p.map((q) => this.vert(q));
    this.faces.push({ v: idx, mat: MAT_ID[mat], decalOf, part: this.part });
    return this.faces.length - 1;
  }

  /** A flat two-sided plate: one face each side, with separate materials. */
  plate(top: MaterialName, bottom: MaterialName, pts: P3[], up: P3): [number, number] {
    const a = this.poly(top, pts, up);
    const b = this.poly(bottom, pts, [-up[0], -up[1], -up[2]]);
    return [a, b];
  }

  /**
   * Loft a closed tube through cross-sections at successive z. Each section is
   * a ring of [x, y] points (same count for all), going round consistently.
   * matFor picks a material from the face's rough outward direction.
   */
  loft(
    sections: { z: number; pts: [number, number][]; cy?: number }[],
    matFor: (nx: number, ny: number, seg: number, side: number) => MaterialName,
    capFront: MaterialName | null,
    capBack: MaterialName | null,
  ): number[] {
    const out: number[] = [];
    for (let s = 0; s < sections.length - 1; s++) {
      const a = sections[s], b = sections[s + 1];
      const n = a.pts.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const p0: P3 = [a.pts[i][0], a.pts[i][1], a.z];
        const p1: P3 = [a.pts[j][0], a.pts[j][1], a.z];
        const p2: P3 = [b.pts[j][0], b.pts[j][1], b.z];
        const p3: P3 = [b.pts[i][0], b.pts[i][1], b.z];
        const mx = (p0[0] + p1[0] + p2[0] + p3[0]) / 4;
        const my = (p0[1] + p1[1] + p2[1] + p3[1]) / 4;
        const acy = ((a.cy ?? avgY(a.pts)) + (b.cy ?? avgY(b.pts))) / 2;
        const ox = mx, oy = my - acy;
        const ol = Math.hypot(ox, oy) || 1;
        const mat = matFor(ox / ol, oy / ol, s, i);
        // Degenerate (point) sections give triangles.
        const quad = dedupe([p0, p1, p2, p3]);
        if (quad.length >= 3) out.push(this.poly(mat, quad, [ox, oy, 0]));
      }
    }
    if (capFront) {
      const f = sections[sections.length - 1];
      if (dedupe(f.pts.map(([x, y]) => [x, y, f.z] as P3)).length >= 3)
        out.push(this.poly(capFront, f.pts.map(([x, y]) => [x, y, f.z] as P3), [0, 0, 1]));
    }
    if (capBack) {
      const f = sections[0];
      if (dedupe(f.pts.map(([x, y]) => [x, y, f.z] as P3)).length >= 3)
        out.push(this.poly(capBack, f.pts.map(([x, y]) => [x, y, f.z] as P3), [0, 0, -1]));
    }
    return out;
  }

  /** Regular n-gon disc (roundel etc.) centred at c in the plane with normal n. */
  disc(mat: MaterialName, c: P3, r: number, n: P3, sides: number, decalOf = -1, rot = 0): number {
    const [ux, uy, uz] = perp(n);
    const [vx, vy, vz] = cross(n, [ux, uy, uz]);
    const pts: P3[] = [];
    for (let i = 0; i < sides; i++) {
      const a = rot + (i / sides) * Math.PI * 2;
      const ca = Math.cos(a) * r, sa = Math.sin(a) * r;
      pts.push([c[0] + ux * ca + vx * sa, c[1] + uy * ca + vy * sa, c[2] + uz * ca + vz * sa]);
    }
    return this.poly(mat, pts, n, decalOf);
  }

  /** Axis-aligned box (six faces). */
  box(mat: MaterialName | ((n: P3) => MaterialName), min: P3, max: P3): void {
    const [x0, y0, z0] = min, [x1, y1, z1] = max;
    const m = (n: P3) => (typeof mat === 'function' ? mat(n) : mat);
    this.poly(m([0, 1, 0]), [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [0, 1, 0]);
    this.poly(m([0, -1, 0]), [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0]);
    this.poly(m([1, 0, 0]), [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], [1, 0, 0]);
    this.poly(m([-1, 0, 0]), [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], [-1, 0, 0]);
    this.poly(m([0, 0, 1]), [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1]);
    this.poly(m([0, 0, -1]), [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], [0, 0, -1]);
  }

  /** Faces added so far. */
  get faceCount(): number {
    return this.faces.length;
  }

  build(name: string): Model {
    // Merge identical vertices.
    const map = new Map<string, number>();
    const verts: number[] = [];
    const remap: number[] = [];
    for (let i = 0; i < this.v.length / 3; i++) {
      const x = this.v[i * 3], y = this.v[i * 3 + 1], z = this.v[i * 3 + 2];
      const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
      let k = map.get(key);
      if (k === undefined) {
        k = verts.length / 3;
        verts.push(x, y, z);
        map.set(key, k);
      }
      remap.push(k);
    }
    let radius = 0;
    for (let i = 0; i < verts.length; i += 3) radius = Math.max(radius, Math.hypot(verts[i], verts[i + 1], verts[i + 2]));
    const faces: Face[] = this.faces.map((f) => {
      const v = f.v.map((i) => remap[i]);
      const pts = v.map((i) => [verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]] as P3);
      const n = newell(pts);
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      let cx = 0, cy = 0, cz = 0;
      for (const p of pts) { cx += p[0]; cy += p[1]; cz += p[2]; }
      return {
        v, mat: f.mat, part: f.part, decalOf: f.decalOf,
        nx: n[0] / l, ny: n[1] / l, nz: n[2] / l,
        cx: cx / pts.length, cy: cy / pts.length, cz: cz / pts.length,
      };
    });
    const m: Model = { name, verts: new Float32Array(verts), faces, radius, lods: [] };
    m.lods = [m];
    return m;
  }
}

/** Combine detail levels into one model (highest first). */
export function withLods(...models: Model[]): Model {
  const top = models[0];
  top.lods = models;
  for (const m of models) m.lods = models;
  return top;
}

function newell(p: P3[]): P3 {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [nx, ny, nz];
}

function avgY(pts: [number, number][]): number {
  let s = 0;
  for (const p of pts) s += p[1];
  return s / pts.length;
}

function dedupe(p: P3[]): P3[] {
  const out: P3[] = [];
  for (const q of p) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last[0] - q[0], last[1] - q[1], last[2] - q[2]) > 1e-6) out.push(q);
  }
  if (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= 1e-6) out.pop();
  }
  return out;
}

function perp(n: P3): P3 {
  const a: P3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const c = cross(a, n);
  const l = Math.hypot(c[0], c[1], c[2]) || 1;
  return [c[0] / l, c[1] / l, c[2] / l];
}

function cross(a: P3, b: P3): P3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Count faces and verts for the model viewer. */
export function modelStats(m: Model): string {
  return m.lods.map((l) => `${l.faces.length}f/${l.verts.length / 3}v`).join(' ');
}
