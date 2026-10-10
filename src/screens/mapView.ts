// The map: an ops-room table plot of 11 Group's area. The counters are the
// ops room's picture, renewed every so often and approximate, not the truth:
// raids nobody has met yet from the radar; once a raid is in sight, each
// group of hostiles in it from the Observer Corps; and every other squadron
// of ours that's up, with a line to the raid it's been sent after. Flying a
// 109, it's the other way about: the raids are ours, the RAF the hostiles. Your own
// position, the coast, the airfields, and (Assist) a glide-range ring
// showing where you could reach from your present height.

import { clamp, M_TO_FT, Vec3 } from '../core/math';
import { CL, WorldMap } from '../content/world/map';
import { drawText, textWidth } from '../render/font';
import { FrameBuffer, H, W } from '../render/framebuffer';
import { C } from '../render/palette';
import { circle, fillCircle, fillRect, line, rectOutline } from '../render/raster';
import { FighterBrain } from '../sim/ai/fighter';
import { glideRange } from '../sim/glide';
import type { Plane } from '../sim/plane';
import type { Raid } from '../sim/raid';
import type { OtherSquadron } from '../sim/squadrons';
import { TUNING } from '../tuning';

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

/** One counter on the table: a raid or a group of hostiles, or a squadron of ours. */
export interface Counter {
  /** Theirs, or ours. */
  hostile: boolean;
  pos: Vec3;
  vel: Vec3;
  /** Strength ("12+") for hostiles, callsign for ours. */
  label: string;
  /** Height in angels for hostiles, strength for ours. */
  sub: string;
  /** Going home. */
  home: boolean;
  /** Ours, on the way to their raid: where it is. */
  to: Vec3 | null;
}

/** A fixed error per thing plotted, changing each time the plot is renewed. */
function plotError(pos: Vec3, id: number, bucket: number, err: number): Vec3 {
  const h = ((id * 9301 + bucket * 49297) % 233280) / 233280;
  return pos.clone().add(new Vec3((h - 0.5) * err, 0, (((h * 7) % 1) - 0.5) * err));
}

/** Things within `range` of one another (horizontally, chained) are one group. */
export function groupsOf<T extends { pos: Vec3 }>(items: readonly T[], range: number): T[][] {
  const out: T[][] = [];
  const seen = new Set<T>();
  for (const p of items) {
    if (seen.has(p)) continue;
    const g = [p];
    seen.add(p);
    for (let i = 0; i < g.length; i++) {
      for (const q of items) {
        if (seen.has(q) || Math.hypot(q.pos.x - g[i].pos.x, q.pos.z - g[i].pos.z) > range) continue;
        seen.add(q);
        g.push(q);
      }
    }
    out.push(g);
  }
  return out;
}

/** Something the ops room knows of: a raid, an aircraft seen, a squadron of ours. */
interface Sighting {
  pos: Vec3;
  vel: Vec3;
  /** How many it counts for (a raid's estimate, or one aircraft as the raid's estimate would have it). */
  n: number;
  /** Height as reported (m). */
  alt: number;
  home: boolean;
  /** For the plotting error. */
  key: number;
  err: number;
  sq?: OtherSquadron;
}

/**
 * The plot, as the ops room had it, renewed every so often and with error:
 * each raid nobody has met yet; once a raid is real, each group of hostiles
 * in it (the bombers, the escort, stragglers, 109s chasing about); and every
 * other squadron of ours that's up. Anything closer together than a counter
 * is wide goes on the table as one.
 */
export class OpsPlot {
  counters: Counter[] = [];
  private t = -Infinity;

  update(raids: readonly Raid[], planes: readonly Plane[], others: readonly OtherSquadron[], mine: 'raf' | 'lw', time: number): void {
    const M = TUNING.map;
    if (time - this.t < M.every) return;
    this.t = time;
    const bucket = Math.floor(time / M.every);
    // Germans: raids that are still only a plot, and every aircraft in sight.
    const lw: Sighting[] = [];
    for (const r of raids) {
      if (!r.started || r.spawned) continue;
      if (r.phase === 'outbound' && Math.hypot(r.plot.x - r.home.x, r.plot.z - r.home.z) < M.homeGone) continue;
      lw.push({ pos: r.plot, vel: r.vel, n: r.estimatedStrength, alt: r.alt + r.heightError, home: r.phase === 'outbound', key: r.id, err: M.radarError });
    }
    const raidOf = new Map<number, Raid>();
    for (const r of raids) for (const p of r.planes) raidOf.set(p.id, r);
    for (const p of planes) {
      if (p.side !== 'lw' || !p.alive) continue;
      const r = raidOf.get(p.id);
      lw.push({
        pos: p.pos, vel: p.fs.vel, n: r?.strengthFactor ?? 1, alt: p.pos.y + (r?.heightError ?? 0),
        home: !!r && (r.phase === 'outbound' || r.phase === 'scattered'), key: p.id, err: M.observerError,
      });
    }
    // The RAF: flying a 109, every aircraft you can see; otherwise the other squadrons up.
    const raf: Sighting[] = [];
    if (mine === 'lw') {
      for (const p of planes) if (p.side === 'raf' && p.alive) raf.push({ pos: p.pos, vel: p.fs.vel, n: 1, alt: p.pos.y, home: false, key: p.id, err: M.observerError });
    } else {
      for (const sq of others) {
        if (sq.state === 'waiting' || sq.state === 'down') continue;
        const up = sq.planes.filter((p) => p.alive);
        if (sq.real && !up.length) continue;
        const pos = new Vec3(), vel = new Vec3();
        if (sq.real) { for (const p of up) { pos.add(p.pos); vel.add(p.fs.vel); } pos.scale(1 / up.length); vel.scale(1 / up.length); }
        else { pos.copy(sq.plot); vel.copy(sq.vel); }
        const home = sq.state === 'home' || (sq.real && up.every((p) => p.brain instanceof FighterBrain && p.brain.state === 'rtb'));
        raf.push({ pos, vel, n: sq.strength, alt: pos.y, home, key: 1000 + Math.round(sq.spec.base.x), err: M.fixError, sq });
      }
    }
    const out: Counter[] = [];
    for (const [side, all] of [['lw', lw], ['raf', raf]] as const) {
      for (const home of [false, true]) {
        for (const g of groupsOf(all.filter((s) => s.home === home), M.groupRange)) {
          const n = g.reduce((a, s) => a + s.n, 0);
          const pos = new Vec3(), vel = new Vec3();
          let alt = 0;
          for (const s of g) { pos.addScaled(s.pos, s.n / n); vel.addScaled(s.vel, s.n / n); alt += (s.alt * s.n) / n; }
          const c: Counter = {
            hostile: side !== mine, pos: plotError(pos, g[0].key, bucket, Math.max(...g.map((s) => s.err))), vel,
            label: `${Math.max(1, Math.round(n))}+`, sub: `A${Math.max(1, Math.round((alt * M_TO_FT) / 1000))}`, home, to: null,
          };
          const sqs = g.map((s) => s.sq).filter((q): q is OtherSquadron => !!q);
          if (sqs.length) {
            // Ours: by callsign, or a wing.
            c.label = sqs.length === 1 ? sqs[0].spec.callsign : sqs.every((q) => q.spec.bigWing) ? 'WING' : `${sqs.length} SQNS`;
            c.sub = `${n}`;
            const raid = raids.find((r) => r.id === sqs[0].raidId);
            if (!home && raid?.started && sqs.every((q) => q.raidId === raid.id) && Math.hypot(raid.plot.x - pos.x, raid.plot.z - pos.z) > M.vectorLine) c.to = raid.plot.clone();
          }
          out.push(c);
        }
      }
    }
    this.counters = out;
  }

  draw(fb: FrameBuffer, P: MapProjection): void {
    // Hostiles go down where they are; ours are moved aside if they must be.
    const order = [...this.counters].sort((a, b) => Number(b.hostile) - Number(a.hostile));
    for (const c of order) {
      if (!c.to) continue;
      const x0 = P.sx(c.pos.x), y0 = P.sy(c.pos.z), x1 = P.sx(c.to.x), y1 = P.sy(c.to.z);
      const n = Math.floor(Math.hypot(x1 - x0, y1 - y0) / 5);
      for (let i = 1; i < n; i++) fillRect(fb, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, 1, 1, C.BLUE);
    }
    // A counter that would land on another is put alongside it, as a WAAF would.
    const placed: { c: Counter; x: number; y: number; w: number; cx: number; cy: number; moved: boolean }[] = [];
    for (const c of order) {
      // Gone home over France: off the table.
      if (c.home && P.map.classAt(c.pos.x, c.pos.z) === CL.FRANCE) continue;
      const w = Math.max(textWidth(c.label, 'tiny'), textWidth(c.sub, 'tiny')) + 3;
      const cx = Math.round(P.sx(c.pos.x)), cy = Math.round(P.sy(c.pos.z));
      const at = (dx: number, dy: number) => ({ x: clamp(cx - (w >> 1) + dx, MX0, MX0 + MW - w), y: clamp(cy - 7 + dy, MY0 + 9, MY0 + MH - 14) });
      const free = ({ x, y }: { x: number; y: number }) => !placed.some((b) => x < b.x + b.w + 1 && b.x < x + w + 1 && y < b.y + 15 && b.y < y + 15);
      const a = w + 1;
      const spots = [[0, 0], [0, 15], [0, -15], [a, 0], [-a, 0], [a, 15], [-a, 15], [a, -15], [-a, -15], [0, 30], [0, -30], [a, 30], [-a, 30], [a, -30], [-a, -30]];
      const spot = spots.find(([dx, dy]) => free(at(dx, dy))) ?? [0, 0];
      placed.push({ c, ...at(spot[0], spot[1]), w, cx, cy, moved: spot[0] !== 0 || spot[1] !== 0 });
    }
    // Arrows and leader lines under the counters.
    for (const { c, x, y, w, cx, cy, moved } of placed) {
      const l = c.vel.len();
      if (l > 1) line(fb, cx, cy, cx + (c.vel.x / l) * 14, cy - (c.vel.z / l) * 14, c.hostile ? C.RED : C.SKY_L);
      if (moved) line(fb, cx, cy, clamp(cx, x, x + w - 1), clamp(cy, y, y + 13), C.BLACK);
    }
    for (const { c, x, y, w } of placed) {
      const ours = !c.hostile;
      const ink = ours ? C.SKY_L : c.home ? C.RED : C.WHITE;
      fillRect(fb, x, y, w, 14, c.home ? C.BLACK : ours ? C.BLUE : C.RED);
      rectOutline(fb, x, y, w, 14, C.BLACK);
      drawText(fb, c.label, x + 2, y + 2, ink, 'tiny');
      drawText(fb, c.sub, x + 2, y + 8, ours ? C.WHITE : ink, 'tiny');
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
  // Title, and a key to the counters.
  fillRect(fb, MX0, MY0, 186, 8, C.BLACK);
  drawText(fb, '11 GROUP - OPS ROOM PLOT', MX0 + 2, MY0 + 1, C.CHALK, 'tiny');
  fillRect(fb, MX0 + 102, MY0 + 2, 4, 4, C.RED);
  drawText(fb, 'HOSTILE', MX0 + 108, MY0 + 1, C.CHALK, 'tiny');
  fillRect(fb, MX0 + 140, MY0 + 2, 4, 4, C.BLUE);
  drawText(fb, 'OURS', MX0 + 146, MY0 + 1, C.CHALK, 'tiny');
  drawText(fb, 'YOU', MX0 + 168, MY0 + 1, C.SIGHT, 'tiny');
  drawText(fb, 'TAP OR M TO CLOSE', 240, 246, C.CHALK, 'tiny');
}
