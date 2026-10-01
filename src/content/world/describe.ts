// Turning a map position into words for the R/T, the debrief and the
// logbook: "near Ashford", "off Dover", "mid-Channel", "approaching
// Dungeness".

import { Vec3 } from '../../core/math';
import { CL, lonLatToXZ, PLACES, WorldMap, xzToLatLon } from './map';

interface Named { name: string; x: number; z: number; r: number; france: boolean }

const TOWNS: Named[] = PLACES.towns
  .filter((t) => !t.name.includes('suburbs'))
  .map((t) => {
    const [x, z] = lonLatToXZ(t.lat, t.lon);
    return { name: t.name, x, z, r: t.r * 1000, france: !!(t as { france?: boolean }).france };
  });

const POINTS: Named[] = [
  ['Dungeness', 50.913, 0.976], ['Beachy Head', 50.734, 0.241], ['the North Foreland', 51.375, 1.447],
  ['the South Foreland', 51.14, 1.371], ['Cap Gris Nez', 50.871, 1.583], ['Cap Blanc-Nez', 50.93, 1.71],
  ['Selsey Bill', 50.725, -0.79], ['the Isle of Sheppey', 51.4, 0.83], ['the Thames estuary', 51.5, 0.9],
  ['Romney Marsh', 51.02, 0.88], ['the Isle of Thanet', 51.36, 1.35],
].map(([name, lat, lon]) => {
  const [x, z] = lonLatToXZ(lat as number, lon as number);
  return { name: name as string, x, z, r: 3000, france: (lon as number) > 1.45 };
});

export function isFrance(x: number, z: number): boolean {
  const [lat, lon] = xzToLatLon(x, z);
  return lon > 1.45 && lat < 51.12;
}

function nearest(list: Named[], x: number, z: number): { n: Named; d: number } {
  let best = list[0], bd = Infinity;
  for (const n of list) {
    const d = Math.hypot(n.x - x, n.z - z);
    if (d < bd) { bd = d; best = n; }
  }
  return { n: best, d: bd };
}

/** "near Ashford", "over Maidstone", "off Dover", "mid-Channel", "over France". */
export function describePlace(map: WorldMap, x: number, z: number): string {
  const c = map.classAt(x, z);
  const town = nearest(TOWNS, x, z);
  const point = nearest(POINTS, x, z);
  if (c === CL.SEA) {
    const coastal = town.d < point.d ? town : point;
    if (coastal.d < 12000) return `off ${coastal.n.name}`;
    const [, lon] = xzToLatLon(x, z);
    const [lat] = xzToLatLon(x, z);
    if (lat < 51.15 && lon > 0.3) return 'mid-Channel';
    if (lat > 51.3) return 'over the estuary';
    return 'over the Channel';
  }
  if (point.d < 3500 && point.d < town.d) return `over ${point.n.name}`;
  if (town.d < town.n.r * 1.2) return `over ${town.n.name}`;
  if (town.d < 12000) return `near ${town.n.name}`;
  if (isFrance(x, z)) return 'over France';
  return `near ${town.n.name}`;
}

/** Just the name, for "Landed back at X" and logbook places. */
export function placeName(map: WorldMap, x: number, z: number): string {
  const af = map.airfieldAt(x, z);
  if (af) return af.name;
  const town = nearest(TOWNS, x, z);
  return town.n.name;
}

/** For the controller: where a raid is and where it's heading. */
export function describeRaid(map: WorldMap, p: Vec3, vel?: Vec3): string {
  const here = describePlace(map, p.x, p.z);
  if (vel && vel.lenSq() > 1) {
    // Something it is approaching within the next few minutes.
    const ahead = p.clone().addScaled(vel, 240);
    const pt = nearest([...POINTS, ...TOWNS.filter((t) => t.r > 1500)], ahead.x, ahead.z);
    if (pt.d < 9000 && pt.n.name !== here.replace(/^(over|near|off) /, '')) return `approaching ${pt.n.name}`;
  }
  return here;
}

/** Distance (m) from a sea point to the English coast, for rescue chances. */
export function distanceToEnglishCoast(map: WorldMap, x: number, z: number): number {
  for (let r = 500; r <= 40000; r += 1000) {
    for (let a = 0; a < 16; a++) {
      const px = x + Math.cos((a / 16) * Math.PI * 2) * r, pz = z + Math.sin((a / 16) * Math.PI * 2) * r;
      if (map.classAt(px, pz) !== CL.SEA && !isFrance(px, pz)) return r;
    }
  }
  return 40000;
}
