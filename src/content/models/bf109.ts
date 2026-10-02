// Messerschmitt Bf 109E. Identified by the square-cut wingtips, the narrow,
// angular fuselage with its framed canopy and the braced tailplane.
// Luftwaffe markings: Balkenkreuz and unit code blocks only.

import { buildAircraftModel } from './kit';

export const bf109Model = buildAircraftModel({
  name: 'Bf 109E',
  scheme: 'lw',
  sections: [
    { z: -4.6, w: 0.04, top: 0.42, bot: 0.22 },
    { z: -3.4, w: 0.2, top: 0.46, bot: -0.16 },
    { z: -1.0, w: 0.36, top: 0.62, bot: -0.55 },
    { z: -0.55, w: 0.38, top: 0.88, bot: -0.58, glass: true },
    { z: 0.55, w: 0.41, top: 0.93, bot: -0.6, glass: true },
    { z: 1.05, w: 0.45, top: 0.52, bot: -0.62 },
    { z: 2.0, w: 0.44, top: 0.5, bot: -0.64 },
    { z: 3.35, w: 0.38, top: 0.36, bot: -0.48 },
    { z: 3.55, w: 0.3, top: 0.3, bot: -0.3, paint: 'black' },
    { z: 3.95, w: 0.03, top: 0.03, bot: -0.03 },
  ],
  wing: { span: 4.94, rootChord: 2.1, tipChord: 1.25, rootLE: 1.3, sweep: 0.28, y: -0.5, dihedralDeg: 6.5, shape: 'square', split: 0.42, rootX: 0.42 },
  tail: { span: 1.65, rootChord: 0.95, tipChord: 0.6, rootLE: -3.45, sweep: 0.15, y: 0.36, dihedralDeg: 0, shape: 'rounded', split: 0.5, rootX: 0.16 },
  fins: [{ x: 0, rootLE: -3.3, rootChord: 1.25, tipChord: 0.7, height: 1.2, sweep: 0.35, y: 0.38 }],
  scoops: [
    { min: [1.0, -0.8, -0.25], max: [1.6, -0.54, 0.55] },
    { min: [-1.6, -0.8, -0.25], max: [-1.0, -0.54, 0.55] },
    { min: [-0.2, -0.78, 2.2], max: [0.2, -0.6, 2.85] },
  ],
  prop: { z: 3.55, r: 1.5, y: 0 },
  fuselageMarkZ: -1.9,
  markSpan: 0.7,
});

/** Variant with the yellow cowling seen from August 1940. */
export const bf109YellowModel = buildAircraftModel({
  name: 'Bf 109E (yellow nose)',
  scheme: 'lw',
  sections: [
    { z: -4.6, w: 0.04, top: 0.42, bot: 0.22 },
    { z: -3.4, w: 0.2, top: 0.46, bot: -0.16 },
    { z: -1.0, w: 0.36, top: 0.62, bot: -0.55 },
    { z: -0.55, w: 0.38, top: 0.88, bot: -0.58, glass: true },
    { z: 0.55, w: 0.41, top: 0.93, bot: -0.6, glass: true },
    { z: 1.05, w: 0.45, top: 0.52, bot: -0.62 },
    { z: 2.0, w: 0.44, top: 0.5, bot: -0.64, paint: 'yellow' },
    { z: 3.35, w: 0.38, top: 0.36, bot: -0.48, paint: 'yellow' },
    { z: 3.55, w: 0.3, top: 0.3, bot: -0.3, paint: 'yellow' },
    { z: 3.95, w: 0.03, top: 0.03, bot: -0.03 },
  ],
  wing: { span: 4.94, rootChord: 2.1, tipChord: 1.25, rootLE: 1.3, sweep: 0.28, y: -0.5, dihedralDeg: 6.5, shape: 'square', split: 0.42, rootX: 0.42 },
  tail: { span: 1.65, rootChord: 0.95, tipChord: 0.6, rootLE: -3.45, sweep: 0.15, y: 0.36, dihedralDeg: 0, shape: 'rounded', split: 0.5, rootX: 0.16 },
  fins: [{ x: 0, rootLE: -3.3, rootChord: 1.25, tipChord: 0.7, height: 1.2, sweep: 0.35, y: 0.38 }],
  scoops: [
    { min: [1.0, -0.8, -0.25], max: [1.6, -0.54, 0.55] },
    { min: [-1.6, -0.8, -0.25], max: [-1.0, -0.54, 0.55] },
  ],
  prop: { z: 3.55, r: 1.5, y: 0 },
  fuselageMarkZ: -1.9,
  markSpan: 0.7,
});
