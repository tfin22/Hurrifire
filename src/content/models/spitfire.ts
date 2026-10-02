// Supermarine Spitfire Mk I. Identified by the slim nose, the elliptical wing
// and the bubble of the canopy behind a long cowling.

import { buildAircraftModel } from './kit';

export const spitfireModel = buildAircraftModel({
  name: 'Spitfire Mk I',
  scheme: 'raf',
  sections: [
    { z: -4.95, w: 0.04, top: 0.36, bot: 0.16 },
    { z: -3.6, w: 0.2, top: 0.42, bot: -0.25 },
    { z: -1.4, w: 0.36, top: 0.62, bot: -0.6, glass: false },
    { z: -0.7, w: 0.4, top: 0.9, bot: -0.66, glass: true },
    { z: 0.25, w: 0.43, top: 0.98, bot: -0.68, glass: true },
    { z: 0.95, w: 0.45, top: 0.52, bot: -0.66 },
    { z: 2.1, w: 0.42, top: 0.45, bot: -0.6 },
    { z: 3.55, w: 0.36, top: 0.36, bot: -0.4 },
    { z: 3.75, w: 0.3, top: 0.3, bot: -0.3, paint: 'rafSky' },
    { z: 4.2, w: 0.03, top: 0.03, bot: -0.03 },
  ],
  wing: { span: 5.62, rootChord: 2.55, tipChord: 0.32, rootLE: 1.55, sweep: 0, y: -0.45, dihedralDeg: 6, shape: 'elliptical', split: 0.42, rootX: 0.44 },
  tail: { span: 1.62, rootChord: 1.05, tipChord: 0.3, rootLE: -3.75, sweep: 0.1, y: 0.18, dihedralDeg: 0, shape: 'elliptical', split: 0.5, rootX: 0.18 },
  fins: [{ x: 0, rootLE: -3.65, rootChord: 1.35, tipChord: 0.55, height: 1.22, sweep: 0.55, y: 0.38 }],
  scoops: [
    { min: [0.95, -0.78, -0.1], max: [1.4, -0.5, 1.0] },
    { min: [-1.15, -0.64, 0.3], max: [-0.88, -0.5, 0.95] },
  ],
  prop: { z: 3.62, r: 1.6, y: 0 },
  fuselageMarkZ: -2.3,
  markSpan: 0.66,
});
