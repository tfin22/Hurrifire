// Scene layer for the real map: ground objects, Chain Home masts, barrage
// balloons and their cables, ships, and the cumulus.

import { Quat, Vec3 } from '../core/math';
import { cloudModel } from '../content/models/cloud';
import { MODELS } from '../content/models/ground';
import { GroundObject, WorldObjects } from '../content/world/objects';
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

export interface Ship {
  pos: Vec3;
  heading: number;
  kind: 'freighter' | 'coaster' | 'launch';
  sunk?: boolean;
}

export function makeWorldLayer(objs: WorldObjects, world: World, ships: () => Ship[]) {
  const near: GroundObject[] = [];
  const blobs: CloudBlob[] = [];
  const top = new Vec3();
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
