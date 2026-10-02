// Assist-mode landing aids: suitable fields within glide range outlined in
// green as you glide, and a simple approach indicator (too high / too low /
// on the path). Authentic mode shows none of this.

import { clamp, Vec3 } from '../core/math';
import { stallSpeed } from '../content/aircraft';
import { Camera } from '../render/camera';
import { drawText } from '../render/font';
import { FrameBuffer } from '../render/framebuffer';
import { C } from '../render/palette';
import { fillRect, line, rectOutline, stippleConvex } from '../render/raster';
import { glideRange } from '../sim/glide';
import { FieldRect, GroundModel, Surface } from '../sim/ground';
import { rolloutDistance } from '../sim/landing';
import { Plane } from '../sim/plane';

export interface FieldCandidate {
  rect: FieldRect;
  surface: Surface;
  /** Usable length along the best direction (m). */
  len: number;
  /** Landing heading along the long axis, into wind where possible (rad). */
  dir: number;
  /** Near end (touchdown point) for the approach indicator. */
  touchdown: Vec3;
  dist: number;
}

const WHEELS_OK: Surface[] = ['airfield', 'pasture', 'stubble', 'beach', 'chalk'];
const BELLY_OK: Surface[] = ['airfield', 'pasture', 'stubble', 'beach', 'chalk', 'ploughed', 'marsh'];

/** Fields you could put it down in from here. */
export function findFields(ground: GroundModel, p: Plane, wind: Vec3, max = 6): FieldCandidate[] {
  if (!ground.fieldAt) return [];
  const fs = p.fs;
  const gh = ground.heightAt(fs.pos.x, fs.pos.z);
  const agl = fs.pos.y - gh;
  const reach = Math.min(6000, glideRange(p.type, agl, 0, 60, fs.mass));
  if (reach < 300) return [];
  const gearDown = fs.gear > 0.98 && p.damage.gear === 'ok';
  const vTouch = stallSpeed(p.type, fs.mass, 1.225, fs.flaps) * 1.1;
  const seen = new Set<string>();
  const out: FieldCandidate[] = [];
  for (let a = -70; a <= 70; a += 14) {
    const h = fs.heading + (a * Math.PI) / 180;
    for (let d = 350; d <= reach; d += 350) {
      const x = fs.pos.x + Math.sin(h) * d, z = fs.pos.z + Math.cos(h) * d;
      const f = ground.fieldAt(x, z);
      const key = `${f.x0},${f.z0}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const surface = ground.surfaceAt((f.x0 + f.x1) / 2, (f.z0 + f.z1) / 2);
      if (!(gearDown ? WHEELS_OK : BELLY_OK).includes(surface)) continue;
      const lx = f.x1 - f.x0, lz = f.z1 - f.z0;
      // Land along the long axis, into the wind.
      const alongX = lx >= lz;
      const len = Math.max(lx, lz);
      const windAlong = alongX ? wind.x : wind.z;
      const dir = alongX ? (windAlong > 0 ? -Math.PI / 2 : Math.PI / 2) : (windAlong > 0 ? Math.PI : 0);
      const head = -(alongX ? (dir > 0 ? wind.x : -wind.x) : (dir === 0 ? wind.z : -wind.z));
      const need = rolloutDistance(Math.max(5, vTouch - head), surface, gearDown) + 60;
      if (len < need) continue;
      const cx = (f.x0 + f.x1) / 2, cz = (f.z0 + f.z1) / 2;
      const tx = cx - Math.sin(dir) * (len / 2 - 30), tz = cz - Math.cos(dir) * (len / 2 - 30);
      out.push({ rect: f, surface, len, dir, touchdown: new Vec3(tx, ground.heightAt(tx, tz), tz), dist: Math.hypot(cx - fs.pos.x, cz - fs.pos.z) });
    }
  }
  out.sort((a, b) => b.len - a.len + (a.dist - b.dist) * 0.05);
  return out.slice(0, max);
}

export function drawFieldHighlights(fb: FrameBuffer, cam: Camera, ground: GroundModel, fields: FieldCandidate[]): void {
  fb.setClip(cam.vx0, cam.vy0, cam.vx1, cam.vy1);
  const p = { x: 0, y: 0, z: 0 };
  for (const f of fields) {
    const r = f.rect;
    const corners = [[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1], [r.x0, r.z1]].map(([x, z]) => new Vec3(x, ground.heightAt(x, z) + 1, z));
    const pts: { x: number; y: number }[] = [];
    let ok = true;
    for (const c of corners) {
      if (!cam.project(c, p)) { ok = false; break; }
      pts.push({ x: p.x, y: p.y });
    }
    if (!ok) continue;
    stippleConvex(fb, pts.map((q) => q.x), pts.map((q) => q.y), 4, C.RAF_GREEN_L);
    for (let i = 0; i < 4; i++) {
      const a = pts[i], b = pts[(i + 1) % 4];
      line(fb, a.x, a.y, b.x, b.y, C.WHITE);
    }
    // Arrow for the landing direction at the touchdown end.
    if (cam.project(f.touchdown, p)) {
      const tip = f.touchdown.clone().add(new Vec3(Math.sin(f.dir) * 60, 0, Math.cos(f.dir) * 60));
      const q = { x: 0, y: 0, z: 0 };
      if (cam.project(tip, q)) line(fb, p.x, p.y, q.x, q.y, C.WHITE);
    }
  }
  fb.resetClip();
}

export type PathState = 'HIGH' | 'LOW' | 'ON PATH';

/** Compare the angle down to the touchdown point with the wanted approach angle. */
export function approachState(p: Plane, touchdown: Vec3, gliding: boolean): { state: PathState; err: number } {
  const fs = p.fs;
  const dx = touchdown.x - fs.pos.x, dz = touchdown.z - fs.pos.z;
  const dist = Math.hypot(dx, dz);
  const h = fs.pos.y - touchdown.y - p.type.gearHeight;
  const angle = Math.atan2(h, Math.max(1, dist));
  const want = gliding ? 0.11 : 0.075;
  const err = angle - want;
  return { state: err > 0.03 ? 'HIGH' : err < -0.02 ? 'LOW' : 'ON PATH', err };
}

export function drawApproachIndicator(fb: FrameBuffer, x: number, y: number, st: { state: PathState; err: number }): void {
  rectOutline(fb, x, y, 7, 41, C.GREY_D);
  fillRect(fb, x + 1, y + 20, 5, 1, C.WHITE);
  const k = clamp(st.err / 0.08, -1, 1);
  const py = y + 20 - Math.round(k * 18);
  fillRect(fb, x + 1, py - 1, 5, 3, st.state === 'ON PATH' ? C.FIELD_L : C.SIGHT);
  drawText(fb, st.state, x - (st.state.length * 4) + 7, y + 43, st.state === 'ON PATH' ? C.FIELD_L : C.SIGHT, 'tiny');
}
