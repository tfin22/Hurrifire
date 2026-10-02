// Renderer bench (milestone 2): a Spitfire turning on a turntable over a
// field patchwork, or 40 aircraft in view at once for measuring frame rate.
// Reachable from the debug menu.

import type { App, Screen } from '../app';
import { Quat } from '../core/math';
import { Camera } from '../render/camera';
import { FrameBuffer } from '../render/framebuffer';
import { drawText } from '../render/font';
import { C } from '../render/palette';
import { rasterStats, fillConvex, fillRect, rectOutline } from '../render/raster';

const BACK = { x: 268, y: 2, w: 50, h: 16 };
import { Renderer3D } from '../render/renderer3d';
import { buildCopper, drawSky, drawSun } from '../render/sky';
import { spitfireModel } from '../content/models/spitfire';
import { hash3 } from '../core/rng';
import { Model } from '../render/model';

export class BenchScreen implements Screen {
  touchMode = 'menu' as const;
  private t = 0;
  private cam = new Camera();
  private r3d = new Renderer3D();
  private many = false;
  private frameMs = 0;
  /** Model shown on the turntable; steps with left/right or taps at the sides. */
  private index = 0;

  constructor(private app: App, private onExit: () => void, private models: Model[] = [spitfireModel]) {
    this.cam.setViewport(0, 0, 320, 256, 62);
  }

  frame(): void {
    const s = this.app.input;
    if (s.consume('back') || s.consume('pause')) { this.onExit(); return; }
    const step = (d: number) => { this.index = (this.index + d + this.models.length) % this.models.length; this.many = false; };
    if (s.consume('left')) step(-1);
    if (s.consume('right')) step(1);
    if (s.consume('ok')) this.many = !this.many;
    for (const t of s.taps) {
      if (t.x >= BACK.x && t.y <= BACK.y + BACK.h) { this.onExit(); return; }
      if (t.x < 80) step(-1);
      else if (t.x > 240) step(1);
      else this.many = !this.many;
    }
  }

  tick(): void {
    this.t++;
  }

  render(fb: FrameBuffer): void {
    const t0 = performance.now();
    rasterStats.polys = 0;
    const t = this.t / 50;
    const cam = this.cam;
    cam.pos.set(0, 1500, 0);
    const camQ = Quat.fromEuler(0.2 * Math.sin(t * 0.1), -0.08, 0.15 * Math.sin(t * 0.3));
    cam.setOrientation(camQ);
    buildCopper(this.app.display.copper, { altitude: cam.pos.y, sun: this.r3d.sun, haze: 0.3, ground: [96, 120, 70], light: 1, warmth: 0 });
    drawSky(fb, cam, { altitude: cam.pos.y, sun: this.r3d.sun, haze: 0.3, ground: [96, 120, 70], light: 1, warmth: 0 });
    this.drawFields(fb, cam);
    drawSun(fb, cam, this.r3d.sun);
    this.r3d.begin(cam, fb);
    const fwd = cam.forward();
    if (!this.many) {
      const m = this.models[this.index];
      const pos = cam.pos.clone().addScaled(fwd, 18);
      const q = Quat.fromEuler(t * 0.6, 0.25 * Math.sin(t * 0.4), 0.4 * Math.sin(t * 0.5));
      this.r3d.addModel(m, pos, q, { noCollapse: true });
      drawText(fb, m.name, 4, 244, C.WHITE, 'topaz', C.BLACK);
    } else {
      for (let i = 0; i < 40; i++) {
        const m = this.models[i % this.models.length];
        const row = Math.floor(i / 8), col = i % 8;
        const pos = cam.pos.clone().addScaled(fwd, 60 + row * 25);
        pos.x += (col - 3.5) * 14 + Math.sin(t + i) * 2;
        pos.y += (row - 2) * 8;
        const q = Quat.fromEuler(t * 0.3 + i, 0.2 * Math.sin(t + i), 0.5 * Math.sin(t * 0.7 + i));
        this.r3d.addModel(m, pos, q);
      }
    }
    this.r3d.flush();
    fb.resetClip();
    this.frameMs = this.frameMs * 0.9 + (performance.now() - t0) * 0.1;
    drawText(fb, `FPS ${this.app.loop.fps.toFixed(1)}  ${this.frameMs.toFixed(1)}MS`, 4, 4, C.WHITE, 'tiny');
    drawText(fb, `POLYS ${rasterStats.polys}  OBJ ${this.r3d.stats.objects}`, 4, 11, C.WHITE, 'tiny');
    drawText(fb, this.many ? '40 AIRCRAFT - TAP MIDDLE FOR ONE' : `${this.index + 1}/${this.models.length}  < TAP SIDES >  TAP MIDDLE FOR 40`, 4, 18, C.SIGHT, 'tiny');
    // The way out.
    fillRect(fb, BACK.x, BACK.y, BACK.w, BACK.h, C.BLACK);
    rectOutline(fb, BACK.x, BACK.y, BACK.w, BACK.h, C.GREY_L);
    drawText(fb, 'BACK', BACK.x + 8, BACK.y + 4, C.WHITE);
  }

  /** A quick procedural patchwork; the real terrain renderer is terrain.ts. */
  private drawFields(fb: FrameBuffer, cam: Camera): void {
    const size = 400;
    const cx = Math.floor(cam.pos.x / size), cz = Math.floor(cam.pos.z / size);
    const R = 14;
    const cells: { d: number; ix: number; iz: number }[] = [];
    for (let iz = cz - R; iz <= cz + R; iz++)
      for (let ix = cx - R; ix <= cx + R; ix++) {
        const x = (ix + 0.5) * size - cam.pos.x, z = (iz + 0.5) * size - cam.pos.z;
        cells.push({ d: x * x + z * z, ix, iz });
      }
    cells.sort((a, b) => b.d - a.d);
    const v = [0, 0, 0];
    const cols = [C.FIELD, C.FIELD_L, C.GOLD, C.STUBBLE, C.FIELD_D, C.RAF_EARTH];
    for (const c of cells) {
      const xs: number[] = [], ys: number[] = [], zs: number[] = [];
      const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
      for (const [a, b] of corners) {
        cam.toCam((c.ix + a) * size, 0, (c.iz + b) * size, v);
        xs.push(v[0]); ys.push(v[1]); zs.push(v[2]);
      }
      if (zs.every((z) => z < 1)) continue;
      if (zs.some((z) => z < 1)) continue; // bench only: skip clipped cells
      const sx = xs.map((x, i) => cam.projX(x, zs[i]));
      const sy = ys.map((y, i) => cam.projY(y, zs[i]));
      fillConvex(fb, sx, sy, 4, cols[hash3(c.ix, c.iz) % cols.length]);
    }
  }
}
