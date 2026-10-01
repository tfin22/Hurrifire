// Draws the world from a camera: copper sky, sun, terrain, then every object
// (aircraft, clouds, tracers, smoke, parachutes) through the painter's sort.

import { World } from '../sim/world';
import { modelFor } from '../content/models';
import { debrisModel, parachuteModel } from '../content/models/misc';
import { Quat, Vec3 } from '../core/math';
import { C } from './palette';
import { Camera } from './camera';
import { FrameBuffer } from './framebuffer';
import { Renderer3D } from './renderer3d';
import { buildCopper, drawSky, drawSun, SkyParams } from './sky';
import { TerrainRenderer, TerrainSource } from './terrain';

export interface SceneOpts {
  /** Skip this plane (the one we're sitting in). */
  skipPlaneId?: number;
  lowDetail?: boolean;
  /** Draw the sun disc. */
  sun?: boolean;
  /** Rebuild the copper table (only for the main view; the mirror reuses it). */
  copper?: Uint8Array;
}

const IDENTITY = new Quat();

export class SceneRenderer {
  readonly r3d = new Renderer3D();
  readonly terrain: TerrainRenderer;
  /** Extra draw hooks (bullets, particles, clouds, world objects) added by later systems. */
  readonly layers: ((r: Renderer3D, cam: Camera, opts: SceneOpts) => void)[] = [];
  lodBias = 0;
  ground: [number, number, number] = [96, 118, 70];
  light = 1;
  warmth = 0;

  constructor(src: TerrainSource) {
    this.terrain = new TerrainRenderer(src);
  }

  skyParams(world: World, cam: Camera): SkyParams {
    return { altitude: cam.pos.y, sun: world.sun, haze: world.weather.haze, ground: this.ground, light: this.light, warmth: this.warmth };
  }

  private drawObjects(r: Renderer3D, world: World): void {
    const tail = new Vec3();
    for (const b of world.bullets) {
      if (!b.tracer) continue;
      tail.copy(b.pos).addScaled(b.vel, -0.025);
      r.addLine(tail, b.pos, b.side === 'raf' ? C.FIRE_Y : C.WHITE);
    }
    for (const pt of world.particles) {
      const k = pt.age / pt.life;
      switch (pt.kind) {
        case 'white': r.addPuff(pt.pos, pt.size, k < 0.5 ? C.WHITE : C.CHALK, k > 0.6); break;
        case 'black': r.addPuff(pt.pos, pt.size, k < 0.4 ? C.SMOKE : C.GREY_D, k > 0.5); break;
        case 'pall': r.addPuff(pt.pos, pt.size, k < 0.3 ? C.SMOKE : k < 0.7 ? C.GREY_D : C.GREY_L, k > 0.6); break;
        case 'fire': r.addPuff(pt.pos, pt.size * (1 - k * 0.5), (world.tick + pt.size * 10) & 2 ? C.FIRE_Y : C.FIRE_R); break;
        case 'flash': r.addPuff(pt.pos, pt.size * (0.6 + k), k < 0.3 ? C.WHITE : k < 0.6 ? C.FIRE_Y : C.FIRE_R); break;
        case 'spark': r.addPoint(pt.pos, (world.tick & 1) ? C.WHITE : C.FIRE_Y, 2); break;
        case 'splash': r.addPuff(pt.pos, pt.size * (0.5 + k), C.WHITE, true); break;
        case 'flak': r.addPuff(pt.pos, pt.size, k < 0.1 ? C.FIRE_Y : C.SMOKE, k > 0.5); break;
        case 'debris': r.addPoint(pt.pos, C.BLACK, 1); break;
        case 'dust': r.addPuff(pt.pos, pt.size, C.RAF_EARTH_L, true); break;
      }
    }
    for (const c of world.parachutes) {
      if (c.landed) continue;
      if (c.age < 2) { r.addPoint(c.pos, C.BLACK, 1); continue; }
      r.addModel(parachuteModel, c.pos, IDENTITY, { speckColour: C.WHITE, visRange: 6000 });
    }
    for (const f of world.fragments) {
      if (f.part < 0) r.addModel(debrisModel, f.pos, f.q);
      else r.addModel(modelFor(f.typeId), f.pos, f.q, { onlyParts: 1 << f.part });
    }
  }

  draw(fb: FrameBuffer, cam: Camera, world: World, opts: SceneOpts = {}): { sunScreen: { x: number; y: number } | null } {
    const sp = this.skyParams(world, cam);
    if (opts.copper) buildCopper(opts.copper, sp);
    fb.setClip(cam.vx0, cam.vy0, cam.vx1, cam.vy1);
    drawSky(fb, cam, sp);
    const sunScreen = opts.sun !== false ? drawSun(fb, cam, world.sun) : null;
    const fogScale = 1.25 - world.weather.haze * 0.6;
    this.terrain.lowDetail = !!opts.lowDetail || this.lodBias > 0;
    this.terrain.draw(fb, cam, world.sun, fogScale);
    const r = this.r3d;
    r.sun.copy(world.sun);
    r.fogScale = fogScale;
    r.lodBias = this.lodBias + (opts.lowDetail ? 1 : 0);
    r.begin(cam, fb);
    for (const p of world.planes) {
      if (p.id === opts.skipPlaneId) continue;
      if (p.status === 'destroyed' || p.status === 'crashed') continue;
      const fs = p.fs;
      r.addModel(modelFor(p.type.id), fs.pos, fs.q, {
        flashParts: p.flash > 0 ? p.flashParts : 0,
        hideParts: p.hiddenParts,
        speckColour: undefined,
      });
    }
    this.drawObjects(r, world);
    for (const layer of this.layers) layer(r, cam, opts);
    r.flush();
    fb.resetClip();
    return { sunScreen };
  }
}
