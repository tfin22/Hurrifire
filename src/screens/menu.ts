// Title screen and main menu: a loading-screen-style scene of our own —
// Spitfires climbing past cumulus under a palette-cycled copper sky.

import type { App, Screen } from '../app';
import type { Game } from '../game';
import { Quat, Vec3 } from '../core/math';
import { Camera } from '../render/camera';
import { noEffects, ScreenEffects } from '../render/display';
import { drawText, drawTextCentered, drawTextScaled, scaledWidth } from '../render/font';
import { FrameBuffer, W } from '../render/framebuffer';
import { C, COPPER_BASE } from '../render/palette';
import { fillCircle, fillRect } from '../render/raster';
import { Renderer3D } from '../render/renderer3d';
import { spitfireModel } from '../content/models/spitfire';
import { Menu } from './ui';

export interface MenuActions {
  campaign(): void;
  scramble(): void;
  quickCombat(): void;
  logbook(): void;
  settings(): void;
  modelViewer(): void;
}

export class TitleScreen implements Screen {
  touchMode = 'menu' as const;
  music = 'title' as const;
  private t = 0;
  private cam = new Camera();
  private r3d = new Renderer3D();
  private menu: Menu;
  private fade = 1;

  constructor(private app: App, private game: Game, private actions: MenuActions) {
    this.cam.setViewport(0, 0, 320, 256, 50);
    this.menu = new Menu([
      { label: 'CAMPAIGN 1940', act: () => this.actions.campaign() },
      { label: 'SCRAMBLE!', act: () => this.actions.scramble() },
      { label: 'QUICK COMBAT', act: () => this.actions.quickCombat() },
      { label: 'LOGBOOK', act: () => this.actions.logbook() },
      { label: 'SETTINGS', act: () => this.actions.settings() },
      { label: 'MODEL VIEWER', act: () => this.actions.modelViewer() },
    ], 90, 146, 140, 14);
  }

  frame(): void {
    const s = this.app.input;
    if (s.taps.length || s.actions.length) void this.app.goFullscreen();
    if (s.consume('debug')) this.actions.modelViewer();
    this.menu.input(s);
  }

  tick(): void {
    this.t++;
    if (this.fade > 0) this.fade = Math.max(0, this.fade - 0.03);
  }

  render(fb: FrameBuffer): void {
    const t = this.t / 50;
    // Copper sky: deep blue to pale at the horizon, with a slow palette cycle
    // running a band of light up through it.
    const cop = this.app.display.copper;
    for (let i = 0; i < 224; i++) {
      const k = i / 223;
      const band = 0.5 + 0.5 * Math.sin(k * 14 - t * 1.4);
      cop[i * 3] = 60 + 140 * k + band * 12;
      cop[i * 3 + 1] = 90 + 120 * k + band * 10;
      cop[i * 3 + 2] = 170 + 60 * k + band * 6;
    }
    for (let y = 0; y < 256; y++) fillRect(fb, 0, y, W, 1, COPPER_BASE + Math.min(223, Math.floor((y / 255) * 223)));
    // Cumulus, drifting.
    for (let i = 0; i < 9; i++) {
      const x = ((i * 97 + t * (8 + i)) % 420) - 50;
      const y = 150 + (i % 3) * 30;
      cloud(fb, x, y, 14 + (i % 4) * 6);
    }
    // Two Spitfires climbing through.
    this.r3d.begin(this.cam, fb);
    this.cam.pos.set(0, 0, 0);
    this.cam.setOrientation(Quat.fromEuler(0, 0.1, 0));
    for (let k = 0; k < 2; k++) {
      const z = 38 + k * 14;
      const pos = new Vec3(-9 + k * 14 + Math.sin(t * 0.3 + k) * 1.5, 7.5 - k * 1.5 + Math.sin(t * 0.5 + k) * 0.6, z);
      const q = Quat.fromEuler(0.65, 0.35, -0.25 + Math.sin(t * 0.4 + k) * 0.08);
      this.r3d.addModel(spitfireModel, pos, q, { noCollapse: true });
    }
    this.r3d.flush();
    fb.resetClip();
    // Logo.
    const logo = 'SCRAMBLE!';
    drawTextScaled(fb, logo, (W - scaledWidth(logo, 3)) / 2, 18, C.SIGHT, 3, C.BLACK);
    drawTextCentered(fb, 'THE BATTLE OF BRITAIN  -  SUMMER 1940', 160, 50, C.WHITE, 'topaz', C.BLACK);
    fillRect(fb, 70, 138, 180, 94, C.BLACK);
    fillRect(fb, 72, 140, 176, 90, C.SMOKE);
    this.menu.draw(fb);
    drawText(fb, `${this.game.pilot.name.toUpperCase()}  ${this.game.pilot.sorties} SORTIES`, 6, 246, C.CHALK, 'tiny');
    drawText(fb, 'A PERSONAL HOMAGE. ALL ART, SOUND AND CODE ORIGINAL.', 100, 246, C.GREY_L, 'tiny');
  }

  effects(): ScreenEffects {
    const fx = noEffects();
    fx.fade = this.fade;
    return fx;
  }
}

/** A 2D pixel cumulus: overlapping discs, white tops, grey bases. */
export function cloud(fb: FrameBuffer, x: number, y: number, r: number): void {
  fillCircle(fb, x, y + r * 0.3, r * 1.05, C.GREY_L);
  fillCircle(fb, x - r * 0.9, y + r * 0.35, r * 0.75, C.GREY_L);
  fillCircle(fb, x + r * 0.9, y + r * 0.4, r * 0.7, C.GREY_L);
  fillCircle(fb, x, y, r, C.CHALK);
  fillCircle(fb, x - r * 0.9, y + r * 0.15, r * 0.7, C.CHALK);
  fillCircle(fb, x + r * 0.9, y + r * 0.2, r * 0.65, C.CHALK);
  fillCircle(fb, x - r * 0.2, y - r * 0.35, r * 0.7, C.WHITE);
  fillCircle(fb, x + r * 0.5, y - r * 0.1, r * 0.55, C.WHITE);
}
