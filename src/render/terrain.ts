// Ground renderer: a patchwork of flat-shaded cells in distance bands.
//   band 0 (near):  small cells, plus per-field detail polygons from the source
//   band 1 (mid):   medium cells
//   band 2 (far):   coarse blocks out towards the horizon
// Detail drops out band by band; colours step up their ramp towards haze with
// distance. Beyond the far band the copper ground gradient shows through.
// Cells are drawn back to front within each band, and bands far to near, so
// the painter's algorithm holds for the (gentle) relief of south-east England.

import { Camera } from './camera';
import { clipNear } from './clip';
import { FrameBuffer } from './framebuffer';
import { C, Material, MATERIAL_LIST, shadeIndex } from './palette';
import { fillConvex } from './raster';
import { Vec3 } from '../core/math';
import { TUNING } from '../tuning';

export interface TerrainSource {
  /** Ground height (m) at world x, z. */
  heightAt(x: number, z: number): number;
  /** Material id (index into MATERIAL_LIST) for the cell at (ix, iz) of the given size; -1 = don't draw. */
  cellMaterial(ix: number, iz: number, size: number): number;
  /** True if the cell is open water (flat, glints). */
  cellIsWater(ix: number, iz: number, size: number): boolean;
  /**
   * Near-band detail inside one cell: emit flat polygons (fields, woods,
   * roads, towns). Points are [x, z] in world metres; the renderer drapes
   * them over the cell at its average height.
   */
  nearDetail?(ix: number, iz: number, size: number, emit: (pts: number[], material: number) => void): void;
}

export interface TerrainBand {
  size: number;
  range: number;
}

const tmp = new Float64Array(3);

export class TerrainRenderer {
  bands: TerrainBand[] = [
    { size: 500, range: TUNING.render.terrainNearM },
    { size: 1000, range: TUNING.render.terrainMidM },
    { size: 4000, range: TUNING.render.terrainVeryFarM },
  ];
  /** Detail-level drop (1990 mode): skip the near band's detail polygons. */
  lowDetail = false;
  stats = { cells: 0 };
  private poly = new Float64Array(32 * 3);
  private clipped = new Float64Array(32 * 3);
  private sx = new Float64Array(32);
  private sy = new Float64Array(32);
  private cells: { d: number; ix: number; iz: number }[] = [];

  constructor(public src: TerrainSource) {}

  /** Near-band detail polygons are drawn only this close (m). */
  detailRange = 2000;

  draw(fb: FrameBuffer, cam: Camera, sun: Vec3, fogScale: number, coarseOnly = false): void {
    this.stats.cells = 0;
    fb.setClip(cam.vx0, cam.vy0, cam.vx1, cam.vy1);
    const alt = cam.pos.y;
    // Each band covers a square of whole cells around the camera; a coarser
    // band skips only the cells entirely covered by the next finer band, so
    // there are never holes (overlaps are painted over by the finer band).
    const bands = coarseOnly ? [this.bands[this.bands.length - 1]] : this.bands.filter((_b, i) => i !== 0 || alt < 1500);
    const rects: { x0: number; z0: number; x1: number; z1: number }[] = [];
    for (const { size, range } of bands) {
      const n = Math.ceil(range / size);
      const cx = Math.floor(cam.pos.x / size), cz = Math.floor(cam.pos.z / size);
      rects.push({ x0: (cx - n) * size, z0: (cz - n) * size, x1: (cx + n + 1) * size, z1: (cz + n + 1) * size });
    }
    for (let b = bands.length - 1; b >= 0; b--) {
      const outer = b === bands.length - 1;
      const near = bands[b] === this.bands[0];
      this.drawBand(fb, cam, sun, bands[b].size, rects[b], b > 0 ? rects[b - 1] : null, outer ? bands[b].range : 0, near, fogScale);
    }
  }

  private drawBand(
    fb: FrameBuffer, cam: Camera, sun: Vec3, size: number,
    rect: { x0: number; z0: number; x1: number; z1: number },
    skip: { x0: number; z0: number; x1: number; z1: number } | null,
    circle: number, near: boolean, fogScale: number,
  ): void {
    const px = cam.pos.x, pz = cam.pos.z;
    const cells = this.cells;
    cells.length = 0;
    const r2 = circle * circle;
    for (let iz = Math.round(rect.z0 / size); iz < Math.round(rect.z1 / size); iz++) {
      for (let ix = Math.round(rect.x0 / size); ix < Math.round(rect.x1 / size); ix++) {
        const x0 = ix * size, z0 = iz * size;
        if (skip && x0 >= skip.x0 && x0 + size <= skip.x1 && z0 >= skip.z0 && z0 + size <= skip.z1) continue;
        const wx = x0 + size / 2, wz = z0 + size / 2;
        const dx = wx - px, dz = wz - pz;
        const d = dx * dx + dz * dz;
        if (circle > 0 && d > r2) continue;
        // Frustum cull with the cell's bounding sphere.
        cam.toCam(wx, 0, wz, tmp);
        if (!cam.sphereVisible(tmp[0], tmp[1], tmp[2], size * 0.75 + 150)) continue;
        cells.push({ d, ix, iz });
      }
    }
    cells.sort((a, b) => b.d - a.d);
    const src = this.src;
    for (const c of cells) {
      const x0 = c.ix * size, z0 = c.iz * size;
      const water = src.cellIsWater(c.ix, c.iz, size);
      const h00 = water ? 0 : src.heightAt(x0, z0);
      const h10 = water ? 0 : src.heightAt(x0 + size, z0);
      const h11 = water ? 0 : src.heightAt(x0 + size, z0 + size);
      const h01 = water ? 0 : src.heightAt(x0, z0 + size);
      const dist = Math.sqrt(c.d) + 1;
      const fog = fogLevel(dist, fogScale);
      const matId = src.cellMaterial(c.ix, c.iz, size);
      if (matId < 0) continue; // off the map: leave the haze
      const mat = MATERIAL_LIST[matId];
      // Slope shading: normal from the corner heights.
      const nx = (h00 + h01 - h10 - h11) / (2 * size);
      const nz = (h00 + h10 - h01 - h11) / (2 * size);
      const inv = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
      const ld = (nx * sun.x + sun.y + nz * sun.z) * inv;
      let colour: number;
      if (water) colour = this.waterColour(cam, sun, x0 + size / 2, z0 + size / 2, fog, mat);
      else colour = shadeIndex(mat, 0.25 + 0.75 * ld * ld, fog);
      this.quad(fb, cam, x0, z0, size, h00, h10, h11, h01, colour);
      this.stats.cells++;
      if (near && !water && !this.lowDetail && src.nearDetail && fog === 0 && c.d < this.detailRange * this.detailRange) {
        src.nearDetail(c.ix, c.iz, size, (pts, m) => {
          const mm = MATERIAL_LIST[m];
          const col = shadeIndex(mm, 0.25 + 0.75 * ld * ld, fog);
          this.drapedPoly(fb, cam, pts, col);
        });
      }
    }
  }

  private waterColour(cam: Camera, sun: Vec3, x: number, z: number, fog: number, mat: Material): number {
    // Sun glint: the reflection of the view ray off flat water lines up with the sun.
    const dx = x - cam.pos.x, dy = -cam.pos.y, dz = z - cam.pos.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    const rx = dx / l, ry = -dy / l, rz = dz / l;
    const g = rx * sun.x + ry * sun.y + rz * sun.z;
    if (g > 0.985) return C.WHITE;
    if (g > 0.955) return C.HAZE;
    return shadeIndex(mat, 0.5, fog);
  }

  private quad(fb: FrameBuffer, cam: Camera, x0: number, z0: number, s: number, h00: number, h10: number, h11: number, h01: number, colour: number): void {
    const flat = Math.abs(h00 - h11) + Math.abs(h10 - h01) < 2;
    if (flat) {
      this.emit(fb, cam, [x0, h00, z0, x0 + s, h10, z0, x0 + s, h11, z0 + s, x0, h01, z0 + s], 4, colour);
    } else {
      this.emit(fb, cam, [x0, h00, z0, x0 + s, h10, z0, x0 + s, h11, z0 + s], 3, colour);
      this.emit(fb, cam, [x0, h00, z0, x0 + s, h11, z0 + s, x0, h01, z0 + s], 3, colour);
    }
  }

  /** A ground polygon draped over the terrain (heights at its corners, a little above). */
  private drapedPoly(fb: FrameBuffer, cam: Camera, pts: number[], colour: number): void {
    const n = pts.length / 2;
    const w: number[] = [];
    for (let i = 0; i < n; i++) w.push(pts[i * 2], this.src.heightAt(pts[i * 2], pts[i * 2 + 1]) + 0.6, pts[i * 2 + 1]);
    this.emit(fb, cam, w, n, colour);
  }

  /** World polygon → camera → near clip → project → fill. */
  emit(fb: FrameBuffer, cam: Camera, world: number[], n: number, colour: number): void {
    const p = this.poly;
    let behind = false, allBehind = true;
    for (let i = 0; i < n; i++) {
      cam.toCam(world[i * 3], world[i * 3 + 1], world[i * 3 + 2], tmp);
      p[i * 3] = tmp[0]; p[i * 3 + 1] = tmp[1]; p[i * 3 + 2] = tmp[2];
      if (tmp[2] < cam.near) behind = true;
      else allBehind = false;
    }
    if (allBehind) return;
    let src: Float64Array = p, cnt = n;
    if (behind) {
      cnt = clipNear(p, n, cam.near, this.clipped);
      src = this.clipped;
      if (cnt < 3) return;
    }
    for (let i = 0; i < cnt; i++) {
      const z = src[i * 3 + 2];
      this.sx[i] = cam.projX(src[i * 3], z);
      this.sy[i] = cam.projY(src[i * 3 + 1], z);
    }
    fillConvex(fb, this.sx, this.sy, cnt, colour);
  }
}

export function fogLevel(dist: number, fogScale: number): number {
  const s = TUNING.render.fogSteps;
  if (dist < s[0] * fogScale) return 0;
  if (dist < s[1] * fogScale) return 1;
  if (dist < s[2] * fogScale) return 2;
  return 3;
}
