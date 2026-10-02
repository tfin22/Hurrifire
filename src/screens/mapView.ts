// The map: an ops-room table plot of 11 Group's area. Raid counters are the
// controller's plot — updated every so often and approximate, not the truth.
// Your own position, the coast, the airfields, and (Assist) a glide-range
// ring showing where you could reach from your present height.

import { clamp, Vec3 } from '../core/math';
import { CL, WorldMap } from '../content/world/map';
import { drawText } from '../render/font';
import { FrameBuffer, H, W } from '../render/framebuffer';
import { C } from '../render/palette';
import { circle, fillCircle, fillRect, line, rectOutline } from '../render/raster';
import { glideRange } from '../sim/glide';
import type { Plane } from '../sim/plane';
import type { Raid } from '../sim/raid';

let base: Uint8Array | null = null;
const MX0 = 6, MY0 = 6, MW = 308, MH = 244;

function mapCol(c: number): number {
  switch (c) {
    case CL.SEA: return C.SEA;
    case CL.RIVER: return C.SEA;
    case CL.MUD: return C.RAF_EARTH_L;
    case CL.CITY: return C.GREY_D;
    case CL.TOWN: case CL.SUBURB: return C.GREY_L;
    case CL.WOOD: return C.FIELD;
    case CL.DOWNS: return C.STUBBLE;
    case CL.MARSH: return C.SKY_D;
    case CL.BEACH: case CL.CLIFF: return C.CHALK;
    case CL.FRANCE: return C.GOLD;
    case CL.AIRFIELD: return C.FIELD_L;
    default: return C.FIELD_L;
  }
}

export class MapProjection {
  constructor(readonly map: WorldMap) {}
  get x0() { return -104000; }
  get z0() { return -84000; }
  get scale() { return Math.min(MW / (this.map.nx * 500), MH / (this.map.nz * 500)); }
  sx(x: number): number { return MX0 + (x - this.x0) * this.scale; }
  sy(z: number): number { return MY0 + MH - (z - this.z0) * this.scale; }
}

function buildBase(map: WorldMap, P: MapProjection): Uint8Array {
  const px = new Uint8Array(W * H);
  px.fill(C.PANEL);
  for (let y = MY0; y < MY0 + MH; y++) {
    for (let x = MX0; x < MX0 + MW; x++) {
      const wx = P.x0 + (x - MX0 + 0.5) / P.scale;
      const wz = P.z0 + (MY0 + MH - y - 0.5) / P.scale;
      px[y * W + x] = mapCol(map.classAt(wx, wz));
    }
  }
  return px;
}

/** Plot updated every so often, with error: what the ops room shows. */
export class OpsPlot {
  private plots = new Map<number, { pos: Vec3; vel: Vec3; strength: number; t: number }>();

  update(raids: Raid[], time: number, every = 30): void {
    for (const r of raids) {
      if (!r.started || r.phase === 'scattered') continue;
      const old = this.plots.get(r.id);
      if (old && time - old.t < every) continue;
      const err = 2500;
      const h = (r.id * 9301 + Math.floor(time / every) * 49297) % 233280 / 233280;
      this.plots.set(r.id, {
        pos: r.plot.clone().add(new Vec3((h - 0.5) * err, 0, (((h * 7) % 1) - 0.5) * err)),
        vel: r.vel.clone(), strength: r.estimatedStrength, t: time,
      });
    }
  }

  draw(fb: FrameBuffer, P: MapProjection): void {
    for (const p of this.plots.values()) {
      const x = P.sx(p.pos.x), y = P.sy(p.pos.z);
      fillRect(fb, x - 6, y - 4, 13, 8, C.RED);
      rectOutline(fb, x - 6, y - 4, 13, 8, C.BLACK);
      drawText(fb, `${p.strength}+`, x - 5, y - 2, C.WHITE, 'tiny');
      const l = p.vel.len();
      if (l > 1) line(fb, x, y, x + (p.vel.x / l) * 14, y - (p.vel.z / l) * 14, C.RED);
    }
  }
}

export function drawMap(fb: FrameBuffer, map: WorldMap, me: Plane | null, plot: OpsPlot, assist: boolean, home: string, time: number): void {
  const P = new MapProjection(map);
  if (!base) base = buildBase(map, P);
  fb.resetClip();
  fb.px.set(base);
  rectOutline(fb, MX0 - 1, MY0 - 1, MW + 2, MH + 2, C.BLACK);
  for (const a of map.airfields) {
    const x = P.sx(a.pos.x), y = P.sy(a.pos.z);
    const lw = a.kind === 'luftwaffe';
    circle(fb, x, y, 2, a.name === home ? C.SIGHT : lw ? C.BLACK : C.BLUE);
    if (a.kind === 'sector' || a.name === home) drawText(fb, a.name.toUpperCase(), x + 4, y - 2, a.name === home ? C.SIGHT : C.SMOKE, 'tiny');
  }
  plot.draw(fb, P);
  if (me) {
    const x = P.sx(me.pos.x), y = P.sy(me.pos.z);
    if (assist && me.alive) {
      const agl = me.fs.agl;
      const r = glideRange(me.type, agl) * P.scale;
      if (r > 3) circle(fb, x, y, clamp(r, 3, 400), me.fs.engine === 'running' ? C.FIELD_D : C.WHITE);
    }
    fillCircle(fb, x, y, 2.5, (time * 4) % 2 < 1 ? C.WHITE : C.SIGHT);
    const h = me.fs.heading;
    line(fb, x, y, x + Math.sin(h) * 9, y - Math.cos(h) * 9, C.WHITE);
  }
  fillRect(fb, MX0, MY0, 120, 8, C.BLACK);
  drawText(fb, '11 GROUP - OPS ROOM PLOT', MX0 + 2, MY0 + 1, C.CHALK, 'tiny');
  drawText(fb, 'TAP OR M TO CLOSE', 240, 246, C.CHALK, 'tiny');
}
