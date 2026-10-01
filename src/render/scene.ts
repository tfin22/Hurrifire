// Draws the world from a camera: copper sky, sun, terrain, then every object
// (aircraft, clouds, tracers, smoke, parachutes) through the painter's sort.

import { World } from '../sim/world';
import { modelFor } from '../content/models';
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
      if (p.status === 'destroyed') continue;
      const fs = p.fs;
      r.addModel(modelFor(p.type.id), fs.pos, fs.q, {
        flashParts: p.flash > 0 ? p.flashParts : 0,
        hideParts: p.hiddenParts,
        speckColour: undefined,
      });
    }
    for (const layer of this.layers) layer(r, cam, opts);
    r.flush();
    fb.resetClip();
    return { sunScreen };
  }
}
