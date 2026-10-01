// The rest of the roster, each built to be identifiable by silhouette:
//   Hurricane — hump-backed, thick straight-tapered wing, canopy set high
//   Bf 110    — twin engines, slim fuselage, long glasshouse, twin fins
//   Do 17Z    — the "flying pencil": very slim fuselage, bulbous glazed nose, twin fins
//   He 111H   — big, broad elliptical-ish wing, fully glazed "bullet" nose, single fin
//   Ju 88A    — twin engines, bulged gondola, single fin, glazed "beetle eye" nose
//   Ju 87B    — inverted gull wing, fixed spatted undercarriage, long canopy

import { buildAircraftModel } from './kit';

export const hurricaneModel = buildAircraftModel({
  name: 'Hurricane Mk I',
  scheme: 'raf',
  sections: [
    { z: -5.2, w: 0.05, top: 0.55, bot: 0.25 },
    { z: -3.8, w: 0.3, top: 0.75, bot: -0.35 },
    { z: -1.6, w: 0.5, top: 1.0, bot: -0.85 },
    { z: -0.9, w: 0.52, top: 1.22, bot: -0.9, glass: true },
    { z: 0.2, w: 0.55, top: 1.3, bot: -0.95, glass: true },
    { z: 0.9, w: 0.56, top: 0.72, bot: -0.95 },
    { z: 2.2, w: 0.5, top: 0.6, bot: -0.85 },
    { z: 3.6, w: 0.4, top: 0.42, bot: -0.5 },
    { z: 3.8, w: 0.33, top: 0.33, bot: -0.33, paint: 'black' },
    { z: 4.3, w: 0.03, top: 0.03, bot: -0.03 },
  ],
  wing: { span: 6.1, rootChord: 2.6, tipChord: 1.2, rootLE: 1.6, sweep: 0.35, y: -0.65, dihedralDeg: 4, shape: 'rounded', split: 0.35, rootX: 0.56 },
  tail: { span: 1.7, rootChord: 1.1, tipChord: 0.55, rootLE: -4.2, sweep: 0.2, y: 0.4, dihedralDeg: 0, shape: 'rounded', split: 0.5, rootX: 0.2 },
  fins: [{ x: 0, rootLE: -3.95, rootChord: 1.4, tipChord: 0.7, height: 1.35, sweep: 0.5, y: 0.65 }],
  scoops: [{ min: [-0.35, -1.25, -0.6], max: [0.35, -0.9, 0.5] }],
  prop: { z: 3.85, r: 1.65, y: 0 },
  fuselageMarkZ: -2.6,
  markSpan: 0.7,
});

export const bf110Model = buildAircraftModel({
  name: 'Bf 110C',
  scheme: 'lw',
  sections: [
    { z: -6.2, w: 0.05, top: 0.5, bot: 0.15 },
    { z: -4.5, w: 0.3, top: 0.55, bot: -0.3 },
    { z: -1.5, w: 0.55, top: 0.75, bot: -0.7 },
    { z: -1.2, w: 0.55, top: 1.1, bot: -0.72, glass: true },
    { z: 2.5, w: 0.6, top: 1.15, bot: -0.75, glass: true },
    { z: 3.2, w: 0.58, top: 0.7, bot: -0.7 },
    { z: 5.3, w: 0.35, top: 0.35, bot: -0.45 },
    { z: 5.9, w: 0.08, top: 0.08, bot: -0.1 },
  ],
  wing: { span: 8.12, rootChord: 3.4, tipChord: 1.3, rootLE: 1.9, sweep: 0.6, y: -0.55, dihedralDeg: 6, shape: 'rounded', split: 0.45, rootX: 0.58 },
  tail: { span: 3.0, rootChord: 1.3, tipChord: 1.0, rootLE: -5.0, sweep: 0.1, y: 0.35, dihedralDeg: 0, shape: 'square', split: 0.5, rootX: 0.25 },
  fins: [
    { x: 2.9, rootLE: -5.0, rootChord: 1.3, tipChord: 1.0, height: 1.1, sweep: 0.15, y: -0.25 },
    { x: -2.9, rootLE: -5.0, rootChord: 1.3, tipChord: 1.0, height: 1.1, sweep: 0.15, y: -0.25 },
  ],
  nacelles: [
    { x: 2.6, y: -0.35, zFront: 3.4, zBack: -1.4, r: 0.6 },
    { x: -2.6, y: -0.35, zFront: 3.4, zBack: -1.4, r: 0.6 },
  ],
  fuselageMarkZ: -3.0,
  markSpan: 0.72,
});

export const do17Model = buildAircraftModel({
  name: 'Do 17Z',
  scheme: 'lwBomber',
  sections: [
    { z: -9.0, w: 0.05, top: 0.35, bot: 0.1 },
    { z: -6.0, w: 0.35, top: 0.45, bot: -0.35 },
    { z: 1.0, w: 0.55, top: 0.75, bot: -0.6 },
    { z: 2.6, w: 0.75, top: 1.05, bot: -1.05, glass: true },
    { z: 5.2, w: 0.85, top: 1.15, bot: -1.25, allGlass: true },
    { z: 6.4, w: 0.75, top: 0.85, bot: -1.0, allGlass: true },
    { z: 6.9, w: 0.3, top: 0.3, bot: -0.4 },
  ],
  wing: { span: 9.0, rootChord: 3.9, tipChord: 1.3, rootLE: 2.0, sweep: 1.0, y: 0.15, dihedralDeg: 5, shape: 'rounded', split: 0.38, rootX: 0.6 },
  tail: { span: 3.3, rootChord: 1.5, tipChord: 1.0, rootLE: -7.4, sweep: 0.3, y: 0.35, dihedralDeg: 0, shape: 'square', split: 0.5, rootX: 0.25 },
  fins: [
    { x: 3.2, rootLE: -7.4, rootChord: 1.5, tipChord: 1.0, height: 1.4, sweep: 0.3, y: -0.3 },
    { x: -3.2, rootLE: -7.4, rootChord: 1.5, tipChord: 1.0, height: 1.4, sweep: 0.3, y: -0.3 },
  ],
  nacelles: [
    { x: 2.9, y: 0.05, zFront: 3.9, zBack: -0.8, r: 0.72 },
    { x: -2.9, y: 0.05, zFront: 3.9, zBack: -0.8, r: 0.72 },
  ],
  fuselageMarkZ: -4.0,
  markSpan: 0.72,
});

export const he111Model = buildAircraftModel({
  name: 'He 111H',
  scheme: 'lwBomber',
  sections: [
    { z: -9.2, w: 0.05, top: 0.8, bot: 0.25 },
    { z: -7.0, w: 0.45, top: 1.0, bot: -0.3 },
    { z: -2.0, w: 0.9, top: 1.35, bot: -1.1 },
    { z: 2.5, w: 1.0, top: 1.25, bot: -1.25 },
    { z: 4.6, w: 0.95, top: 1.15, bot: -1.15, allGlass: true },
    { z: 6.4, w: 0.65, top: 0.75, bot: -0.85, allGlass: true },
    { z: 7.2, w: 0.08, top: 0.05, bot: -0.1 },
  ],
  wing: { span: 11.3, rootChord: 5.0, tipChord: 1.4, rootLE: 2.4, sweep: 1.2, y: -0.55, dihedralDeg: 4, shape: 'elliptical', split: 0.36, rootX: 0.95 },
  tail: { span: 4.2, rootChord: 2.0, tipChord: 1.0, rootLE: -7.5, sweep: 0.5, y: 0.6, dihedralDeg: 0, shape: 'rounded', split: 0.5, rootX: 0.35 },
  fins: [{ x: 0, rootLE: -7.0, rootChord: 2.6, tipChord: 1.2, height: 1.65, sweep: 0.8, y: 0.9 }],
  nacelles: [
    { x: 3.3, y: -0.4, zFront: 4.6, zBack: -1.4, r: 0.8 },
    { x: -3.3, y: -0.4, zFront: 4.6, zBack: -1.4, r: 0.8 },
  ],
  scoops: [{ min: [-0.45, -1.75, -1.5], max: [0.45, -1.15, 1.2] }],
  fuselageMarkZ: -4.5,
  markSpan: 0.7,
});

export const ju88Model = buildAircraftModel({
  name: 'Ju 88A',
  scheme: 'lwBomber',
  sections: [
    { z: -8.6, w: 0.05, top: 0.55, bot: 0.15 },
    { z: -6.0, w: 0.4, top: 0.7, bot: -0.45 },
    { z: -0.5, w: 0.75, top: 1.05, bot: -0.95 },
    { z: 2.6, w: 0.8, top: 1.25, bot: -1.45, glass: true },
    { z: 4.6, w: 0.82, top: 1.35, bot: -1.5, allGlass: true },
    { z: 5.6, w: 0.6, top: 0.8, bot: -0.95, allGlass: true },
    { z: 6.0, w: 0.1, top: 0.1, bot: -0.15 },
  ],
  wing: { span: 9.15, rootChord: 3.6, tipChord: 1.5, rootLE: 2.1, sweep: 0.8, y: -0.35, dihedralDeg: 5.5, shape: 'rounded', split: 0.4, rootX: 0.8 },
  tail: { span: 3.4, rootChord: 1.6, tipChord: 0.9, rootLE: -7.0, sweep: 0.35, y: 0.45, dihedralDeg: 0, shape: 'rounded', split: 0.5, rootX: 0.3 },
  fins: [{ x: 0, rootLE: -6.6, rootChord: 2.1, tipChord: 1.0, height: 2.0, sweep: 0.8, y: 0.75 }],
  nacelles: [
    { x: 2.9, y: -0.25, zFront: 4.2, zBack: -1.2, r: 0.82 },
    { x: -2.9, y: -0.25, zFront: 4.2, zBack: -1.2, r: 0.82 },
  ],
  scoops: [{ min: [-0.4, -1.9, 1.0], max: [0.4, -1.4, 3.6] }],
  fuselageMarkZ: -4.0,
  markSpan: 0.72,
});

export const ju87Model = buildAircraftModel({
  name: 'Ju 87B Stuka',
  scheme: 'lw',
  sections: [
    { z: -6.6, w: 0.05, top: 0.55, bot: 0.2 },
    { z: -4.8, w: 0.3, top: 0.6, bot: -0.35 },
    { z: -2.4, w: 0.5, top: 0.85, bot: -0.8, glass: true },
    { z: 1.0, w: 0.55, top: 1.05, bot: -0.85, glass: true },
    { z: 1.6, w: 0.56, top: 0.62, bot: -0.85 },
    { z: 3.8, w: 0.5, top: 0.5, bot: -0.95 },
    { z: 4.2, w: 0.34, top: 0.34, bot: -0.34, paint: 'black' },
    { z: 4.6, w: 0.04, top: 0.04, bot: -0.04 },
  ],
  wing: { span: 6.9, rootChord: 2.9, tipChord: 1.3, rootLE: 1.6, sweep: 0.25, y: -0.75, dihedralDeg: 10, innerDihedralDeg: -12, shape: 'rounded', split: 0.36, rootX: 0.55 },
  tail: { span: 2.4, rootChord: 1.2, tipChord: 0.8, rootLE: -5.4, sweep: 0.2, y: 0.4, dihedralDeg: 0, shape: 'square', split: 0.5, rootX: 0.2 },
  fins: [{ x: 0, rootLE: -5.1, rootChord: 1.5, tipChord: 0.9, height: 1.45, sweep: 0.35, y: 0.5 }],
  spats: [
    { x: 1.75, y: -1.15, z: 1.3, h: 1.5 },
    { x: -1.75, y: -1.15, z: 1.3, h: 1.5 },
  ],
  scoops: [{ min: [-0.4, -1.3, 2.4], max: [0.4, -0.85, 3.5] }],
  prop: { z: 4.25, r: 1.7, y: 0 },
  fuselageMarkZ: -3.2,
  markSpan: 0.72,
});
