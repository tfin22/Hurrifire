// Parametric aircraft modelling kit. Each aircraft in content/models/ is a
// data description (fuselage sections, wing planform, tail, markings) that
// this kit turns into three detail levels of flat-shaded polygons.
// Body axes: x = right wing, y = up, z = forward (nose); metres; origin ≈ CG.

import { Model, ModelBuilder, PART, withLods } from '../../render/model';
import type { MaterialName } from '../../render/palette';
import { hash3 } from '../../core/rng';

type P3 = [number, number, number];

export interface Section {
  z: number;
  /** Half width. */
  w: number;
  top: number;
  bot: number;
  /** Upper faces of the segment from this section to the next are glazing. */
  glass?: boolean;
  /** Whole ring glazed (bomber noses). */
  allGlass?: boolean;
  /** Paint the segment from this section to the next in this material (yellow cowlings, spinners). */
  paint?: MaterialName;
}

export type WingShape = 'elliptical' | 'tapered' | 'rounded' | 'square';

export interface WingSpec {
  /** Half span from the centreline (m). */
  span: number;
  rootChord: number;
  tipChord: number;
  /** Leading edge z at the root. */
  rootLE: number;
  /** Rearward displacement of the leading edge at the tip (m). */
  sweep: number;
  /** Height of the root. */
  y: number;
  dihedralDeg: number;
  /** Inverted-gull: dihedral of the inner panel (Stuka). */
  innerDihedralDeg?: number;
  shape: WingShape;
  /** Fraction of span where the inner panel ends. */
  split?: number;
  /** Half width of the fuselage at the root (wing starts here). */
  rootX: number;
}

export interface FinSpec {
  /** x of the fin (0 = centre; twin fins use ±x). */
  x: number;
  rootLE: number;
  rootChord: number;
  tipChord: number;
  height: number;
  sweep: number;
  y: number;
}

export interface NacelleSpec {
  x: number;
  y: number;
  zFront: number;
  zBack: number;
  r: number;
}

export interface AircraftModelSpec {
  name: string;
  scheme: 'raf' | 'lw' | 'lwBomber';
  sections: Section[];
  wing: WingSpec;
  tail: WingSpec;
  fins: FinSpec[];
  nacelles?: NacelleSpec[];
  /** Radiators / scoops: boxes under the wing or fuselage. */
  scoops?: { min: P3; max: P3 }[];
  /** Fixed spatted undercarriage (Stuka). */
  spats?: { x: number; y: number; z: number; h: number }[];
  /** Prop disc radius and z (single-engined). */
  prop?: { z: number; r: number; y: number };
  /** Spinner/nose colour override. */
  noseYellow?: boolean;
  /** Fraction of span where wing markings sit. */
  markSpan?: number;
  fuselageMarkZ: number;
  /** Rudder colour (109s sometimes white/yellow). */
  /** Wing markings size factor. */
  markScale?: number;
}

const upperOf = (scheme: AircraftModelSpec['scheme'], f: number): MaterialName => {
  if (scheme === 'raf') return f < 0.5 ? 'rafGreen' : 'rafEarth';
  return f < 0.5 ? 'lwUpper' : 'lwUpper';
};
const underOf = (scheme: AircraftModelSpec['scheme']): MaterialName => (scheme === 'raf' ? 'rafSky' : 'lwUnder');

function ring(s: Section, n: number): [number, number][] {
  const mid = (s.top + s.bot) / 2;
  const yu = mid + (s.top - mid) * 0.5;
  const yl = mid + (s.bot - mid) * 0.5;
  if (n === 4) return [[0, s.top], [s.w, mid], [0, s.bot], [-s.w, mid]];
  if (n === 6) return [[0, s.top], [s.w, yu], [s.w, yl], [0, s.bot], [-s.w, yl], [-s.w, yu]];
  // 8
  return [
    [0, s.top], [s.w * 0.75, s.top - (s.top - mid) * 0.15], [s.w, yu * 0.4 + mid * 0.6], [s.w * 0.85, yl],
    [0, s.bot], [-s.w * 0.85, yl], [-s.w, yu * 0.4 + mid * 0.6], [-s.w * 0.75, s.top - (s.top - mid) * 0.15],
  ];
}

/** Planform stations for one wing half: arrays of [span, zLE, zTE, y]. */
function planform(w: WingSpec, stations: number): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  const split = w.split ?? 0.4;
  const yAt = (s: number) => {
    const inner = (w.innerDihedralDeg ?? w.dihedralDeg) * (Math.PI / 180);
    const outer = w.dihedralDeg * (Math.PI / 180);
    const sb = w.span * split;
    if (s <= sb) return w.y + (s - w.rootX) * Math.tan(inner);
    return w.y + (sb - w.rootX) * Math.tan(inner) + (s - sb) * Math.tan(outer);
  };
  for (let i = 0; i <= stations; i++) {
    const t = i / stations;
    const s = w.rootX + (w.span - w.rootX) * t;
    const f = s / w.span;
    let chord: number, le: number;
    const lin = w.rootChord + (w.tipChord - w.rootChord) * f;
    switch (w.shape) {
      case 'elliptical': {
        const e = Math.sqrt(Math.max(0, 1 - f * f));
        chord = Math.max(w.tipChord, w.rootChord * e);
        le = w.rootLE - w.sweep * f - (w.rootChord - chord) * 0.25;
        break;
      }
      case 'rounded': {
        const round = f > 0.85 ? Math.sqrt(Math.max(0, 1 - ((f - 0.85) / 0.15) ** 2)) : 1;
        chord = Math.max(0.15, lin * (0.35 + 0.65 * round));
        le = w.rootLE - w.sweep * f - (lin - chord) * 0.4;
        break;
      }
      default:
        chord = lin;
        le = w.rootLE - w.sweep * f;
    }
    out.push([s, le, le - chord, yAt(s)]);
  }
  return out;
}

function stationsFor(shape: WingShape, detail: number): number {
  if (detail >= 2) return 1;
  if (shape === 'elliptical' || shape === 'rounded') return detail === 0 ? 6 : 3;
  return 2;
}

/** Build both halves of a wing/tailplane as top/bottom plates, split into inner and outer panels. */
function buildWing(b: ModelBuilder, spec: AircraftModelSpec, w: WingSpec, detail: number, isTail: boolean): { topFaces: number[]; bottomFaces: number[] } {
  const n = stationsFor(w.shape, detail);
  const st = planform(w, n);
  const splitIdx = detail >= 2 ? n : Math.max(1, Math.round(n * (w.split ?? 0.4)));
  const topFaces: number[] = [], bottomFaces: number[] = [];
  for (const side of [1, -1]) {
    b.part = isTail ? PART.TAIL : side > 0 ? PART.WING_R : PART.WING_L;
    const panels: [number, number][] = splitIdx >= n ? [[0, n]] : [[0, splitIdx], [splitIdx, n]];
    for (const [a, z] of panels) {
      const pts: P3[] = [];
      for (let i = a; i <= z; i++) pts.push([side * st[i][0], st[i][3], st[i][1]]);
      for (let i = z; i >= a; i--) pts.push([side * st[i][0], st[i][3], st[i][2]]);
      const clean = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[2] - pts[i - 1][2]) > 1e-4);
      const up: P3 = [0, 1, 0];
      const hash = hash3(a, side, isTail ? 7 : 3);
      const [t, bt] = b.plate(upperOf(spec.scheme, (hash & 255) / 255), underOf(spec.scheme), clean, up);
      topFaces.push(t);
      bottomFaces.push(bt);
    }
  }
  b.part = PART.BODY;
  return { topFaces, bottomFaces };
}

function buildFin(b: ModelBuilder, spec: AircraftModelSpec, f: FinSpec): number[] {
  b.part = PART.TAIL;
  const pts: P3[] = [
    [f.x, f.y, f.rootLE],
    [f.x, f.y + f.height, f.rootLE - f.sweep],
    [f.x, f.y + f.height, f.rootLE - f.sweep - f.tipChord],
    [f.x, f.y, f.rootLE - f.rootChord],
  ];
  const mat = upperOf(spec.scheme, f.x > 0 ? 0.2 : 0.8);
  const [r, l] = b.plate(mat, mat, pts, [1, 0, 0]);
  b.part = PART.BODY;
  return [r, l];
}

/** RAF roundel on a face: concentric discs as decals. */
function roundel(b: ModelBuilder, c: P3, n: P3, r: number, parent: number, withYellow: boolean, sides: number): void {
  const off = (k: number): P3 => [c[0] + n[0] * 0.01 * k, c[1] + n[1] * 0.01 * k, c[2] + n[2] * 0.01 * k];
  if (withYellow) b.disc('roundelYellow', off(1), r * 1.2, n, sides, parent);
  b.disc('blue', off(2), r, n, sides, parent);
  if (withYellow) b.disc('white', off(3), r * 0.62, n, sides, parent);
  b.disc('red', off(4), r * 0.36, n, sides, parent);
}

/** Balkenkreuz: white-edged black cross, as overlapping convex bars. */
function balkenkreuz(b: ModelBuilder, c: P3, n: P3, r: number, parent: number, alongZ: P3): void {
  const u = alongZ;
  const v: P3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const bar = (mat: MaterialName, lu: number, lv: number, k: number) => {
    const o = 0.01 * k;
    const p = (a: number, d: number): P3 => [
      c[0] + u[0] * a + v[0] * d + n[0] * o,
      c[1] + u[1] * a + v[1] * d + n[1] * o,
      c[2] + u[2] * a + v[2] * d + n[2] * o,
    ];
    b.poly(mat, [p(-lu, -lv), p(lu, -lv), p(lu, lv), p(-lu, lv)], n, parent);
  };
  bar('white', r, r * 0.42, 1);
  bar('white', r * 0.42, r, 1);
  bar('crosses', r * 0.82, r * 0.22, 2);
  bar('crosses', r * 0.22, r * 0.82, 2);
}

export function nearestFace(m: Model, p: P3, n: P3): number {
  let best = -1, bd = Infinity;
  m.faces.forEach((f, i) => {
    if (f.decalOf >= 0) return;
    if (f.nx * n[0] + f.ny * n[1] + f.nz * n[2] < 0.5) return;
    const d = (f.cx - p[0]) ** 2 + (f.cy - p[1]) ** 2 + (f.cz - p[2]) ** 2;
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

function buildDetail(spec: AircraftModelSpec, detail: number): Model {
  const b = new ModelBuilder();
  const ringN = detail === 0 ? 6 : 4;
  let secs = spec.sections;
  if (detail === 2) {
    // Nose, widest point, tail.
    const widest = secs.reduce((a, s) => (s.w > a.w ? s : a), secs[0]);
    secs = [secs[0], widest, secs[secs.length - 1]].sort((a, c) => a.z - c.z);
  }
  const sorted = [...secs].sort((a, c) => a.z - c.z);
  const rings = sorted.map((s) => ({ z: s.z, pts: ring(s, ringN), cy: (s.top + s.bot) / 2 }));
  b.loft(
    rings,
    (nx, ny, seg, side) => {
      const s = sorted[seg];
      if (s.allGlass && detail < 2) return 'glass';
      if (s.glass && ny > 0.3 && detail < 2) return 'glass';
      if (s.paint) return s.paint;
      if (spec.noseYellow && seg === sorted.length - 2 && detail < 2) return 'yellow';
      if (ny < -0.45) return underOf(spec.scheme);
      if (spec.scheme !== 'raf' && Math.abs(nx) > 0.7 && ny < 0.2) return 'lwUnder'; // RLM 65 fuselage sides
      return upperOf(spec.scheme, (hash3(seg, side, 11) & 255) / 255);
    },
    'metal',
    null,
  );
  buildWing(b, spec, spec.wing, detail, false);
  buildWing(b, spec, spec.tail, detail, true);
  const finFaces: number[][] = [];
  for (const f of spec.fins) finFaces.push(buildFin(b, spec, f));

  if (spec.nacelles) {
    for (const nc of spec.nacelles) {
      b.part = nc.x < 0 ? PART.ENGINE_L : PART.ENGINE_R;
      const s0 = { z: nc.zBack, pts: ring({ z: 0, w: nc.r * 0.5, top: nc.y + nc.r * 0.5, bot: nc.y - nc.r * 0.6 }, ringN).map(([x, y]) => [x + nc.x, y] as [number, number]), cy: nc.y };
      const s1 = { z: (nc.zBack + nc.zFront) / 2 + 0.3, pts: ring({ z: 0, w: nc.r, top: nc.y + nc.r, bot: nc.y - nc.r }, ringN).map(([x, y]) => [x + nc.x, y] as [number, number]), cy: nc.y };
      const s2 = { z: nc.zFront, pts: ring({ z: 0, w: nc.r * 0.8, top: nc.y + nc.r * 0.8, bot: nc.y - nc.r * 0.8 }, ringN).map(([x, y]) => [x + nc.x, y] as [number, number]), cy: nc.y };
      const rs = detail === 2 ? [s0, s2] : [s0, s1, s2];
      b.loft(rs, (_nx, ny) => (ny < -0.4 ? underOf(spec.scheme) : upperOf(spec.scheme, 0.3)), 'metal', null);
      if (detail === 0) b.disc('metal', [nc.x, nc.y, nc.zFront + 0.12], nc.r * 1.5, [0, 0, 1], 5);
      if (detail === 0) b.disc('metal', [nc.x, nc.y, nc.zFront + 0.12], nc.r * 1.5, [0, 0, -1], 5);
      b.part = PART.BODY;
    }
  }

  if (detail === 0 && spec.scoops) {
    for (const s of spec.scoops) b.box((n) => (n[1] > 0.5 ? underOf(spec.scheme) : 'metal'), s.min, s.max);
  }
  if (detail <= 1 && spec.spats) {
    for (const s of spec.spats) {
      b.plate(upperOf(spec.scheme, 0.4), upperOf(spec.scheme, 0.6), [
        [s.x, s.y, s.z + 0.5], [s.x, s.y, s.z - 0.3], [s.x, s.y - s.h, s.z - 0.2], [s.x, s.y - s.h, s.z + 0.25],
      ], [1, 0, 0]);
    }
  }
  if (detail === 0 && spec.prop) {
    // Three blades, two-sided, as a still frame of the spinning prop.
    b.part = PART.PROP;
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.3;
      const ca = Math.cos(a), sa = Math.sin(a);
      const r = spec.prop.r, y = spec.prop.y, z = spec.prop.z;
      const pts: P3[] = [
        [ca * 0.15 - sa * 0.08, y + sa * 0.15 + ca * 0.08, z],
        [ca * r - sa * 0.1, y + sa * r + ca * 0.1, z],
        [ca * r + sa * 0.1, y + sa * r - ca * 0.1, z],
        [ca * 0.15 + sa * 0.08, y + sa * 0.15 - ca * 0.08, z],
      ];
      b.plate('metal', 'metal', pts, [0, 0, 1]);
    }
    b.part = PART.BODY;
  }

  // Markings.
  if (detail <= 1) {
    const tmp = b.build('tmp');
    const ms = spec.markSpan ?? 0.68;
    const scale = spec.markScale ?? 1;
    const st = planform(spec.wing, 12);
    const at = st.reduce((a, s) => (Math.abs(s[0] - spec.wing.span * ms) < Math.abs(a[0] - spec.wing.span * ms) ? s : a), st[0]);
    const chord = at[1] - at[2];
    const mz = (at[1] + at[2]) / 2;
    const r = Math.min(chord * 0.4, 0.9) * scale;
    const sides = detail === 0 ? 8 : 6;
    for (const side of [1, -1]) {
      const p: P3 = [side * at[0], at[3], mz];
      const top = nearestFace(tmp, p, [0, 1, 0]);
      const bot = nearestFace(tmp, p, [0, -1, 0]);
      if (spec.scheme === 'raf') {
        if (top >= 0) roundel(b, [p[0], p[1] + 0.005, p[2]], [0, 1, 0], r, top, false, sides);
      } else {
        if (top >= 0) balkenkreuz(b, [p[0], p[1] + 0.005, p[2]], [0, 1, 0], r * 0.85, top, [0, 0, 1]);
        if (bot >= 0 && detail === 0) balkenkreuz(b, [p[0], p[1] - 0.005, p[2]], [0, -1, 0], r * 0.85, bot, [0, 0, 1]);
      }
    }
    if (detail === 0) {
      // Fuselage side markings.
      const zf = spec.fuselageMarkZ;
      const s = sorted.reduce((a, c) => (Math.abs(c.z - zf) < Math.abs(a.z - zf) ? c : a), sorted[0]);
      const mid = (s.top + s.bot) / 2;
      const rr = Math.min(s.top - s.bot, 1.4) * 0.36;
      for (const side of [1, -1]) {
        const p: P3 = [side * s.w, mid, zf];
        const f = nearestFace(tmp, p, [side, 0, 0]);
        if (f < 0) continue;
        const fc = tmp.faces[f];
        const n: P3 = [fc.nx, fc.ny, fc.nz];
        const c: P3 = [fc.cx + n[0] * 0.02, fc.cy + n[1] * 0.02, zf];
        if (spec.scheme === 'raf') roundel(b, c, n, rr, f, true, 8);
        else {
          balkenkreuz(b, c, n, rr, f, [0, 0, 1]);
          // Unit codes: plain dark blocks either side of the cross (no lettering at this size).
          for (const dz of [rr * 2.2, -rr * 2.2]) {
            const q = (a: number, d: number): P3 => [c[0] + n[0] * 0.01, c[1] + d, c[2] + dz + a];
            b.poly('crosses', [q(-rr * 0.5, -rr * 0.45), q(rr * 0.5, -rr * 0.45), q(rr * 0.5, rr * 0.45), q(-rr * 0.5, rr * 0.45)], n, f);
          }
        }
      }
      // Fin flash (RAF) / tail band (LW).
      for (let fi = 0; fi < spec.fins.length; fi++) {
        const fs = spec.fins[fi];
        const faces = finFaces[fi];
        for (let k = 0; k < 2; k++) {
          const side = k === 0 ? 1 : -1;
          const n: P3 = [side, 0, 0];
          const x = fs.x + side * 0.012;
          if (spec.scheme === 'raf') {
            const h0 = fs.y + 0.05, h1 = fs.y + fs.height * 0.75;
            const zf0 = fs.rootLE - fs.sweep * 0.3;
            const wdt = Math.min(fs.rootChord * 0.22, 0.25);
            const mats: MaterialName[] = ['red', 'white', 'blue'];
            mats.forEach((mm, j) => {
              const za = zf0 - j * wdt, zb = za - wdt;
              b.poly(mm, [[x, h0, za], [x, h1, za - fs.sweep * 0.3], [x, h1, zb - fs.sweep * 0.3], [x, h0, zb]], n, faces[k]);
            });
          }
        }
      }
    }
  }
  return b.build(`${spec.name}${detail === 0 ? '' : detail === 1 ? ' (med)' : ' (low)'}`);
}

/** Build the three detail levels. */
export function buildAircraftModel(spec: AircraftModelSpec): Model {
  return withLods(buildDetail(spec, 0), buildDetail(spec, 1), buildDetail(spec, 2));
}
