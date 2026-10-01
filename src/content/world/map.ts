// The 11 Group world map at runtime: decodes the generated grids
// (terrainData.ts), answers height and surface queries for the simulation,
// and feeds the terrain renderer.
//
// Every 500 m cell has a surface class from the map data. Within ordinary
// farmland each cell is cut into one to four fields with hedges, generated
// deterministically from the cell coordinates, so the patchwork you see is
// the patchwork you land in: field size, crop (by date) and hedges are the
// same for the renderer and for landing.ts.

import { hash01, hash3 } from '../../core/rng';
import { Vec3 } from '../../core/math';
import { MAT_ID } from '../../render/palette';
import type { TerrainSource } from '../../render/terrain';
import type { GroundModel, Surface } from '../../sim/ground';
import { CLASS_RLE, GRID, HEIGHTS } from './terrainData';
import placesJson from './places.json';

export const CL = {
  SEA: 0, FIELDS: 1, WOOD: 2, DOWNS: 3, MARSH: 4, TOWN: 5, CITY: 6, RIVER: 7, MUD: 8,
  BEACH: 9, ORCHARD: 10, HOPS: 11, FRANCE: 12, AIRFIELD: 13, CLIFF: 14, SUBURB: 15,
} as const;

export const PLACES = placesJson;
/** Class code for beyond the edge of the map. */
const OUTSIDE = 255;
const PJ = placesJson.projection;

export const lonLatToXZ = (lat: number, lon: number): [number, number] => [(lon - PJ.lon0) * PJ.mPerDegLon, (lat - PJ.lat0) * PJ.mPerDegLat];
export const xzToLatLon = (x: number, z: number): [number, number] => [PJ.lat0 + z / PJ.mPerDegLat, PJ.lon0 + x / PJ.mPerDegLon];

function b64(s: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(s, 'base64'));
}

export type FieldCrop = 'pasture' | 'corn' | 'gold' | 'stubble' | 'ploughed' | 'fallow';

export interface Field {
  x0: number; z0: number; x1: number; z1: number;
  surface: Surface;
  crop: FieldCrop | null;
  material: number;
  /** Hedges on the west, east, south, north edges. */
  hedge: [boolean, boolean, boolean, boolean];
}

export interface Airfield {
  name: string;
  kind: string;
  code?: string;
  pos: Vec3;
  /** Main landing direction (deg) and usable length (m). */
  dir: number;
  len: number;
  /** Half-size of the grass square (m). */
  half: number;
  /** Bomb craters (with flags); filled in by the campaign. */
  craters: { x: number; z: number; r: number }[];
  damaged: number;
}

export class WorldMap implements TerrainSource, GroundModel {
  readonly nx = GRID.nx;
  readonly nz = GRID.nz;
  readonly cls: Uint8Array;
  readonly cls1k: Uint8Array;
  readonly cls4k: Uint8Array;
  private readonly h: Uint8Array;
  readonly airfields: Airfield[] = [];
  /** 0 = early July … 1 = end of October. Drives crop colours. */
  season = 0.2;

  constructor() {
    const rle = b64(CLASS_RLE);
    this.cls = new Uint8Array(this.nx * this.nz);
    let k = 0;
    for (let i = 0; i < rle.length; i += 2) {
      this.cls.fill(rle[i], k, k + rle[i + 1]);
      k += rle[i + 1];
    }
    this.h = b64(HEIGHTS);
    this.cls1k = this.coarsen(2);
    this.cls4k = this.coarsen(8);
    for (const a of PLACES.airfields) {
      const [x, z] = lonLatToXZ(a.lat, a.lon);
      this.airfields.push({
        name: a.name, kind: a.kind, code: (a as { code?: string }).code,
        pos: new Vec3(x, 0, z), dir: a.dir, len: a.len, half: a.len * 0.55, craters: [], damaged: 0,
      });
    }
    for (const a of this.airfields) a.pos.y = this.heightAt(a.pos.x, a.pos.z);
  }

  private coarsen(f: number): Uint8Array {
    const cnx = Math.ceil(this.nx / f), cnz = Math.ceil(this.nz / f);
    const out = new Uint8Array(cnx * cnz);
    const counts = new Uint16Array(16);
    for (let j = 0; j < cnz; j++) {
      for (let i = 0; i < cnx; i++) {
        counts.fill(0);
        for (let b = 0; b < f; b++) for (let a = 0; a < f; a++) {
          const x = i * f + a, z = j * f + b;
          if (x < this.nx && z < this.nz) counts[this.cls[z * this.nx + x]]++;
        }
        let best = 0;
        for (let c = 1; c < 16; c++) if (counts[c] > counts[best]) best = c;
        // Water wins ties so coasts and the estuary keep their shape.
        if (counts[CL.SEA] * 2 >= f * f) best = CL.SEA;
        out[j * cnx + i] = best;
      }
    }
    return out;
  }

  inBounds(x: number, z: number): boolean {
    return x >= GRID.x0 && z >= GRID.z0 && x < GRID.x0 + this.nx * GRID.cell && z < GRID.z0 + this.nz * GRID.cell;
  }

  /** Surface class at a world point (sea outside the map). */
  classAt(x: number, z: number): number {
    const i = Math.floor((x - GRID.x0) / GRID.cell), j = Math.floor((z - GRID.z0) / GRID.cell);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return CL.SEA;
    return this.cls[j * this.nx + i];
  }

  private classCell(ix: number, iz: number, size: number): number {
    // ix, iz are in units of `size` from the world origin; convert to grid cells.
    const gx = Math.floor((ix * size - GRID.x0) / GRID.cell), gz = Math.floor((iz * size - GRID.z0) / GRID.cell);
    if (gx < 0 || gz < 0 || gx >= this.nx || gz >= this.nz) return OUTSIDE;
    if (size <= 500) {
      return this.cls[gz * this.nx + gx];
    }
    const f = size === 1000 ? 2 : 8;
    const grid = size === 1000 ? this.cls1k : this.cls4k;
    const cnx = Math.ceil(this.nx / f), cnz = Math.ceil(this.nz / f);
    const ci = Math.floor(gx / f), cj = Math.floor(gz / f);
    if (ci < 0 || cj < 0 || ci >= cnx || cj >= cnz) return OUTSIDE;
    return grid[cj * cnx + ci];
  }

  heightAt(x: number, z: number): number {
    const fx = (x - GRID.x0) / GRID.heightCell, fz = (z - GRID.z0) / GRID.heightCell;
    if (fx < 0 || fz < 0 || fx >= GRID.hnx - 1 || fz >= GRID.hnz - 1) return 0;
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const n = GRID.hnx, h = this.h;
    const a = h[j * n + i], b = h[j * n + i + 1], c = h[(j + 1) * n + i], d = h[(j + 1) * n + i + 1];
    const v = ((a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz) * 2;
    // Water is flat at sea level; airfields are level grass.
    const k = this.classAt(x, z);
    if (k === CL.SEA || k === CL.RIVER || k === CL.MUD) return 0;
    return v;
  }

  // ----------------------------------------------------------- fields

  /** The crop of a field this season. */
  cropOf(ix: number, iz: number, q: number): FieldCrop {
    const h = hash01(ix, iz, 100 + q);
    if (h < 0.38) return 'pasture';
    if (h < 0.44) return 'fallow';
    if (h < 0.8) {
      // Arable: green corn ripening to gold, harvested to stubble, then ploughed.
      const s = this.season;
      const ripe = 0.05 + hash01(ix, iz, 200 + q) * 0.08;
      const harvest = 0.22 + hash01(ix, iz, 300 + q) * 0.18;
      const plough = harvest + 0.15 + hash01(ix, iz, 400 + q) * 0.3;
      if (s < ripe) return 'corn';
      if (s < harvest) return 'gold';
      if (s < plough) return 'stubble';
      return 'ploughed';
    }
    return this.season > 0.6 && h > 0.92 ? 'ploughed' : 'pasture';
  }

  private cropMaterial(c: FieldCrop, ix: number, iz: number): number {
    switch (c) {
      case 'pasture': return hash3(ix, iz, 7) & 1 ? MAT_ID.field : MAT_ID.pasture;
      case 'fallow': return MAT_ID.pasture;
      case 'corn': return MAT_ID.field;
      case 'gold': return MAT_ID.gold;
      case 'stubble': return MAT_ID.stubble;
      case 'ploughed': return MAT_ID.plough;
    }
  }

  private cropSurface(c: FieldCrop): Surface {
    return c === 'ploughed' ? 'ploughed' : c === 'pasture' || c === 'fallow' ? 'pasture' : 'stubble';
  }

  /** Split lines of a 500 m cell into up to four fields. */
  private splits(ix: number, iz: number): { sx: number; sz: number } {
    const sx = hash01(ix, iz, 1) < 0.7 ? 0.28 + 0.44 * hash01(ix, iz, 2) : 1;
    const sz = hash01(ix, iz, 3) < 0.7 ? 0.28 + 0.44 * hash01(ix, iz, 4) : 1;
    return { sx, sz };
  }

  /** The field (or patch of ground) containing a point. */
  fieldAt(x: number, z: number): Field {
    const C = GRID.cell;
    const ix = Math.floor(x / C), iz = Math.floor(z / C);
    const x0 = ix * C, z0 = iz * C;
    const k = this.classAt(x, z);
    const whole = (surface: Surface, material: number): Field => ({ x0, z0, x1: x0 + C, z1: z0 + C, surface, crop: null, material, hedge: [false, false, false, false] });
    if (k !== CL.FIELDS && k !== CL.FRANCE && k !== CL.DOWNS) {
      const af = this.airfieldAt(x, z);
      if (af) return { x0: af.pos.x - af.half, z0: af.pos.z - af.half, x1: af.pos.x + af.half, z1: af.pos.z + af.half, surface: 'airfield', crop: null, material: MAT_ID.airfield, hedge: [true, true, true, true] };
      return whole(CLASS_SURFACE[k] ?? 'pasture', CLASS_MAT[k] ?? MAT_ID.field);
    }
    if (k === CL.DOWNS) return whole('pasture', MAT_ID.downs);
    const { sx, sz } = this.splits(ix, iz);
    const qx = (x - x0) / C < sx ? 0 : 1, qz = (z - z0) / C < sz ? 0 : 1;
    const q = qx + qz * 2;
    const crop = this.cropOf(ix, iz, q);
    const fx0 = qx === 0 ? x0 : x0 + sx * C, fx1 = qx === 0 ? x0 + sx * C : x0 + C;
    const fz0 = qz === 0 ? z0 : z0 + sz * C, fz1 = qz === 0 ? z0 + sz * C : z0 + C;
    // Internal boundaries usually hedged; cell boundaries by the shared edge.
    const edgeHedge = (a: number, b: number, c: number) => hash01(a, b, c) < 0.82;
    const hedge: [boolean, boolean, boolean, boolean] = [
      qx === 1 && sx < 1 ? edgeHedge(ix, iz, 11) : edgeHedge(ix, iz, 21),
      qx === 0 && sx < 1 ? edgeHedge(ix, iz, 11) : edgeHedge(ix + 1, iz, 21),
      qz === 1 && sz < 1 ? edgeHedge(ix, iz, 12) : edgeHedge(ix, iz, 22),
      qz === 0 && sz < 1 ? edgeHedge(ix, iz, 12) : edgeHedge(ix, iz + 1, 22),
    ];
    return {
      x0: fx0, z0: fz0, x1: fx1, z1: fz1,
      surface: k === CL.FRANCE ? (crop === 'ploughed' ? 'ploughed' : 'stubble') : this.cropSurface(crop),
      crop, material: this.cropMaterial(crop, ix, iz), hedge,
    };
  }

  airfieldAt(x: number, z: number): Airfield | null {
    for (const a of this.airfields) if (Math.abs(x - a.pos.x) < a.half && Math.abs(z - a.pos.z) < a.half) return a;
    return null;
  }

  nearestAirfield(x: number, z: number, raf = true): Airfield {
    let best = this.airfields[0], bd = Infinity;
    for (const a of this.airfields) {
      if (raf === (a.kind === 'luftwaffe')) continue;
      const d = Math.hypot(a.pos.x - x, a.pos.z - z);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  airfieldByName(name: string): Airfield | undefined {
    return this.airfields.find((a) => a.name === name);
  }

  surfaceAt(x: number, z: number): Surface {
    if (!this.inBounds(x, z)) return 'sea';
    const af = this.airfieldAt(x, z);
    if (af) {
      for (const c of af.craters) if (Math.hypot(x - c.x, z - c.z) < c.r) return 'ploughed';
      return 'airfield';
    }
    return this.fieldAt(x, z).surface;
  }

  /**
   * Distance from (x, z) along a heading (rad) to the first obstacle: a hedge,
   * trees, buildings, water or a crater. Used by the touchdown model.
   */
  clearRun(x: number, z: number, heading: number, max = 1200): { dist: number; obstacle: 'hedge' | 'trees' | 'buildings' | 'water' | 'crater' | 'none' } {
    const dx = Math.sin(heading), dz = Math.cos(heading);
    let field = this.fieldAt(x, z);
    const step = 10;
    for (let d = step; d <= max; d += step) {
      const px = x + dx * d, pz = z + dz * d;
      const af = this.airfieldAt(px, pz);
      if (af) {
        for (const c of af.craters) if (Math.hypot(px - c.x, pz - c.z) < c.r + 3) return { dist: d, obstacle: 'crater' };
        if (this.airfieldAt(x, z) === af) continue;
      }
      if (px < field.x0 || px >= field.x1 || pz < field.z0 || pz >= field.z1) {
        // Crossing a boundary: which side?
        const side = px < field.x0 ? 0 : px >= field.x1 ? 1 : pz < field.z0 ? 2 : 3;
        if (field.hedge[side]) return { dist: d, obstacle: 'hedge' };
        field = this.fieldAt(px, pz);
      }
      const s = field.surface;
      if (s === 'woodland' || s === 'orchard' || s === 'hops') return { dist: d, obstacle: 'trees' };
      if (s === 'town') return { dist: d, obstacle: 'buildings' };
      if (s === 'water' || s === 'sea') return { dist: d, obstacle: 'water' };
    }
    return { dist: max, obstacle: 'none' };
  }

  // ----------------------------------------------------------- rendering

  cellIsWater(ix: number, iz: number, size: number): boolean {
    const c = this.classCell(ix, iz, size);
    return c === CL.SEA || c === CL.RIVER;
  }

  cellMaterial(ix: number, iz: number, size: number): number {
    const c = this.classCell(ix, iz, size);
    if (c === OUTSIDE) return -1; // beyond the map: haze
    if (size <= 500) {
      // Near band: the base under the detail polygons shows as hedgerows,
      // streets and perimeter tracks.
      if (c === CL.FIELDS || c === CL.FRANCE) return MAT_ID.wood;
      if (c === CL.TOWN || c === CL.CITY || c === CL.SUBURB) return MAT_ID.town;
    }
    if (c === CL.FIELDS || c === CL.FRANCE) {
      // Mid/far bands: a patchwork of whole-cell colours following the season.
      return this.cropMaterial(this.cropOf(ix * 7, iz * 13, 0), ix, iz);
    }
    if (c === CL.SUBURB) return hash3(ix, iz, 5) & 1 ? MAT_ID.town : MAT_ID.field;
    return CLASS_MAT[c] ?? MAT_ID.field;
  }

  nearDetail(ix: number, iz: number, size: number, emit: (pts: number[], material: number) => void): void {
    const c = this.classCell(ix, iz, size);
    const x0 = ix * size, z0 = iz * size;
    if (c === CL.FIELDS || c === CL.FRANCE) {
      const { sx, sz } = this.splits(ix, iz);
      const xs = sx < 1 ? [x0, x0 + sx * size, x0 + size] : [x0, x0 + size];
      const zs = sz < 1 ? [z0, z0 + sz * size, z0 + size] : [z0, z0 + size];
      for (let b = 0; b < zs.length - 1; b++) {
        for (let a = 0; a < xs.length - 1; a++) {
          const f = this.fieldAt((xs[a] + xs[a + 1]) / 2, (zs[b] + zs[b + 1]) / 2);
          const ins = (h: boolean) => (h ? 4 : 0);
          const fx0 = f.x0 + ins(f.hedge[0]), fx1 = f.x1 - ins(f.hedge[1]);
          const fz0 = f.z0 + ins(f.hedge[2]), fz1 = f.z1 - ins(f.hedge[3]);
          emit([fx0, fz0, fx1, fz0, fx1, fz1, fx0, fz1], f.material);
          if (f.crop === 'ploughed' || f.crop === 'stubble' || f.crop === 'gold') {
            // Furrow / swathe lines: a few thin strips.
            const n = 3;
            for (let s = 1; s <= n; s++) {
              const t = fx0 + ((fx1 - fx0) * s) / (n + 1);
              emit([t - 1.5, fz0 + 6, t + 1.5, fz0 + 6, t + 1.5, fz1 - 6, t - 1.5, fz1 - 6], f.crop === 'ploughed' ? MAT_ID.plough : MAT_ID.gold);
            }
          }
        }
      }
      return;
    }
    if (c === CL.TOWN || c === CL.CITY || c === CL.SUBURB) {
      // A grid of roofs and gardens; streets show through as the base colour.
      const n = c === CL.CITY ? 4 : 3;
      const step = size / n;
      for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) {
        const h = hash01(ix * n + a, iz * n + b, 77);
        if (c === CL.SUBURB && h < 0.35) {
          emit([x0 + a * step + 3, z0 + b * step + 3, x0 + (a + 1) * step - 3, z0 + b * step + 3, x0 + (a + 1) * step - 3, z0 + (b + 1) * step - 3, x0 + a * step + 3, z0 + (b + 1) * step - 3], MAT_ID.field);
          continue;
        }
        const g = c === CL.CITY ? 4 : 9;
        emit([x0 + a * step + g, z0 + b * step + g, x0 + (a + 1) * step - g, z0 + b * step + g, x0 + (a + 1) * step - g, z0 + (b + 1) * step - g, x0 + a * step + g, z0 + (b + 1) * step - g],
          h < 0.5 ? MAT_ID.roof : h < 0.85 ? MAT_ID.town : MAT_ID.field);
      }
      return;
    }
    if (c === CL.ORCHARD || c === CL.HOPS) {
      // Rows of trees or hop poles: dotted lines on grass.
      emit([x0, z0, x0 + size, z0, x0 + size, z0 + size, x0, z0 + size], MAT_ID.pasture);
      const rows = c === CL.ORCHARD ? 8 : 12;
      for (let r = 0; r < rows; r++) {
        const zz = z0 + (r + 0.5) * (size / rows);
        for (let k = 0; k < 10; k++) {
          const xx = x0 + (k + 0.5) * (size / 10);
          const s = c === CL.ORCHARD ? 9 : 5;
          emit([xx - s, zz - s * 0.6, xx + s, zz - s * 0.6, xx + s, zz + s * 0.6, xx - s, zz + s * 0.6], c === CL.ORCHARD ? MAT_ID.wood : MAT_ID.field);
        }
      }
      return;
    }
    if (c === CL.MARSH) {
      // Dykes: a couple of thin water lines.
      emit([x0, z0, x0 + size, z0, x0 + size, z0 + size, x0, z0 + size], MAT_ID.marsh);
      const t = hash01(ix, iz, 9);
      emit([x0, z0 + size * t, x0 + size, z0 + size * t, x0 + size, z0 + size * t + 4, x0, z0 + size * t + 4], MAT_ID.sea);
      emit([x0 + size * (1 - t), z0, x0 + size * (1 - t) + 4, z0, x0 + size * (1 - t) + 4, z0 + size, x0 + size * (1 - t), z0 + size], MAT_ID.sea);
      return;
    }
    if (c === CL.AIRFIELD) {
      const af = this.airfieldAt(x0 + size / 2, z0 + size / 2);
      emit([x0, z0, x0 + size, z0, x0 + size, z0 + size, x0, z0 + size], MAT_ID.airfield);
      if (af) {
        // Perimeter track where it crosses this cell.
        const e = af.half - 25;
        const track = (ax0: number, az0: number, ax1: number, az1: number) => {
          const cx0 = Math.max(ax0, x0), cx1 = Math.min(ax1, x0 + size), cz0 = Math.max(az0, z0), cz1 = Math.min(az1, z0 + size);
          if (cx0 < cx1 && cz0 < cz1) emit([cx0, cz0, cx1, cz0, cx1, cz1, cx0, cz1], MAT_ID.town);
        };
        const { x, z } = af.pos;
        track(x - e - 6, z - e - 6, x + e + 6, z - e + 6);
        track(x - e - 6, z + e - 6, x + e + 6, z + e + 6);
        track(x - e - 6, z - e - 6, x - e + 6, z + e + 6);
        track(x + e - 6, z - e - 6, x + e + 6, z + e + 6);
        for (const cr of af.craters) {
          if (cr.x < x0 || cr.x > x0 + size || cr.z < z0 || cr.z > z0 + size) continue;
          const r = cr.r;
          emit([cr.x - r, cr.z - r * 0.4, cr.x - r * 0.4, cr.z - r, cr.x + r * 0.4, cr.z - r, cr.x + r, cr.z - r * 0.4, cr.x + r, cr.z + r * 0.4, cr.x + r * 0.4, cr.z + r, cr.x - r * 0.4, cr.z + r, cr.x - r, cr.z + r * 0.4], MAT_ID.plough);
        }
      }
    }
  }
}

const CLASS_MAT: Record<number, number> = {
  [CL.SEA]: MAT_ID.sea, [CL.FIELDS]: MAT_ID.field, [CL.WOOD]: MAT_ID.wood, [CL.DOWNS]: MAT_ID.downs,
  [CL.MARSH]: MAT_ID.marsh, [CL.TOWN]: MAT_ID.town, [CL.CITY]: MAT_ID.city, [CL.RIVER]: MAT_ID.river,
  [CL.MUD]: MAT_ID.mud, [CL.BEACH]: MAT_ID.beach, [CL.ORCHARD]: MAT_ID.wood, [CL.HOPS]: MAT_ID.field,
  [CL.FRANCE]: MAT_ID.field, [CL.AIRFIELD]: MAT_ID.airfield, [CL.CLIFF]: MAT_ID.chalk, [CL.SUBURB]: MAT_ID.town,
};

const CLASS_SURFACE: Record<number, Surface> = {
  [CL.SEA]: 'sea', [CL.FIELDS]: 'pasture', [CL.WOOD]: 'woodland', [CL.DOWNS]: 'pasture', [CL.MARSH]: 'marsh',
  [CL.TOWN]: 'town', [CL.CITY]: 'town', [CL.RIVER]: 'water', [CL.MUD]: 'marsh', [CL.BEACH]: 'beach',
  [CL.ORCHARD]: 'orchard', [CL.HOPS]: 'hops', [CL.FRANCE]: 'stubble', [CL.AIRFIELD]: 'airfield', [CL.CLIFF]: 'chalk',
  [CL.SUBURB]: 'town',
};

let shared: WorldMap | null = null;
/** The map is big to decode; share one instance. */
export function worldMap(): WorldMap {
  return (shared ??= new WorldMap());
}
