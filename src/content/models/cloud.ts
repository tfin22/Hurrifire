// A unit cumulus blob: a domed, flat-bottomed cushion. Instances are scaled
// to each blob's size; the grey base and white tops give the shading.

import { ModelBuilder, withLods } from '../../render/model';

type P3 = [number, number, number];

function blob(n: number) {
  const b = new ModelBuilder();
  const ring = (y: number, r: number): P3[] => Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  });
  const r0 = ring(-0.85, 0.85), r1 = ring(0.0, 1.0), r2 = ring(0.65, 0.7);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const out = (k: number): P3 => [Math.cos(((k + 0.5) / n) * Math.PI * 2), 0, Math.sin(((k + 0.5) / n) * Math.PI * 2)];
    b.poly('cloud', [r0[i], r0[j], r1[j], r1[i]], [out(i)[0], -0.3, out(i)[2]]);
    b.poly('cloud', [r1[i], r1[j], r2[j], r2[i]], [out(i)[0], 0.5, out(i)[2]]);
  }
  b.poly('cloud', r2, [0, 1, 0]);
  b.poly('cloudBase', r0, [0, -1, 0]);
  return b.build('Cloud');
}

export const cloudModel = withLods(blob(8), blob(6), blob(4));
