// Ground objects placed on the map: airfield buildings and windsocks, oast
// houses across the hop country, the hand-authored landmarks, Chain Home
// masts and the barrage balloons. Deterministic; spatially indexed so the
// renderer only looks at what's near.

import { Quat, Vec3 } from '../../core/math';
import { hash01, Rng } from '../../core/rng';
import { CL, lonLatToXZ, PLACES, WorldMap } from './map';

export type ObjectKind =
  | 'oast' | 'hangar' | 'wreckedHangar' | 'hut' | 'windsock' | 'towerBridge' | 'battersea' | 'stPauls'
  | 'lighthouse' | 'castle' | 'cathedral' | 'docks' | 'chainHome';

export interface GroundObject {
  kind: ObjectKind;
  pos: Vec3;
  q: Quat;
  heading: number;
  /** For airfield objects: which airfield. */
  airfield?: string;
}

export interface Mast {
  base: Vec3;
  height: number;
}

export interface Balloon {
  pos: Vec3;
  ground: Vec3;
  /** Shot down / cut. */
  down: boolean;
}

const BUCKET = 4000;

export class WorldObjects {
  readonly objects: GroundObject[] = [];
  readonly masts: Mast[] = [];
  readonly balloons: Balloon[] = [];
  private grid = new Map<string, number[]>();

  constructor(readonly map: WorldMap) {
    this.build();
  }

  private add(kind: ObjectKind, x: number, z: number, heading: number, airfield?: string): void {
    const pos = new Vec3(x, this.map.heightAt(x, z), z);
    const o: GroundObject = { kind, pos, heading, q: Quat.fromEuler(heading, 0, 0), airfield };
    const i = this.objects.push(o) - 1;
    const key = `${Math.floor(x / BUCKET)},${Math.floor(z / BUCKET)}`;
    let l = this.grid.get(key);
    if (!l) this.grid.set(key, (l = []));
    l.push(i);
  }

  private build(): void {
    const m = this.map;
    // Airfields: hangars along one edge, huts, a windsock.
    for (const a of m.airfields) {
      const d = (a.dir * Math.PI) / 180;
      const ax = a.pos.x, az = a.pos.z;
      // Buildings on the edge to the right of the main direction.
      const rx = Math.cos(d), rz = -Math.sin(d), fx = Math.sin(d), fz = Math.cos(d);
      const edge = a.half + 30;
      const nh = a.kind === 'sector' ? 3 : a.kind === 'luftwaffe' ? 0 : 1;
      for (let i = 0; i < nh; i++) {
        const along = (i - (nh - 1) / 2) * 55;
        this.add('hangar', ax + rx * edge + fx * along, az + rz * edge + fz * along, d + Math.PI / 2, a.name);
      }
      for (let i = 0; i < 3; i++) {
        const along = -a.half * 0.6 + i * 18;
        this.add('hut', ax - rx * (a.half - 20) + fx * along, az - rz * (a.half - 20) + fz * along, d, a.name);
      }
      this.add('windsock', ax + rx * (a.half - 60) - fx * (a.half - 60), az + rz * (a.half - 60) - fz * (a.half - 60), 0, a.name);
    }
    // Oast houses in the hop country.
    for (let j = 0; j < m.nz; j++) {
      for (let i = 0; i < m.nx; i++) {
        const c = m.cls[j * m.nx + i];
        const p = c === CL.HOPS ? 0.4 : c === CL.FIELDS ? 0.012 : 0;
        if (p === 0 || hash01(i, j, 501) > p) continue;
        const x = -104000 + (i + 0.2 + 0.6 * hash01(i, j, 502)) * 500;
        const z = -84000 + (j + 0.2 + 0.6 * hash01(i, j, 503)) * 500;
        // Only in Kent and East Sussex.
        if (z > 25000 || z < -30000 || x < -40000 || x > 60000) continue;
        this.add('oast', x, z, hash01(i, j, 504) * Math.PI * 2);
      }
    }
    // Landmarks.
    for (const l of PLACES.landmarks) {
      const [x, z] = lonLatToXZ(l.lat, l.lon);
      const h = (l.dir * Math.PI) / 180;
      if (l.kind === 'chainHome') {
        this.add('chainHome', x, z, h);
        // A line of tall lattice towers (transmitter) — drawn as lines.
        for (let k = 0; k < 4; k++) {
          const bx = x + Math.sin(h) * (k - 1.5) * 55, bz = z + Math.cos(h) * (k - 1.5) * 55;
          this.masts.push({ base: new Vec3(bx, m.heightAt(bx, bz), bz), height: 110 });
        }
        for (let k = 0; k < 4; k++) {
          const bx = x + 120 + Math.sin(h) * (k - 1.5) * 20, bz = z - 60 + Math.cos(h) * (k - 1.5) * 20;
          this.masts.push({ base: new Vec3(bx, m.heightAt(bx, bz), bz), height: 72 });
        }
      } else this.add(l.kind as ObjectKind, x, z, h);
    }
    // Barrage balloons.
    const rng = new Rng('balloons');
    for (const g of PLACES.balloons) {
      const [cx, cz] = lonLatToXZ(g.lat, g.lon);
      for (let k = 0; k < g.count; k++) {
        const a = rng.next() * Math.PI * 2, r = Math.sqrt(rng.next()) * g.r * 1000;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        const gy = m.heightAt(x, z);
        this.balloons.push({ pos: new Vec3(x, gy + g.alt + rng.range(-150, 150), z), ground: new Vec3(x, gy, z), down: false });
      }
    }
  }

  /** Objects within range of a point. */
  near(x: number, z: number, range: number, out: GroundObject[] = []): GroundObject[] {
    out.length = 0;
    const r = Math.ceil(range / BUCKET);
    const bx = Math.floor(x / BUCKET), bz = Math.floor(z / BUCKET);
    for (let j = bz - r; j <= bz + r; j++) for (let i = bx - r; i <= bx + r; i++) {
      const l = this.grid.get(`${i},${j}`);
      if (!l) continue;
      for (const k of l) {
        const o = this.objects[k];
        if (Math.abs(o.pos.x - x) < range && Math.abs(o.pos.z - z) < range) out.push(o);
      }
    }
    return out;
  }
}
