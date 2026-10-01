// A procedural test terrain for free flight before the real map exists (and
// for the debug "test range"): rolling downs, a field patchwork, woods, a
// stretch of sea to the south.

import { hash01, hash3 } from '../../core/rng';
import { MAT_ID } from '../../render/palette';
import type { TerrainSource } from '../../render/terrain';
import type { GroundModel, Surface } from '../../sim/ground';

const FIELD_MATS = [MAT_ID.field, MAT_ID.gold, MAT_ID.stubble, MAT_ID.plough, MAT_ID.field, MAT_ID.wood];
const FIELD_SURF: Surface[] = ['pasture', 'stubble', 'stubble', 'ploughed', 'pasture', 'woodland'];
const SEA_Z = -15000;

export class TestTerrain implements TerrainSource, GroundModel {
  heightAt(x: number, z: number): number {
    if (z < SEA_Z) return 0;
    const shore = Math.min(1, (z - SEA_Z) / 3000);
    const h = 60 + 55 * Math.sin(x / 4100) * Math.cos(z / 5300) + 30 * Math.sin((x + z) / 1900) + 90 * Math.max(0, Math.sin(z / 9000));
    return Math.max(2, h * shore);
  }

  private fieldIndex(x: number, z: number): number {
    const ix = Math.floor(x / 250), iz = Math.floor(z / 250);
    // Split each 250 m cell into two fields along a hashed line.
    const fx = x / 250 - ix, fz = z / 250 - iz;
    const sp = 0.3 + 0.4 * hash01(ix, iz, 5);
    const half = hash3(ix, iz, 6) & 1 ? fx < sp : fz < sp;
    return hash3(ix, iz, half ? 1 : 2) % FIELD_MATS.length;
  }

  surfaceAt(x: number, z: number): Surface {
    if (z < SEA_Z) return 'sea';
    if (Math.abs(x) < 400 && Math.abs(z) < 400) return 'airfield';
    return FIELD_SURF[this.fieldIndex(x, z)];
  }

  cellIsWater(_ix: number, iz: number, size: number): boolean {
    return (iz + 1) * size <= SEA_Z;
  }

  cellMaterial(ix: number, iz: number, size: number): number {
    if ((iz + 1) * size <= SEA_Z) return MAT_ID.sea;
    if (size <= 250) return MAT_ID.wood; // shows between fields as hedgerows
    if (size >= 4000) return hash3(ix, iz, 9) % 5 === 0 ? MAT_ID.wood : MAT_ID.field;
    return FIELD_MATS[hash3(ix, iz, size) % FIELD_MATS.length];
  }

  nearDetail(ix: number, iz: number, size: number, emit: (pts: number[], material: number) => void): void {
    const x0 = ix * size, z0 = iz * size;
    if (Math.abs(x0 + size / 2) < 500 && Math.abs(z0 + size / 2) < 500) {
      emit([x0, z0, x0 + size, z0, x0 + size, z0 + size, x0, z0 + size], MAT_ID.field);
      return;
    }
    const sp = 0.3 + 0.4 * hash01(ix, iz, 5);
    const vertical = hash3(ix, iz, 6) & 1;
    const a = FIELD_MATS[hash3(ix, iz, 1) % FIELD_MATS.length];
    const b = FIELD_MATS[hash3(ix, iz, 2) % FIELD_MATS.length];
    const inset = 4; // a hedge line shows between fields
    if (vertical) {
      const xm = x0 + size * sp;
      emit([x0 + inset, z0 + inset, xm - inset, z0 + inset, xm - inset, z0 + size - inset, x0 + inset, z0 + size - inset], a);
      emit([xm + inset, z0 + inset, x0 + size - inset, z0 + inset, x0 + size - inset, z0 + size - inset, xm + inset, z0 + size - inset], b);
    } else {
      const zm = z0 + size * sp;
      emit([x0 + inset, z0 + inset, x0 + size - inset, z0 + inset, x0 + size - inset, zm - inset, x0 + inset, zm - inset], a);
      emit([x0 + inset, zm + inset, x0 + size - inset, zm + inset, x0 + size - inset, z0 + size - inset, x0 + inset, z0 + size - inset], b);
    }
  }
}
