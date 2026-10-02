// The software 3D pipeline:
//   world → camera transform → back-face cull → near-plane clip (Sutherland–
//   Hodgman) → perspective projection → screen-edge clip + scanline fill.
// Objects are sorted back to front (painter's algorithm); faces within an
// object are depth-sorted after back-face culling, with decals pinned to just
// after their parent face. Flat shading picks a step on the material's ramp
// from the angle to the sun; distance fog steps further up the ramp to haze.
// Distant aircraft collapse to a few pixels, then one, then nothing.

import { Quat, Vec3 } from '../core/math';
import { TUNING } from '../tuning';
import { Camera } from './camera';
import { clipNear, clipSegmentNear } from './clip';
import { FrameBuffer, W } from './framebuffer';
import { Model } from './model';
import { C, MATERIAL_LIST, shadeIndex } from './palette';
import { fillCircle, fillConvex, line, pset } from './raster';

export interface ModelOpts {
  /** Bitmask of parts NOT to draw. */
  hideParts?: number;
  /** Only draw these parts (bitmask). */
  onlyParts?: number;
  /** Hit flash: parts bitmask drawn bright this frame. */
  flashParts?: number;
  /** Force a detail level (0 high). */
  lod?: number;
  /** Colour for the speck/pixel stage. */
  speckColour?: number;
  /** Maximum distance at which the speck is drawn (m). */
  visRange?: number;
  /** Never collapse to pixels (cockpit, model viewer). */
  noCollapse?: boolean;
  /** Extra detail-level drop (1990 mode). */
  lodBias?: number;
  /** Non-uniform scale (clouds). */
  scale?: [number, number, number];
  /** Flat marking on the ground: drawn straight after the terrain, before anything standing on it. */
  ground?: boolean;
}

type Item =
  | { kind: 'model'; depth: number; model: Model; m: Float64Array; t: Float64Array; rw: Float64Array; lod: number; opts: ModelOpts; dist: number }
  | { kind: 'pixel'; depth: number; x: number; y: number; c: number; size: number }
  | { kind: 'line'; depth: number; a: number[]; b: number[]; c: number }
  | { kind: 'puff'; depth: number; x: number; y: number; r: number; c: number; stipple: boolean };

const MAX_VERTS = 4096;

export class Renderer3D {
  cam!: Camera;
  fb!: FrameBuffer;
  /** Unit vector pointing towards the sun (world). */
  readonly sun = new Vec3(0.3, 0.8, -0.5).normalize();
  /** Fog distances scale (weather haze): multiply TUNING fog steps. */
  fogScale = 1;
  lodBias = 0;
  private items: Item[] = [];
  private vcam = new Float64Array(MAX_VERTS * 3);
  private poly = new Float64Array(64 * 3);
  private clipped = new Float64Array(64 * 3);
  private sx = new Float64Array(64);
  private sy = new Float64Array(64);
  private faceOrder: { i: number; d: number }[] = [];
  stats = { objects: 0, faces: 0 };

  begin(cam: Camera, fb: FrameBuffer): void {
    this.cam = cam;
    this.fb = fb;
    this.items.length = 0;
    this.stats.objects = 0;
    this.stats.faces = 0;
  }

  fogLevel(dist: number): number {
    const s = TUNING.render.fogSteps;
    const k = this.fogScale;
    if (dist < s[0] * k) return 0;
    if (dist < s[1] * k) return 1;
    if (dist < s[2] * k) return 2;
    return 3;
  }

  addModel(model: Model, pos: Vec3, q: Quat, opts: ModelOpts = {}): void {
    const cam = this.cam;
    const t = new Float64Array(3);
    cam.toCam(pos.x, pos.y, pos.z, t);
    const sc = opts.scale;
    const r = sc ? model.radius * Math.max(sc[0], sc[1], sc[2]) : model.radius;
    if (!cam.sphereVisible(t[0], t[1], t[2], r)) return;
    const dist = Math.hypot(t[0], t[1], t[2]);
    const pr = (cam.f * r) / Math.max(t[2], cam.near);
    if (!opts.noCollapse) {
      const R = TUNING.render;
      if (pr < R.clusterBelowPx) {
        const vis = (opts.visRange ?? r * 1100) / Math.max(0.5, this.fogScale < 1 ? 1 / this.fogScale : 1);
        if (dist > vis || t[2] < cam.near) return;
        const x = cam.projX(t[0], t[2]), y = cam.projY(t[1], t[2]);
        const fog = this.fogLevel(dist);
        const c = opts.speckColour ?? (fog >= 2 ? C.GREY_L : fog === 1 ? C.GREY_D : C.SMOKE);
        this.items.push({ kind: 'pixel', depth: t[2], x, y, c, size: pr < R.pixelBelowPx ? 1 : 2 });
        return;
      }
    }
    // Rotation into camera space: Mc = Mcam · R(q).
    const rq = q.toMat3(new Float64Array(9)) as Float64Array;
    const mc = new Float64Array(9);
    const a = cam.m;
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        mc[i * 3 + j] = a[i * 3] * rq[j] + a[i * 3 + 1] * rq[3 + j] + a[i * 3 + 2] * rq[6 + j];
    if (sc) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) mc[i * 3 + j] *= sc[j];
    let lod = opts.lod ?? (pr < TUNING.render.lodLowBelowPx ? 2 : pr < TUNING.render.lodMedBelowPx ? 1 : 0);
    if (opts.lod === undefined) lod = Math.min(2, lod + this.lodBias + (opts.lodBias ?? 0));
    lod = Math.min(lod, model.lods.length - 1);
    this.items.push({ kind: 'model', depth: opts.ground ? 1e9 + t[2] : t[2], model: model.lods[lod], m: mc, t, rw: rq, lod, opts, dist });
  }

  /** A world-space point drawn as 1 or 2 pixels. */
  addPoint(p: Vec3, c: number, size = 1): void {
    const t = [0, 0, 0];
    this.cam.toCam(p.x, p.y, p.z, t);
    if (t[2] < this.cam.near) return;
    this.items.push({ kind: 'pixel', depth: t[2], x: this.cam.projX(t[0], t[2]), y: this.cam.projY(t[1], t[2]), c, size });
  }

  /** A 3D line segment (tracers, balloon cables). */
  addLine(a: Vec3, b: Vec3, c: number): void {
    const ta = [0, 0, 0], tb = [0, 0, 0];
    this.cam.toCam(a.x, a.y, a.z, ta);
    this.cam.toCam(b.x, b.y, b.z, tb);
    if (!clipSegmentNear(ta, tb, this.cam.near)) return;
    this.items.push({ kind: 'line', depth: (ta[2] + tb[2]) / 2, a: ta, b: tb, c });
  }

  /** A round puff (smoke, flame, flak, parachute canopy at range) of world radius r. */
  addPuff(p: Vec3, r: number, c: number, stipple = false): void {
    const t = [0, 0, 0];
    this.cam.toCam(p.x, p.y, p.z, t);
    if (t[2] < this.cam.near + r * 0.5) return;
    const pr = (this.cam.f * r) / t[2];
    if (pr < 0.3) return;
    this.items.push({ kind: 'puff', depth: t[2], x: this.cam.projX(t[0], t[2]), y: this.cam.projY(t[1], t[2]), r: pr, c, stipple });
  }

  /** Sort back to front and draw everything. */
  flush(): void {
    const fb = this.fb;
    fb.setClip(this.cam.vx0, this.cam.vy0, this.cam.vx1, this.cam.vy1);
    this.items.sort((a, b) => b.depth - a.depth);
    for (const it of this.items) {
      switch (it.kind) {
        case 'model':
          this.drawModel(it);
          this.stats.objects++;
          break;
        case 'pixel':
          pset(fb, it.x, it.y, it.c);
          if (it.size > 1) { pset(fb, it.x + 1, it.y, it.c); }
          break;
        case 'line':
          line(fb, this.cam.projX(it.a[0], it.a[2]), this.cam.projY(it.a[1], it.a[2]), this.cam.projX(it.b[0], it.b[2]), this.cam.projY(it.b[1], it.b[2]), it.c);
          break;
        case 'puff':
          if (it.r < 1) pset(fb, it.x, it.y, it.c);
          else if (it.stipple) stippleCircle(fb, it.x, it.y, it.r, it.c);
          else fillCircle(fb, it.x, it.y, it.r, it.c);
          break;
      }
    }
    this.items.length = 0;
  }

  private drawModel(it: Extract<Item, { kind: 'model' }>): void {
    const { model, m, t, rw, opts } = it;
    const verts = model.verts;
    const nv = verts.length / 3;
    const vc = this.vcam;
    for (let i = 0; i < nv && i < MAX_VERTS; i++) {
      const x = verts[i * 3], y = verts[i * 3 + 1], z = verts[i * 3 + 2];
      vc[i * 3] = m[0] * x + m[1] * y + m[2] * z + t[0];
      vc[i * 3 + 1] = m[3] * x + m[4] * y + m[5] * z + t[1];
      vc[i * 3 + 2] = m[6] * x + m[7] * y + m[8] * z + t[2];
    }
    const faces = model.faces;
    const order = this.faceOrder;
    order.length = 0;
    const hide = opts.hideParts ?? 0;
    const only = opts.onlyParts ?? -1;
    const visible = new Uint8Array(faces.length);
    for (let i = 0; i < faces.length; i++) {
      const f = faces[i];
      const bit = 1 << f.part;
      if (hide & bit || !(only & bit)) continue;
      // Back-face cull in camera space: visible if the normal faces the eye.
      const nx = m[0] * f.nx + m[1] * f.ny + m[2] * f.nz;
      const ny = m[3] * f.nx + m[4] * f.ny + m[5] * f.nz;
      const nz = m[6] * f.nx + m[7] * f.ny + m[8] * f.nz;
      const v0 = f.v[0] * 3;
      if (nx * vc[v0] + ny * vc[v0 + 1] + nz * vc[v0 + 2] >= 0) continue;
      visible[i] = 1;
      if (f.decalOf >= 0) continue;
      const d = m[6] * f.cx + m[7] * f.cy + m[8] * f.cz + t[2];
      order.push({ i, d });
    }
    order.sort((a, b) => b.d - a.d);
    // Insert decals right after their parent.
    const decals = new Map<number, number[]>();
    for (let i = 0; i < faces.length; i++) {
      const p = faces[i].decalOf;
      if (p >= 0 && visible[i] && visible[p]) {
        let l = decals.get(p);
        if (!l) decals.set(p, (l = []));
        l.push(i);
      }
    }
    const fog = this.fogLevel(it.dist);
    const sun = this.sun;
    const flash = opts.flashParts ?? 0;
    for (const o of order) {
      this.drawFace(o.i, model, vc, rw, fog, sun, flash);
      const ds = decals.get(o.i);
      if (ds) for (const di of ds) this.drawFace(di, model, vc, rw, fog, sun, flash);
    }
  }

  private drawFace(i: number, model: Model, vc: Float64Array, rw: Float64Array, fog: number, sun: Vec3, flash: number): void {
    const f = model.faces[i];
    const mat = MATERIAL_LIST[f.mat];
    // World-space normal for lighting.
    const wx = rw[0] * f.nx + rw[1] * f.ny + rw[2] * f.nz;
    const wy = rw[3] * f.nx + rw[4] * f.ny + rw[5] * f.nz;
    const wz = rw[6] * f.nx + rw[7] * f.ny + rw[8] * f.nz;
    const ld = wx * sun.x + wy * sun.y + wz * sun.z;
    const light = 0.5 + 0.5 * ld; // half-Lambert keeps shadowed faces readable
    let c = shadeIndex(mat, light, fog);
    if (flash & (1 << f.part) && (i & 1) === 0) c = (i & 2) ? C.WHITE : C.FIRE_Y;
    const n = f.v.length;
    const p = this.poly;
    let behind = false;
    for (let k = 0; k < n; k++) {
      const vi = f.v[k] * 3;
      p[k * 3] = vc[vi]; p[k * 3 + 1] = vc[vi + 1]; p[k * 3 + 2] = vc[vi + 2];
      if (vc[vi + 2] < this.cam.near) behind = true;
    }
    let src = p, cnt = n;
    if (behind) {
      cnt = clipNear(p, n, this.cam.near, this.clipped);
      src = this.clipped;
      if (cnt < 3) return;
    }
    const cam = this.cam;
    for (let k = 0; k < cnt; k++) {
      const z = src[k * 3 + 2];
      this.sx[k] = cam.projX(src[k * 3], z);
      this.sy[k] = cam.projY(src[k * 3 + 1], z);
    }
    fillConvex(this.fb, this.sx, this.sy, cnt, c);
    this.stats.faces++;
  }
}

function stippleCircle(fb: FrameBuffer, cx: number, cy: number, r: number, c: number): void {
  const y0 = Math.max(fb.y0, Math.ceil(cy - r)), y1 = Math.min(fb.y1 - 1, Math.floor(cy + r));
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy;
    const dx = Math.sqrt(Math.max(0, r * r - dy * dy));
    const xa = Math.max(fb.x0, Math.ceil(cx - dx - 0.5)), xb = Math.min(fb.x1 - 1, Math.ceil(cx + dx - 0.5) - 1);
    for (let x = xa + ((xa + y) & 1); x <= xb; x += 2) fb.px[y * W + x] = c;
  }
}
