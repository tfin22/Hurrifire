// Spotting aids: finding the enemy in a big sky. Far off, a reported raid or
// a formation is one oblong with its strength and where it is ("25 BOMBERS
// / OVER EASTBOURNE 12 MI"). Closer in, the oblong breaks into individual
// brackets with the type ("BF 109E ACE!"). Off screen, an arrow at the edge
// of the view points to the nearest group.

import { Vec3 } from '../core/math';
import { describePlace } from '../content/world/describe';
import type { WorldMap } from '../content/world/map';
import type { Camera } from '../render/camera';
import { drawText, textWidth } from '../render/font';
import type { FrameBuffer } from '../render/framebuffer';
import { C } from '../render/palette';
import { fillConvex, line, rectOutline } from '../render/raster';
import type { Plane } from '../sim/plane';
import type { Homing } from '../sim/sortie';
import type { World } from '../sim/world';
import { TUNING } from '../tuning';
import { targetScale } from '../sim/ballistics';

interface Group {
  members: Plane[];
  /** Where to draw it (centroid, or the radar plot for a raid not yet in sight). */
  pos: Vec3;
  dist: number;
  /** From the radar: strength is an estimate, and the height may be out. */
  reported: boolean;
  estimate: number;
}

const M_PER_MILE = 1609;
const placeCache = new Map<string, string>();

/** "over Eastbourne", cached on a 2 km grid (describePlace is not free). */
function placeOf(map: WorldMap | null, p: Vec3): string {
  if (!map) return '';
  const key = `${Math.round(p.x / 2000)},${Math.round(p.z / 2000)}`;
  let s = placeCache.get(key);
  if (s === undefined) {
    s = describePlace(map, p.x, p.z).toUpperCase();
    if (placeCache.size > 2000) placeCache.clear();
    placeCache.set(key, s);
  }
  return s;
}

/** Enemy aircraft gathered into formations, plus raids the radar has but nobody can see yet. */
export function enemyGroups(world: World, me: Plane): Group[] {
  const S = TUNING.spotting;
  const enemies = world.planes
    .filter((q) => q.side !== me.side && q.status === 'flying')
    .map((q) => ({ q, d: q.pos.distTo(me.pos) }))
    .filter((e) => e.d < S.groupRange)
    .sort((a, b) => a.d - b.d);
  const groups: Group[] = [];
  for (const { q, d } of enemies) {
    const g = groups.find((x) => x.members.some((m) => m.pos.distTo(q.pos) < S.groupJoin));
    if (g) { g.members.push(q); g.pos.add(q.pos); continue; }
    groups.push({ members: [q], pos: q.pos.clone(), dist: d, reported: false, estimate: 0 });
  }
  for (const g of groups) g.pos.scale(1 / g.members.length);
  // The RAF hears of raids from the radar long before anyone sees them.
  if (me.side === 'raf') {
    for (const r of world.raids) {
      if (!r.started || r.spawned) continue;
      const pos = r.plot.clone();
      pos.y = r.alt + r.heightError;
      const d = pos.distTo(me.pos);
      if (d > S.groupRange * 2) continue;
      groups.push({ members: [], pos, dist: d, reported: true, estimate: r.estimatedStrength });
    }
  }
  return groups.sort((a, b) => a.dist - b.dist);
}

/** "18 BOMBERS + 12 FIGHTERS" */
function strength(g: Group): string {
  if (g.reported) return `RAID ${g.estimate}+ AIRCRAFT`;
  let bombers = 0, fighters = 0;
  for (const m of g.members) (m.type.role === 'bomber' || m.type.role === 'diveBomber' ? bombers++ : fighters++);
  const part = (n: number, w: string) => (n ? `${n} ${w}${n === 1 ? '' : 'S'}` : '');
  return [part(bombers, 'BOMBER'), part(fighters, 'FIGHTER')].filter(Boolean).join(' + ');
}

/** Screen boxes already taken by labels this frame. */
const taken: [number, number, number, number][] = [];

/** Draw a label centred on x, unless it would sit on another one. Returns whether it was drawn. */
function label(fb: FrameBuffer, cam: Camera, text: string, x: number, y: number, c: number, force = false): boolean {
  const w = textWidth(text, 'tiny');
  const lx = Math.max(cam.vx0 + 1, Math.min(cam.vx1 - w - 1, Math.round(x - w / 2)));
  const ly = Math.max(cam.vy0 + 1, Math.min(cam.vy1 - 7, Math.round(y)));
  const box: [number, number, number, number] = [lx - 1, ly - 1, lx + w + 1, ly + 7];
  if (!force && taken.some((t) => box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1])) return false;
  taken.push(box);
  drawText(fb, text, lx, ly, c, 'tiny', C.BLACK);
  return true;
}

export function drawSpotting(fb: FrameBuffer, cam: Camera, world: World, me: Plane, map: WorldMap | null): void {
  const S = TUNING.spotting;
  const groups = enemyGroups(world, me);
  const out = { x: 0, y: 0, z: 0 };
  let offscreen: Group | null = null;
  let labelled = 0;
  taken.length = 0;
  for (const g of groups) {
    const close = !g.reported && g.dist < S.individualRange;
    if (close) {
      // Individual brackets, and the type for the nearest few.
      const byRange = [...g.members].sort((a, b) => a.pos.distTo(me.pos) - b.pos.distTo(me.pos));
      for (const q of byRange) {
        const d = q.pos.distTo(me.pos);
        if (d > S.individualRange * 1.5 || !cam.project(q.pos, out)) continue;
        const r = Math.max(3, (cam.f * q.type.span * 0.5 * (world.bigTargets ? targetScale(d) : 1)) / out.z + 2);
        const x0 = out.x - r, x1 = out.x + r, y0 = out.y - r, y1 = out.y + r;
        const ace = q.skill.level === 'experte';
        const col = ace ? C.SIGHT : C.FIRE_R;
        for (const [x, y, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]] as const) {
          line(fb, x, y, x + dx * 2, y, col);
          line(fb, x, y, x, y + dy * 2, col);
        }
        if (labelled < S.maxLabels) {
          const name = `${q.type.name.toUpperCase()}${ace ? ' ACE!' : ''}`;
          if (label(fb, cam, name, out.x, y0 - 8, col) || label(fb, cam, name, out.x, y1 + 2, col)) {
            labelled++;
            if (d < 1500) label(fb, cam, `${Math.round((d * 1.0936) / 10) * 10} YDS`, x1 + 14, out.y - 3, col);
          }
        }
      }
      if (!g.members.some((q) => cam.project(q.pos, out)) && !offscreen) offscreen = g;
      continue;
    }
    // One oblong round the whole formation.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const pts = g.members.length ? g.members.map((m) => m.pos) : [g.pos];
    for (const p of pts) {
      if (!cam.project(p, out)) continue;
      x0 = Math.min(x0, out.x); x1 = Math.max(x1, out.x); y0 = Math.min(y0, out.y); y1 = Math.max(y1, out.y);
    }
    if (x0 === Infinity) { if (!offscreen) offscreen = g; continue; }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const w = Math.max(14, x1 - x0 + 6), h = Math.max(7, y1 - y0 + 6);
    const col = g.reported ? C.FIRE_Y : C.WHITE;
    rectOutline(fb, Math.round(cx - w / 2), Math.round(cy - h / 2), Math.round(w), Math.round(h), col);
    label(fb, cam, strength(g), cx, cy - h / 2 - 15, col, true);
    label(fb, cam, `${placeOf(map, g.pos)}  ${(g.dist / M_PER_MILE).toFixed(g.dist < 16000 ? 1 : 0)} MI`, cx, cy - h / 2 - 8, col, true);
  }
  if (offscreen) {
    const g = offscreen;
    const n = g.reported ? `RAID ${g.estimate}+` : strength(g).split(' + ')[0];
    drawPointer(fb, cam, g.pos, `${n} ${miles(g.dist)} MI`, g.reported ? C.FIRE_Y : C.FIRE_R);
  }
}

const miles = (d: number) => (d / M_PER_MILE).toFixed(d < 16000 ? 1 : 0);

/**
 * The field from a homing: its name and distance, and a line down the
 * landing run with an arrow the way to land (into the wind). Off screen, an
 * arrow at the edge of the view.
 */
export function drawHoming(fb: FrameBuffer, cam: Camera, me: Plane, h: Homing): void {
  const f = h.field;
  const col = C.SIGHT;
  const dx = Math.sin(h.landDir), dz = Math.cos(h.landDir);
  const half = f.len / 2;
  const y = f.pos.y + 2;
  const a = new Vec3(f.pos.x - dx * half, y, f.pos.z - dz * half);
  const b = new Vec3(f.pos.x + dx * half, y, f.pos.z + dz * half);
  const d = Math.hypot(f.pos.x - me.pos.x, f.pos.z - me.pos.z);
  const dist = me.side === 'lw' ? `${(d / 1000).toFixed(d < 10000 ? 1 : 0)} KM` : `${miles(d)} MI`;
  const pc = { x: 0, y: 0, z: 0 }, pa = { x: 0, y: 0, z: 0 }, pb = { x: 0, y: 0, z: 0 };
  const inView = cam.project(f.pos, pc) && pc.x > cam.vx0 + 6 && pc.x < cam.vx1 - 6 && pc.y > cam.vy0 + 6 && pc.y < cam.vy1 - 6;
  if (!inView) {
    drawPointer(fb, cam, f.pos, `${f.name.toUpperCase()} ${dist}`, col);
    return;
  }
  if (cam.project(a, pa) && cam.project(b, pb)) {
    // The landing run, doubled up to read at a distance, and its arrowhead.
    line(fb, pa.x, pa.y, pb.x, pb.y, col);
    line(fb, pa.x, pa.y + 1, pb.x, pb.y + 1, col);
    const ex = pb.x - pa.x, ey = pb.y - pa.y, l = Math.hypot(ex, ey);
    if (l > 6) {
      const ux = ex / l, uy = ey / l, s = Math.min(6, l * 0.4);
      line(fb, pb.x, pb.y, pb.x - ux * s - uy * s * 0.6, pb.y - uy * s + ux * s * 0.6, col);
      line(fb, pb.x, pb.y, pb.x - ux * s + uy * s * 0.6, pb.y - uy * s - ux * s * 0.6, col);
    }
  }
  // A diamond on the field so it can be found even when the run is a few pixels long.
  const r = 4;
  line(fb, pc.x - r, pc.y, pc.x, pc.y - r, col); line(fb, pc.x, pc.y - r, pc.x + r, pc.y, col);
  line(fb, pc.x + r, pc.y, pc.x, pc.y + r, col); line(fb, pc.x, pc.y + r, pc.x - r, pc.y, col);
  const land = String(Math.round(((h.landDir * 180) / Math.PI + 360) % 360)).padStart(3, '0');
  label(fb, cam, f.name.toUpperCase(), pc.x, pc.y - 18, col, true);
  label(fb, cam, `${dist}  LAND ${land}`, pc.x, pc.y - 11, col, true);
}

/** An arrow at the edge of the view towards something out of sight. */
function drawPointer(fb: FrameBuffer, cam: Camera, pos: Vec3, text: string, col: number): void {
  const t = [0, 0, 0];
  cam.toCam(pos.x, pos.y, pos.z, t);
  // Screen-space direction (y down); straight behind reads as "below".
  let dx = t[0], dy = -t[1];
  if (t[2] < 0) { dx = -dx; dy = -dy; }
  if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) dy = 1;
  const l = Math.hypot(dx, dy);
  dx /= l; dy /= l;
  const cx = cam.cx, cy = (cam.vy0 + cam.vy1) / 2;
  const hw = (cam.vx1 - cam.vx0) / 2 - 10, hh = (cam.vy1 - cam.vy0) / 2 - 10;
  const k = Math.min(hw / Math.max(1e-6, Math.abs(dx)), hh / Math.max(1e-6, Math.abs(dy)));
  const px = cx + dx * k, py = cy + dy * k;
  const s = 6;
  fillConvex(fb, [px + dx * s, px - dx * s - dy * s * 0.7, px - dx * s + dy * s * 0.7], [py + dy * s, py - dy * s + dx * s * 0.7, py - dy * s - dx * s * 0.7], 3, col);
  // The label goes beside the arrow on the inside, clear of the point.
  const tw = textWidth(text, 'tiny');
  const lx = Math.abs(dx) > Math.abs(dy) ? px - Math.sign(dx) * (tw / 2 + 10) : px;
  const ly = Math.abs(dx) > Math.abs(dy) ? py - 3 : py - Math.sign(dy) * 12 - 3;
  label(fb, cam, text, lx, ly, col, true);
}
