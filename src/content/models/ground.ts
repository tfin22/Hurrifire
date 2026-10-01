// Landmark and ground-object models. Low-poly, built to read at a few
// pixels: the oast house's cone and white cowl, Tower Bridge's twin towers,
// Battersea's two chimneys (only the first pair stood in 1940), St Paul's
// dome, lighthouses, hangars and huts, barrage balloons, ships.

import { Model, ModelBuilder, withLods } from '../../render/model';
import type { MaterialName } from '../../render/palette';

type P3 = [number, number, number];

/** n-sided prism (vertical axis) from y0 to y1, radius r at (cx, cz). */
function prism(b: ModelBuilder, mat: MaterialName, cx: number, cz: number, r: number, y0: number, y1: number, n: number, top: MaterialName | null = mat, rTop = r): void {
  const ring = (y: number, rr: number) => Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr] as P3;
  });
  const lo = ring(y0, r), hi = ring(y1, rTop);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const mid: P3 = [Math.cos(((i + 0.5) / n) * Math.PI * 2), 0, Math.sin(((i + 0.5) / n) * Math.PI * 2)];
    b.poly(mat, [lo[i], lo[j], hi[j], hi[i]], mid);
  }
  if (top && rTop > 0.01) b.poly(top, hi, [0, 1, 0]);
}

/** Cone from a ring at y0 to an apex. */
function cone(b: ModelBuilder, mat: MaterialName, cx: number, cz: number, r: number, y0: number, apex: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const mid: P3 = [Math.cos((a0 + a1) / 2), 0.6, Math.sin((a0 + a1) / 2)];
    b.poly(mat, [[cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r], [cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r], [cx, apex, cz]], mid);
  }
}

/** Box with a pitched roof along z. */
function house(b: ModelBuilder, wall: MaterialName, roof: MaterialName, x0: number, z0: number, x1: number, z1: number, h: number, ridge: number): void {
  b.box((n) => (n[1] < -0.5 ? wall : wall), [x0, 0, z0], [x1, h, z1]);
  const xm = (x0 + x1) / 2;
  b.poly(roof, [[x0, h, z0], [xm, h + ridge, z0], [xm, h + ridge, z1], [x0, h, z1]], [-1, 1, 0]);
  b.poly(roof, [[x1, h, z0], [xm, h + ridge, z0], [xm, h + ridge, z1], [x1, h, z1]], [1, 1, 0]);
  b.poly(wall, [[x0, h, z0], [x1, h, z0], [xm, h + ridge, z0]], [0, 0, -1]);
  b.poly(wall, [[x0, h, z1], [x1, h, z1], [xm, h + ridge, z1]], [0, 0, 1]);
}

function oast(): Model {
  const b = new ModelBuilder();
  prism(b, 'roof', 0, 0, 4, 0, 7, 8, null);
  cone(b, 'roof', 0, 0, 4.4, 7, 15, 8);
  b.box('white', [-0.8, 15, -0.8], [0.8, 17, 0.8]);
  house(b, 'white', 'roof', -5, 4, 5, 22, 6, 3);
  const lo = new ModelBuilder();
  prism(lo, 'roof', 0, 0, 4, 0, 7, 4, null);
  cone(lo, 'roof', 0, 0, 4.4, 7, 15, 4);
  lo.box('white', [-4, 0, 4], [4, 7, 22]);
  return withLods(b.build('Oast house'), lo.build('Oast (low)'));
}

function hangar(): Model {
  const b = new ModelBuilder();
  // Camouflaged hangar with a shallow curved roof (three facets).
  b.box('rafEarth', [-20, 0, -15], [20, 9, 15]);
  b.poly('rafGreen', [[-20, 9, -15], [-12, 13, -15], [-12, 13, 15], [-20, 9, 15]], [-1, 1, 0]);
  b.poly('rafEarth', [[-12, 13, -15], [12, 13, -15], [12, 13, 15], [-12, 13, 15]], [0, 1, 0]);
  b.poly('rafGreen', [[20, 9, -15], [12, 13, -15], [12, 13, 15], [20, 9, 15]], [1, 1, 0]);
  b.poly('rafEarth', [[-20, 9, -15], [-12, 13, -15], [12, 13, -15], [20, 9, -15]], [0, 0, -1]);
  b.poly('black', [[-17, 0, 15.1], [17, 0, 15.1], [17, 8, 15.1], [-17, 8, 15.1]], [0, 0, 1]);
  b.poly('rafEarth', [[-20, 9, 15], [-12, 13, 15], [12, 13, 15], [20, 9, 15]], [0, 0, 1]);
  return b.build('Hangar');
}

function wreckedHangar(): Model {
  const b = new ModelBuilder();
  b.box('smoke', [-20, 0, -15], [-8, 7, 15]);
  b.box('black', [-8, 0, -15], [20, 3, 15]);
  b.poly('smoke', [[8, 3, -15], [20, 9, -10], [20, 9, 10], [8, 3, 15]], [0.5, 1, 0]);
  return b.build('Wrecked hangar');
}

function hut(): Model {
  const b = new ModelBuilder();
  house(b, 'rafEarth', 'black', -3, -6, 3, 6, 3, 1.5);
  return b.build('Hut');
}

function windsock(): Model {
  const b = new ModelBuilder();
  b.box('white', [-0.15, 0, -0.15], [0.15, 7, 0.15]);
  // The sock points along +z (downwind), drooping a little.
  const ring = (z: number, r: number, y: number) => [[-r, y, z], [0, y + r, z], [r, y, z], [0, y - r, z]] as P3[];
  const a = ring(0, 0.6, 6.6), c = ring(3, 0.25, 6.1);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    b.poly(i % 2 ? 'white' : 'red', [a[i], a[j], c[j], c[i]], [a[i][0] + a[j][0], a[i][1] + a[j][1] - 13.2, 0]);
  }
  return b.build('Windsock');
}

function towerBridge(): Model {
  const b = new ModelBuilder();
  for (const z of [-40, 40]) {
    b.box('chalk', [-7, 0, z - 7], [7, 45, z + 7]);
    cone(b, 'town', 0, z, 7.5, 45, 58, 4);
    for (const [dx, dz] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) cone(b, 'town', dx, z + dz, 1.5, 45, 52, 4);
  }
  // Road deck and high walkways.
  b.box('town', [-6, 9, -33], [6, 11, 33]);
  b.box('blue', [-3, 38, -33], [3, 41, 33]);
  // Approach spans and suspension chains.
  b.poly('town', [[0, 30, -47], [0, 10, -110], [0, 12, -110], [0, 33, -47]], [1, 0, 0]);
  b.poly('town', [[0, 30, 47], [0, 10, 110], [0, 12, 110], [0, 33, 47]], [1, 0, 0]);
  b.poly('town', [[0, 30, -47], [0, 10, -110], [0, 12, -110], [0, 33, -47]], [-1, 0, 0]);
  b.poly('town', [[0, 30, 47], [0, 10, 110], [0, 12, 110], [0, 33, 47]], [-1, 0, 0]);
  return b.build('Tower Bridge');
}

function battersea(): Model {
  const b = new ModelBuilder();
  b.box('roof', [-50, 0, -25], [50, 32, 25]);
  b.box('roof', [-50, 32, -10], [-30, 45, 10]);
  for (const x of [-42, 42]) prism(b, 'white', x, 0, 3.5, 32, 100, 6, 'black', 3);
  return b.build('Battersea Power Station');
}

function stPauls(): Model {
  const b = new ModelBuilder();
  b.box('chalk', [-15, 0, -70], [15, 28, 70]);
  b.box('chalk', [-40, 0, -12], [40, 26, 12]);
  prism(b, 'chalk', 0, 0, 16, 28, 48, 8, null);
  prism(b, 'town', 0, 0, 15, 48, 62, 8, null, 10);
  prism(b, 'town', 0, 0, 10, 62, 70, 8, null, 4);
  prism(b, 'chalk', 0, 0, 2.5, 70, 85, 4, 'white');
  cone(b, 'white', 0, 0, 2, 85, 92, 4);
  for (const z of [-62, -52]) prism(b, 'chalk', z === -62 ? -12 : 12, -66, 4, 28, 60, 4, null);
  return b.build("St Paul's");
}

function lighthouse(): Model {
  const b = new ModelBuilder();
  prism(b, 'white', 0, 0, 4, 0, 30, 6, null, 2.8);
  prism(b, 'red', 0, 0, 3, 30, 36, 6, null, 3);
  cone(b, 'black', 0, 0, 3.3, 36, 40, 6);
  b.box('white', [3, 0, -4], [12, 5, 4]);
  return b.build('Lighthouse');
}

function castle(): Model {
  const b = new ModelBuilder();
  b.box('chalk', [-15, 0, -15], [15, 28, 15]);
  for (const [x, z] of [[-15, -15], [15, -15], [-15, 15], [15, 15]]) b.box('chalk', [x - 3, 0, z - 3], [x + 3, 32, z + 3]);
  b.box('chalk', [-60, 0, -60], [60, 8, -55]);
  b.box('chalk', [-60, 0, 55], [60, 8, 60]);
  b.box('chalk', [-60, 0, -60], [-55, 8, 60]);
  b.box('chalk', [55, 0, -60], [60, 8, 60]);
  return b.build('Castle');
}

function cathedral(): Model {
  const b = new ModelBuilder();
  b.box('chalk', [-10, 0, -80], [10, 25, 80]);
  b.box('chalk', [-30, 0, 10], [30, 22, 26]);
  b.box('chalk', [-8, 25, 5], [8, 72, 21]);
  for (const [x, z] of [[-8, 5], [8, 5], [-8, 21], [8, 21]]) cone(b, 'chalk', x, z, 1.5, 72, 78, 4);
  b.box('chalk', [-12, 0, -80], [-4, 50, -72]);
  b.box('chalk', [4, 0, -80], [12, 50, -72]);
  return b.build('Cathedral');
}

function warehouses(): Model {
  const b = new ModelBuilder();
  for (let i = 0; i < 4; i++) house(b, 'roof', 'town', -60 + i * 32, -50, -60 + i * 32 + 26, 50, 14, 5);
  b.box('black', [-80, 0, 60], [80, 2, 120]);
  return b.build('Docks');
}

function chainHomeHuts(): Model {
  const b = new ModelBuilder();
  house(b, 'white', 'black', -10, -5, 10, 5, 4, 2);
  house(b, 'white', 'black', 20, -5, 30, 5, 4, 2);
  return b.build('Chain Home');
}

function balloon(detail: number): Model {
  const b = new ModelBuilder();
  const n = detail === 0 ? 8 : 4;
  const secs = detail === 0
    ? [[-9, 0.4], [-6, 3.2], [-1, 4.4], [4, 4.0], [8, 2.6], [10, 0.4]]
    : [[-9, 0.6], [-1, 4.4], [10, 0.6]];
  const rings = secs.map(([z, r]) => ({ z, pts: Array.from({ length: n }, (_, i) => [Math.cos((i / n) * Math.PI * 2) * r, Math.sin((i / n) * Math.PI * 2) * r] as [number, number]) }));
  b.loft(rings, (_nx, ny) => (ny > 0.3 ? 'balloon' : 'balloon'), 'balloon', 'balloon');
  // Three inflated fins at the tail.
  b.plate('balloon', 'balloon', [[0, 3, -6], [0, 6.5, -11], [0, 3.5, -12]], [1, 0, 0]);
  b.plate('balloon', 'balloon', [[2.6, -1.5, -6], [5.6, -3.3, -11], [3.2, -2, -12]], [-0.5, 0.86, 0]);
  b.plate('balloon', 'balloon', [[-2.6, -1.5, -6], [-5.6, -3.3, -11], [-3.2, -2, -12]], [0.5, 0.86, 0]);
  return b.build('Barrage balloon');
}

function ship(len: number, name: string): Model {
  const b = new ModelBuilder();
  const w = len * 0.13;
  // Hull: a pointed prism.
  const deck = 4, keel = -2;
  const hull: P3[] = [[0, deck, len / 2], [w / 2, deck, len * 0.3], [w / 2, deck, -len / 2], [-w / 2, deck, -len / 2], [-w / 2, deck, len * 0.3]];
  b.poly('black', hull, [0, 1, 0]);
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], c = hull[(i + 1) % hull.length];
    b.poly('smoke', [a, c, [c[0] * 0.8, keel, c[2] * 0.95], [a[0] * 0.8, keel, a[2] * 0.95]], [(a[0] + c[0]) / 2, 0, (a[2] + c[2]) / 2]);
  }
  b.box('town', [-w * 0.35, deck, -len * 0.25], [w * 0.35, deck + 6, -len * 0.05]);
  b.box('black', [-w * 0.12, deck + 6, -len * 0.18], [w * 0.12, deck + 12, -len * 0.12]);
  return b.build(name);
}

function flag(): Model {
  const b = new ModelBuilder();
  b.box('white', [-0.08, 0, -0.08], [0.08, 2.2, 0.08]);
  b.plate('red', 'red', [[0, 2.2, 0], [0, 1.6, 0], [0, 1.9, 0.9]], [1, 0, 0]);
  return b.build('Crater flag');
}

export const MODELS = {
  flag: flag(),
  oast: oast(),
  hangar: hangar(),
  wreckedHangar: wreckedHangar(),
  hut: hut(),
  windsock: windsock(),
  towerBridge: towerBridge(),
  battersea: battersea(),
  stPauls: stPauls(),
  lighthouse: lighthouse(),
  castle: castle(),
  cathedral: cathedral(),
  docks: warehouses(),
  chainHome: chainHomeHuts(),
  balloon: withLods(balloon(0), balloon(1)),
  freighter: ship(90, 'Freighter'),
  coaster: ship(55, 'Coaster'),
  launch: ship(20, 'Rescue launch'),
};
