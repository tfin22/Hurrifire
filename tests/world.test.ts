import { describe, expect, it } from 'vitest';
import { Vec3 } from '../src/core/math';
import { CL, lonLatToXZ, worldMap } from '../src/content/world/map';
import { WorldObjects } from '../src/content/world/objects';
import { CloudField } from '../src/sim/clouds';
import { dayOfYear, sunDirection } from '../src/sim/sun';

const map = worldMap();
const at = (lat: number, lon: number) => lonLatToXZ(lat, lon);

describe('the 11 Group map (generated from Natural Earth + SRTM)', () => {
  it('has sea in the Channel and the North Sea, land in Kent and France', () => {
    expect(map.classAt(...at(50.95, 1.3))).toBe(CL.SEA); // Strait of Dover
    expect(map.classAt(...at(50.7, 0.5))).toBe(CL.SEA); // Channel off Hastings
    expect(map.classAt(...at(51.6, 1.5))).toBe(CL.SEA); // off Essex
    expect(map.classAt(...at(51.2, 0.6))).not.toBe(CL.SEA); // Kent
    expect(map.classAt(...at(50.8, 1.9))).not.toBe(CL.SEA); // Pas-de-Calais
  });

  it('London is built up and the Thames runs through it', () => {
    expect([CL.CITY, CL.RIVER]).toContain(map.classAt(...at(51.51, -0.12)));
    let river = 0;
    for (let lon = -0.2; lon < 0.1; lon += 0.01) for (let lat = 51.47; lat < 51.53; lat += 0.005) if (map.classAt(...at(lat, lon)) === CL.RIVER) river++;
    expect(river).toBeGreaterThan(10);
  });

  it('heights are plausible: the North Downs stand up, the marsh is flat', () => {
    const downs = map.heightAt(...at(51.3, 0.05)); // near Biggin Hill on the Downs
    const marsh = map.heightAt(...at(51.0, 0.88)); // Romney Marsh
    expect(downs).toBeGreaterThan(100);
    expect(downs).toBeLessThan(260);
    expect(marsh).toBeLessThan(20);
    expect(map.heightAt(...at(50.9, 1.2))).toBe(0); // sea
  });

  it('has the 11 Group airfields', () => {
    for (const n of ['Biggin Hill', 'Kenley', 'Hornchurch', 'North Weald', 'Northolt', 'Tangmere', 'Debden', 'Manston', 'Hawkinge']) {
      const a = map.airfieldByName(n)!;
      expect(a).toBeDefined();
      expect(map.surfaceAt(a.pos.x, a.pos.z)).toBe('airfield');
    }
  });

  it('every point has a surface; Romney Marsh is marsh, the Weald has woods', () => {
    expect(map.surfaceAt(...at(51.0, 0.85))).toBe('marsh');
    let wood = 0;
    for (let i = 0; i < 400; i++) {
      const [x, z] = at(51.05 + (i % 20) * 0.004, 0.1 + Math.floor(i / 20) * 0.01);
      if (map.surfaceAt(x, z) === 'woodland') wood++;
    }
    expect(wood).toBeGreaterThan(40);
  });

  it('fields are bounded rectangles with hedges, and the rollout sees them', () => {
    const [x, z] = at(51.15, 0.55);
    const f = map.fieldAt(x, z);
    expect(f.x1 - f.x0).toBeGreaterThan(100);
    expect(f.z1 - f.z0).toBeGreaterThan(100);
    expect(f.x1 - f.x0).toBeLessThanOrEqual(500);
    // Somewhere within 1.2 km in some direction there's an obstacle.
    const runs = [0, 1, 2, 3].map((k) => map.clearRun(x, z, (k * Math.PI) / 2));
    expect(runs.some((r) => r.obstacle !== 'none')).toBe(true);
  });

  it('crops follow the season: gold in late July, stubble in September', () => {
    let gold = 0, stubble = 0;
    map.season = 0.15;
    for (let i = 0; i < 300; i++) if (map.cropOf(i, 7, 0) === 'gold') gold++;
    map.season = 0.55;
    for (let i = 0; i < 300; i++) if (map.cropOf(i, 7, 0) === 'stubble') stubble++;
    map.season = 0.2;
    expect(gold).toBeGreaterThan(50);
    expect(stubble).toBeGreaterThan(30);
  });

  it('places landmarks, Chain Home masts, oast houses and balloons', () => {
    const o = new WorldObjects(map);
    expect(o.objects.some((x) => x.kind === 'towerBridge')).toBe(true);
    expect(o.objects.filter((x) => x.kind === 'oast').length).toBeGreaterThan(50);
    expect(o.masts.length).toBeGreaterThanOrEqual(28);
    expect(o.balloons.length).toBeGreaterThan(40);
  });
});

describe('clouds', () => {
  it('block line of sight through the layer, not above it', () => {
    const cf = new CloudField(3, 1200, 2200, 0.9);
    let blocked = 0;
    for (let i = 0; i < 50; i++) {
      const a = new Vec3(i * 900, 1600, 0), b = new Vec3(i * 900 + 4000, 1600, 3000);
      if (!cf.losClear(a, b)) blocked++;
    }
    expect(blocked).toBeGreaterThan(10);
    expect(cf.losClear(new Vec3(0, 4000, 0), new Vec3(5000, 4000, 5000))).toBe(true);
  });

  it('a clear day has no cloud', () => {
    const cf = new CloudField(3, 1200, 2200, 0);
    expect(cf.densityAt(new Vec3(100, 1500, 100))).toBe(0);
  });
});

describe('sun', () => {
  it('is high and to the south at midday in August, low and west in the evening', () => {
    const noon = sunDirection(dayOfYear(8, 15), 12);
    expect(noon.y).toBeGreaterThan(0.75);
    expect(noon.z).toBeLessThan(0);
    const eve = sunDirection(dayOfYear(8, 15), 18.5);
    expect(eve.y).toBeLessThan(0.35);
    expect(eve.x).toBeLessThan(0); // west
  });
});
