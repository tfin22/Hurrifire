// Generates src/content/world/terrainData.ts from public-domain data:
//   - Natural Earth 10m land polygons (coastline) and river centrelines
//   - SRTM 1-arc-second elevation (AWS "skadi" tiles)
// plus the hand-authored layer in src/content/world/places.json (towns,
// airfields, regions, extra rivers).
//
// Downloads are cached in .cache/ (not committed). The output is committed,
// so `npm run build` never needs the network. Run with `npm run world`.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const CACHE = '.cache';
const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const SKADI = 'https://s3.amazonaws.com/elevation-tiles-prod/skadi';

const places = JSON.parse(readFileSync('src/content/world/places.json', 'utf8'));
const P = places.projection;
const E = places.extent;

// Surface classes (keep in sync with src/content/world/map.ts).
const CL = {
  SEA: 0, FIELDS: 1, WOOD: 2, DOWNS: 3, MARSH: 4, TOWN: 5, CITY: 6, RIVER: 7, MUD: 8,
  BEACH: 9, ORCHARD: 10, HOPS: 11, FRANCE: 12, AIRFIELD: 13, CLIFF: 14, SUBURB: 15,
};

const toX = (lon) => (lon - P.lon0) * P.mPerDegLon;
const toZ = (lat) => (lat - P.lat0) * P.mPerDegLat;
const toLon = (x) => P.lon0 + x / P.mPerDegLon;
const toLat = (z) => P.lat0 + z / P.mPerDegLat;

async function fetchCached(url, file) {
  const path = `${CACHE}/${file}`;
  if (existsSync(path)) return readFileSync(path);
  console.log('downloading', url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(path, buf);
  return buf;
}

function hash3(a, b, c = 0) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  const nx = Math.round((E.x1 - E.x0) / E.cell);
  const nz = Math.round((E.z1 - E.z0) / E.cell);
  const cls = new Uint8Array(nx * nz);
  const cx = (i) => E.x0 + (i + 0.5) * E.cell;
  const cz = (j) => E.z0 + (j + 0.5) * E.cell;
  const bbox = [toLon(E.x0) - 0.1, toLat(E.z0) - 0.1, toLon(E.x1) + 0.1, toLat(E.z1) + 0.1];

  // ---- Land from Natural Earth polygons.
  const rings = [];
  for (const name of ['ne_10m_land', 'ne_10m_minor_islands']) {
    const g = JSON.parse(await fetchCached(`${NE}/${name}.geojson`, `${name}.geojson`));
    for (const f of g.features) {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const poly of polys) {
        poly.forEach((ring, k) => {
          let hit = false;
          for (const [lon, lat] of ring) if (lon > bbox[0] && lon < bbox[2] && lat > bbox[1] && lat < bbox[3]) { hit = true; break; }
          if (hit) rings.push({ hole: k > 0, pts: ring.map(([lon, lat]) => [toX(lon), toZ(lat)]) });
        });
      }
    }
  }
  console.log('coast rings', rings.length);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = cx(i), z = cz(j);
      let land = false;
      for (const r of rings) if (pointInPoly(x, z, r.pts)) land = r.hole ? false : true;
      cls[j * nx + i] = land ? CL.FIELDS : CL.SEA;
    }
  }

  // ---- Heights from SRTM: box-averaged onto a 1 km corner grid.
  const hnx = Math.round((E.x1 - E.x0) / E.heightCell) + 1;
  const hnz = Math.round((E.z1 - E.z0) / E.heightCell) + 1;
  const tiles = new Map();
  for (let lat = Math.floor(bbox[1]); lat <= Math.floor(bbox[3]); lat++) {
    for (let lon = Math.floor(bbox[0]); lon <= Math.floor(bbox[2]); lon++) {
      const ns = lat >= 0 ? 'N' : 'S', ew = lon >= 0 ? 'E' : 'W';
      const name = `${ns}${String(Math.abs(lat)).padStart(2, '0')}${ew}${String(Math.abs(lon)).padStart(3, '0')}`;
      try {
        const gz = await fetchCached(`${SKADI}/${name.slice(0, 3)}/${name}.hgt.gz`, `${name}.hgt.gz`);
        const raw = gunzipSync(gz);
        const n = Math.round(Math.sqrt(raw.length / 2));
        tiles.set(`${lat},${lon}`, { n, data: raw });
      } catch (e) {
        console.warn('no SRTM tile', name, e.message);
      }
    }
  }
  const srtm = (lat, lon) => {
    const t = tiles.get(`${Math.floor(lat)},${Math.floor(lon)}`);
    if (!t) return 0;
    const fy = (Math.floor(lat) + 1 - lat) * (t.n - 1);
    const fx = (lon - Math.floor(lon)) * (t.n - 1);
    const r = Math.min(t.n - 1, Math.max(0, Math.round(fy))), c = Math.min(t.n - 1, Math.max(0, Math.round(fx)));
    const v = t.data.readInt16BE((r * t.n + c) * 2);
    return v < -1000 ? 0 : Math.max(0, v);
  };
  const heights = new Uint8Array(hnx * hnz);
  const S = 7; // samples per axis in each box
  for (let j = 0; j < hnz; j++) {
    for (let i = 0; i < hnx; i++) {
      const x = E.x0 + i * E.heightCell, z = E.z0 + j * E.heightCell;
      let sum = 0;
      for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) {
        const sx = x + ((a + 0.5) / S - 0.5) * E.heightCell;
        const sz = z + ((b + 0.5) / S - 0.5) * E.heightCell;
        sum += srtm(toLat(sz), toLon(sx));
      }
      heights[j * hnx + i] = Math.min(255, Math.round(sum / (S * S) / 2));
    }
  }

  const cellOf = (x, z) => {
    const i = Math.floor((x - E.x0) / E.cell), j = Math.floor((z - E.z0) / E.cell);
    return i >= 0 && j >= 0 && i < nx && j < nz ? j * nx + i : -1;
  };
  const hAt = (x, z) => {
    const fx = (x - E.x0) / E.heightCell, fz = (z - E.z0) / E.heightCell;
    const i = Math.max(0, Math.min(hnx - 2, Math.floor(fx))), j = Math.max(0, Math.min(hnz - 2, Math.floor(fz)));
    const tx = fx - i, tz = fz - j;
    const h = (a, b) => heights[b * hnx + a] * 2;
    return (h(i, j) * (1 - tx) + h(i + 1, j) * tx) * (1 - tz) + (h(i, j + 1) * (1 - tx) + h(i + 1, j + 1) * tx) * tz;
  };
  const isSeaCell = (k) => cls[k] === CL.SEA;
  const neighbourSea = (i, j) => {
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj;
      if (a >= 0 && b >= 0 && a < nx && b < nz && isSeaCell(b * nx + a)) return true;
    }
    return false;
  };

  // ---- Regions (hand-authored).
  const inRegion = (reg, lat, lon) => {
    if (reg.poly) return pointInPoly(lon, lat, reg.poly.map(([la, lo]) => [lo, la]));
    if (reg.circle) {
      const [la, lo, rkm] = reg.circle;
      return Math.hypot(toX(lon) - toX(lo), toZ(lat) - toZ(la)) < rkm * 1000;
    }
    if (reg.box) return lat >= reg.box[0] && lat <= reg.box[2] && lon >= reg.box[1] && lon <= reg.box[3];
    return false;
  };
  const coastal = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    if (cls[k] !== CL.SEA && neighbourSea(i, j)) coastal[k] = 1;
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = cx(i), z = cz(j), lat = toLat(z), lon = toLon(x);
      if (cls[k] === CL.SEA) {
        // Intertidal mud in the estuary.
        const mud = places.regions.find((r) => r.kind === 'mud' && inRegion(r, lat, lon));
        if (mud) {
          let landN = 0;
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
            const a = i + di, b = j + dj;
            if (a >= 0 && b >= 0 && a < nx && b < nz && cls[b * nx + a] !== CL.SEA && cls[b * nx + a] !== CL.MUD) landN++;
          }
          if (landN >= 2 && hash3(i, j, 31) < 0.75) cls[k] = CL.MUD;
        }
        continue;
      }
      let c = CL.FIELDS;
      if (lon > 1.45 && lat < 51.12) c = CL.FRANCE;
      for (const r of places.regions) {
        if (r.kind === 'mud' || !inRegion(r, lat, lon)) continue;
        if (r.kind === 'wood' && hash3(i, j, 7) < r.density) c = CL.WOOD;
        if (r.kind === 'orchard' && c === CL.FIELDS && hash3(i, j, 8) < r.density) c = CL.ORCHARD;
        if (r.kind === 'hops' && c === CL.FIELDS && hash3(i, j, 9) < r.density) c = CL.HOPS;
        if (r.kind === 'downs' && hAt(x, z) >= r.minHeight && c !== CL.WOOD) c = CL.DOWNS;
        if (r.kind === 'marsh') c = CL.MARSH;
        if (r.kind === 'beach') c = CL.BEACH;
        if (r.kind === 'cliff' && coastal[k]) c = CL.CLIFF;
      }
      // Scattered copses everywhere in England.
      if (c === CL.FIELDS && hash3(i, j, 12) < 0.07) c = CL.WOOD;
      // Low coasts: shingle and sand.
      if (coastal[k] && (c === CL.FIELDS || c === CL.FRANCE || c === CL.DOWNS) && lat < 51.25 && hAt(x, z) < 25) c = CL.BEACH;
      cls[k] = c;
    }
  }

  // ---- Towns.
  for (const t of places.towns) {
    const tx = toX(t.lon), tz = toZ(t.lat), R = t.r * 1000;
    for (let j = Math.floor((tz - R - E.z0) / E.cell); j <= Math.ceil((tz + R - E.z0) / E.cell); j++) {
      for (let i = Math.floor((tx - R - E.x0) / E.cell); i <= Math.ceil((tx + R - E.x0) / E.cell); i++) {
        if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
        const k = j * nx + i;
        if (cls[k] === CL.SEA || cls[k] === CL.MUD) continue;
        const d = Math.hypot(cx(i) - tx, cz(j) - tz) / R;
        if (d > 1) continue;
        if (t.kind === 'city') cls[k] = CL.CITY;
        else if (t.kind === 'suburb') {
          if (cls[k] !== CL.CITY && hash3(i, j, 21) < 0.92 - d * 0.65) cls[k] = CL.SUBURB;
        } else if (hash3(i, j, 22) < 1.15 - d * 0.6) cls[k] = CL.TOWN;
      }
    }
  }

  // ---- Rivers: Natural Earth centrelines plus the authored ones.
  const drawLine = (pts, widths) => {
    for (let s = 0; s < pts.length - 1; s++) {
      const [ax, az] = pts[s], [bx, bz] = pts[s + 1];
      const w = widths ? widths[Math.min(s, widths.length - 1)] : 1;
      const len = Math.hypot(bx - ax, bz - az);
      const steps = Math.ceil(len / (E.cell * 0.35));
      for (let t = 0; t <= steps; t++) {
        const x = ax + ((bx - ax) * t) / steps, z = az + ((bz - az) * t) / steps;
        const r = (w - 1) * E.cell * 0.5;
        for (let dz = -r; dz <= r + 1; dz += E.cell * 0.5) for (let dx = -r; dx <= r + 1; dx += E.cell * 0.5) {
          const k = cellOf(x + dx, z + dz);
          if (k >= 0 && cls[k] !== CL.SEA) cls[k] = CL.RIVER;
        }
      }
    }
  };
  for (const name of ['ne_10m_rivers_lake_centerlines', 'ne_10m_rivers_europe']) {
    const g = JSON.parse(await fetchCached(`${NE}/${name}.geojson`, `${name}.geojson`));
    for (const f of g.features) {
      const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const l of lines) {
        const inside = l.filter(([lon, lat]) => lon > bbox[0] && lon < bbox[2] && lat > bbox[1] && lat < bbox[3]);
        if (inside.length < 2) continue;
        const pts = l.map(([lon, lat]) => [toX(lon), toZ(lat)]);
        // The Thames widens downstream: 1 cell in London, 2 past Woolwich, 3 past Gravesend.
        const widths = f.properties.name === 'Thames'
          ? l.map(([lon]) => (lon > 0.62 ? 9 : lon > 0.5 ? 5 : lon > 0.37 ? 3 : lon > 0.07 ? 2 : 1))
          : null;
        drawLine(pts, widths);
      }
    }
  }
  for (const r of places.rivers) drawLine(r.pts.map(([lat, lon]) => [toX(lon), toZ(lat)]), r.width);

  // ---- Airfields last: a grass square around each.
  for (const a of places.airfields) {
    const ax = toX(a.lon), az = toZ(a.lat);
    const R = a.len * 0.55;
    for (let dz = -R; dz <= R; dz += E.cell * 0.5) for (let dx = -R; dx <= R; dx += E.cell * 0.5) {
      const k = cellOf(ax + dx, az + dz);
      if (k >= 0 && cls[k] !== CL.SEA) cls[k] = CL.AIRFIELD;
    }
  }

  // ---- Sea cells are height 0; flatten heights under water.
  for (let j = 0; j < hnz; j++) for (let i = 0; i < hnx; i++) {
    const k = cellOf(E.x0 + i * E.heightCell, E.z0 + j * E.heightCell);
    if (k >= 0 && (cls[k] === CL.SEA || cls[k] === CL.MUD)) heights[j * hnx + i] = 0;
  }

  // ---- Encode: run-length bytes, base64.
  const rle = [];
  for (let k = 0; k < cls.length;) {
    const v = cls[k];
    let n = 1;
    while (k + n < cls.length && cls[k + n] === v && n < 255) n++;
    rle.push(v, n);
    k += n;
  }
  const clsB64 = Buffer.from(Uint8Array.from(rle)).toString('base64');
  const hB64 = Buffer.from(heights).toString('base64');
  const hist = {};
  for (const v of cls) hist[v] = (hist[v] ?? 0) + 1;
  console.log('cells', nx, 'x', nz, 'classes', hist);
  console.log('max height', Math.max(...heights) * 2, 'm');

  const wrap = (s) => s.match(/.{1,120}/g).map((l) => `  '${l}'`).join(' +\n');
  const out = `// GENERATED by scripts/build-world.mjs — do not edit by hand.
// Sources: Natural Earth 10m land, minor islands and rivers (public domain);
// SRTM 1-arc-second elevation (public domain, via AWS terrain tiles);
// hand-authored layer: src/content/world/places.json.

export const GRID = {
  x0: ${E.x0}, z0: ${E.z0}, cell: ${E.cell}, nx: ${nx}, nz: ${nz},
  heightCell: ${E.heightCell}, hnx: ${hnx}, hnz: ${hnz},
};

/** Surface class per ${E.cell} m cell, run-length encoded (value, count) and base64'd. */
export const CLASS_RLE =
${wrap(clsB64)};

/** Height at each ${E.heightCell} m grid corner, in units of 2 m, base64'd. */
export const HEIGHTS =
${wrap(hB64)};
`;
  writeFileSync('src/content/world/terrainData.ts', out);
  console.log('wrote src/content/world/terrainData.ts', (out.length / 1024).toFixed(0), 'KB');
}

main().catch((e) => { console.error(e); process.exit(1); });
