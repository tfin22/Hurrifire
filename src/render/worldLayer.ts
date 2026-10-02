// Scene layer for the real map: ground objects, Chain Home masts, barrage
// balloons and their cables, ships, and the cumulus.

import { Quat, Vec3 } from '../core/math';
import { cloudModel } from '../content/models/cloud';
import { MODELS } from '../content/models/ground';
import { GroundObject, WorldObjects } from '../content/world/objects';
import type { Airfield } from '../content/world/map';
import { Model, ModelBuilder } from './model';
import { World } from '../sim/world';
import { Camera } from './camera';
import { C } from './palette';
import { Renderer3D } from './renderer3d';
import { TUNING } from '../tuning';
import type { CloudBlob } from '../sim/clouds';

const ID = new Quat();
const RANGE: Partial<Record<GroundObject['kind'], number>> = {
  oast: 7000, hut: 3500, windsock: 2500, hangar: 9000, wreckedHangar: 9000,
};

/**
 * An airfield as seen from the air: the grass square, a pale worn landing run
 * along the main direction, and the perimeter track. Drawn as a ground
 * marking at every range (the terrain's own detail only shows down low).
 */
export function airfieldMarking(a: Airfield): Model {
  const b = new ModelBuilder();
  const h = a.half, up: [number, number, number] = [0, 1, 0];
  const y = 0.3;
  const sq = b.poly('airfield', [[-h, y, -h], [h, y, -h], [h, y, h], [-h, y, h]], up);
  const w = 36;
  for (const [x0, z0, x1, z1] of [[-h, -h, h, -h + w], [-h, h - w, h, h], [-h, -h, -h + w, h], [h - w, -h, h, h]]) {
    b.poly('concrete', [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], up, sq);
  }
  const d = (a.dir * Math.PI) / 180;
  const fx = Math.sin(d), fz = Math.cos(d), rx = Math.cos(d), rz = -Math.sin(d);
  // Keep the run inside the square whatever its direction.
  const half = Math.min(a.len / 2, (h - w) / (Math.abs(fx) + Math.abs(fz)) - 10);
  const sw = 45;
  b.poly('mown', [
    [-fx * half - rx * sw, y, -fz * half - rz * sw], [-fx * half + rx * sw, y, -fz * half + rz * sw],
    [fx * half + rx * sw, y, fz * half + rz * sw], [fx * half - rx * sw, y, fz * half - rz * sw],
  ], up, sq);
  for (const c of a.craters) {
    const x = c.x - a.pos.x, z = c.z - a.pos.z, k = c.r;
    b.poly('plough', [[x - k, y, z - k * 0.4], [x - k * 0.4, y, z - k], [x + k * 0.4, y, z - k], [x + k, y, z - k * 0.4], [x + k, y, z + k * 0.4], [x + k * 0.4, y, z + k], [x - k * 0.4, y, z + k], [x - k, y, z + k * 0.4]], up, sq);
  }
  return b.build(`Airfield ${a.name}`);
}

export interface Ship {
  pos: Vec3;
  heading: number;
  kind: 'freighter' | 'coaster' | 'launch';
  sunk?: boolean;
}

/** The docks burning (from 7 September): a column of smoke kilometres high, leaning downwind. */
export interface Plume { pos: Vec3; height: number }

export function makeWorldLayer(objs: WorldObjects, world: World, ships: () => Ship[], plumes: Plume[] = []) {
  const near: GroundObject[] = [];
  const blobs: CloudBlob[] = [];
  const top = new Vec3();
  const markings = new Map<Airfield, { m: Model; craters: number }>();
  return (r: Renderer3D, cam: Camera, opts: { lowDetail?: boolean }) => {
    const cx = cam.pos.x, cz = cam.pos.z;
    // Ground objects.
    objs.near(cx, cz, opts.lowDetail ? 8000 : 26000, near);
    for (const o of near) {
      const range = RANGE[o.kind] ?? 26000;
      const d = Math.hypot(o.pos.x - cx, o.pos.z - cz);
      if (d > range) continue;
      let q = o.q;
      if (o.kind === 'windsock') {
        // Points downwind.
        const w = world.weather.wind;
        q = Quat.fromEuler(Math.atan2(w.x, w.z), 0, 0);
      }
      r.addModel(MODELS[o.kind], o.pos, q, { visRange: range });
    }
    // Airfields, plain from a long way off.
    for (const a of objs.map.airfields) {
      if (Math.hypot(a.pos.x - cx, a.pos.z - cz) > 40000) continue;
      let m = markings.get(a);
      // Rebuilt when the bombs make new craters.
      if (!m || m.craters !== a.craters.length) markings.set(a, (m = { m: airfieldMarking(a), craters: a.craters.length }));
      r.addModel(m.m, a.pos, ID, { ground: true, noCollapse: true });
    }
    // Bomb craters on airfields are marked with small flags.
    for (const a of objs.map.airfields) {
      if (!a.craters.length || Math.hypot(a.pos.x - cx, a.pos.z - cz) > 4000) continue;
      for (const c of a.craters) {
        const fpos = new Vec3(c.x + c.r + 2, objs.map.heightAt(c.x, c.z), c.z);
        r.addModel(MODELS.flag, fpos, ID, { visRange: 2500 });
      }
    }
    // Masts: thin lines that stay visible a long way off.
    for (const m of objs.masts) {
      const d = Math.hypot(m.base.x - cx, m.base.z - cz);
      if (d > 30000) continue;
      top.copy(m.base);
      top.y += m.height;
      r.addLine(m.base, top, d < 3000 ? C.SMOKE : C.GREY_D);
    }
    // Barrage balloons and cables.
    for (const b of world.balloons) {
      if (b.down) continue;
      const d = Math.hypot(b.pos.x - cx, b.pos.z - cz);
      if (d > 20000) continue;
      r.addModel(MODELS.balloon, b.pos, ID, { speckColour: C.GREY_L, visRange: 15000 });
      if (d < 4000) r.addLine(b.ground, b.pos, C.GREY_D);
    }
    for (const s of ships()) {
      if (s.sunk) continue;
      const d = Math.hypot(s.pos.x - cx, s.pos.z - cz);
      if (d > 20000) continue;
      r.addModel(MODELS[s.kind], s.pos, Quat.fromEuler(s.heading, 0, 0), { visRange: 18000 });
    }
    // Smoke plumes: dark puffs climbing and spreading, fire at the foot.
    for (const pl of plumes) {
      const d = Math.hypot(pl.pos.x - cx, pl.pos.z - cz);
      if (d > 70000) continue;
      const w = world.weather.wind;
      const n = d > 25000 ? 10 : 24;
      for (let i = 0; i < n; i++) {
        const k = i / (n - 1);
        const h = pl.height * k;
        const churn = Math.sin(world.time * 0.2 + i * 1.7) * 60 * k;
        top.set(pl.pos.x + w.x * h * 0.09 + churn, pl.pos.y + h, pl.pos.z + w.z * h * 0.09 - churn * 0.5);
        const rad = 220 + 900 * k * k;
        r.addPuff(top, rad, i === 0 && d < 30000 ? C.FIRE_R : k < 0.5 ? C.SMOKE : C.GREY_D, k > 0.85);
      }
    }
    // Clouds.
    const cf = world.cloudField;
    if (cf) {
      const R = opts.lowDetail ? 9000 : TUNING.render.cloudDrawRange;
      cf.blobsIn(cx - R, cz - R, cx + R, cz + R, blobs);
      for (const b of blobs) {
        const dx = b.pos.x - cx, dz = b.pos.z - cz;
        if (dx * dx + dz * dz > R * R) continue;
        r.addModel(cloudModel, b.pos, ID, { scale: [b.rx, b.ry, b.rz], noCollapse: true });
      }
    }
  };
}
