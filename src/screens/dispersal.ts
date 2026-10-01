// Dispersal: readiness. A hut with pilots in deckchairs, a gramophone, a tea
// urn and the telephone; aircraft waiting on the grass outside. Before the
// phone rings: set gun convergence, read the weather board and the latest
// intelligence. Then it rings.

import type { App, Screen } from '../app';
import type { Game } from '../game';
import { Rng } from '../core/rng';
import { DISPERSAL, INTEL, WEATHER_BOARD } from '../content/text/briefing';
import { describeWind } from '../sim/weather';
import type { SortieSpec } from '../sim/sortie';
import { noEffects, ScreenEffects } from '../render/display';
import { drawText, drawTextCentered, drawTextScaled, scaledWidth } from '../render/font';
import { FrameBuffer, W } from '../render/framebuffer';
import { C, COPPER_BASE } from '../render/palette';
import { fillCircle, fillConvex, fillRect, hline, line, rectOutline, vline } from '../render/raster';
import { Menu, panel, paragraph } from './ui';
import { TUNING } from '../tuning';

export class DispersalScreen implements Screen {
  touchMode = 'menu' as const;
  private t = 0;
  private menu: Menu;
  private view: 'menu' | 'weather' | 'intel' = 'menu';
  private ringAt: number;
  private ringing = -1;
  private intel: string;
  private flavour: string;
  private fade = 1;
  private leaving = -1;

  constructor(private app: App, _game: Game, private spec: SortieSpec, private go: (spec: SortieSpec) => void, private back: () => void) {
    const rng = new Rng(spec.seed + 77);
    this.intel = rng.pick(INTEL[spec.phase]);
    this.flavour = rng.pick(DISPERSAL.waiting);
    this.ringAt = 50 * (6 + rng.int(8));
    const yards = () => `CONVERGENCE ${this.app.settings.convergenceYards} YDS`;
    this.menu = new Menu([
      { label: yards(), act: () => this.cycleConv(1), adjust: (d) => this.cycleConv(d) },
      { label: 'WEATHER BOARD', act: () => (this.view = 'weather') },
      { label: 'INTELLIGENCE', act: () => (this.view = 'intel') },
      { label: 'WAIT FOR THE PHONE', act: () => (this.ringAt = Math.min(this.ringAt, this.t + 25)) },
      { label: 'BACK TO THE MESS', act: () => this.back() },
    ], 170, 176, 140, 13);
  }

  private cycleConv(d: -1 | 1): void {
    const opts = TUNING.guns.convergenceYards;
    const st = this.app.settings;
    const i = Math.max(0, opts.indexOf(st.convergenceYards as 250));
    st.convergenceYards = opts[(i + d + opts.length) % opts.length];
    this.spec.convergenceM = st.convergenceYards * 0.9144;
    this.menu.items[0].label = `CONVERGENCE ${st.convergenceYards} YDS`;
    this.app.saveSettings();
  }

  frame(): void {
    const s = this.app.input;
    if (this.ringing >= 0) {
      if (s.taps.length || s.consume('ok') || s.consume('start')) this.leave();
      return;
    }
    if (this.view !== 'menu') {
      if (s.taps.length || s.consume('ok') || s.consume('back')) this.view = 'menu';
      return;
    }
    if (s.consume('back')) { this.back(); return; }
    this.menu.input(s);
  }

  private leave(): void {
    if (this.leaving < 0) this.leaving = this.t;
  }

  tick(): void {
    this.t++;
    if (this.fade > 0 && this.leaving < 0) this.fade = Math.max(0, this.fade - 0.04);
    if (this.ringing < 0 && this.t >= this.ringAt) {
      this.ringing = this.t;
      this.app.sound('bell');
    }
    if (this.ringing >= 0 && this.t - this.ringing > 50 * 2.5) this.leave();
    if (this.leaving >= 0) {
      this.fade = Math.min(1, (this.t - this.leaving) / 25);
      if (this.t - this.leaving > 26) this.go(this.spec);
    }
  }

  render(fb: FrameBuffer): void {
    drawHut(fb, this.t, this.ringing >= 0, this.app.display.copper, this.spec);
    if (this.ringing >= 0) {
      const flash = Math.floor((this.t - this.ringing) / 6) % 2 === 0;
      drawTextCentered(fb, DISPERSAL.ring.toUpperCase(), 160, 30, flash ? C.WHITE : C.SIGHT, 'topaz', C.BLACK);
      if (this.t - this.ringing > 35) {
        const s = 'SCRAMBLE!';
        drawTextScaled(fb, s, (W - scaledWidth(s, 3)) / 2, 60, C.FIRE_Y, 3, C.BLACK);
        drawTextCentered(fb, '"Squadron, scramble!"', 160, 92, C.WHITE, 'topaz', C.BLACK);
      }
      return;
    }
    panel(fb, 160, 168, 156, 82);
    this.menu.draw(fb);
    drawText(fb, 'AT READINESS', 8, 6, C.WHITE, 'topaz', C.BLACK);
    drawText(fb, `${this.spec.day} ${monthName(this.spec.month).toUpperCase()} 1940, ${String(this.spec.hour).padStart(2, '0')}00 HRS`, 8, 17, C.CHALK, 'tiny');
    drawText(fb, `${this.spec.home.toUpperCase()} - ${this.spec.squadron.toUpperCase()} SQUADRON`, 8, 24, C.CHALK, 'tiny');
    drawText(fb, this.flavour, 8, 236, C.CHALK, 'hand');
    if (this.view === 'weather') {
      const w = this.spec.weather;
      const vis = w.haze > 0.5 ? 'hazy, 8 miles' : w.haze > 0.3 ? 'good, 15 miles' : 'excellent';
      panel(fb, 30, 60, 260, 100, C.BLACK);
      drawTextCentered(fb, 'WEATHER', 160, 66, C.SIGHT);
      WEATHER_BOARD(w.summary, w.cloudBase, w.cover, describeWind(w), vis).forEach((l, i) => drawText(fb, l, 40, 84 + i * 14, C.CHALK, 'hand'));
      drawTextCentered(fb, 'TAP TO CONTINUE', 160, 150, C.GREY_L, 'tiny');
    }
    if (this.view === 'intel') {
      panel(fb, 30, 60, 260, 100, C.BLACK);
      drawTextCentered(fb, 'INTELLIGENCE', 160, 66, C.SIGHT);
      paragraph(fb, this.intel, 40, 84, 240, C.CHALK, 'hand', 12);
      if (this.spec.underAttack) drawText(fb, 'Ops room: a raid is heading this way.', 40, 136, C.FIRE_Y, 'hand');
      drawTextCentered(fb, 'TAP TO CONTINUE', 160, 150, C.GREY_L, 'tiny');
    }
  }

  effects(): ScreenEffects {
    const fx = noEffects();
    fx.fade = this.fade;
    return fx;
  }
}

function monthName(m: number): string {
  return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1];
}

/** The hut, in pixel art. */
function drawHut(fb: FrameBuffer, t: number, ringing: boolean, copper: Uint8Array, spec: SortieSpec): void {
  // Sky through the window (copper), late-summer grass and parked aircraft.
  for (let i = 0; i < 224; i++) {
    const k = i / 223;
    copper[i * 3] = 90 + 120 * k; copper[i * 3 + 1] = 130 + 90 * k; copper[i * 3 + 2] = 200 + 40 * k;
  }
  fillRect(fb, 0, 0, W, 256, C.RAF_EARTH_D);
  // Wall planks.
  for (let y = 0; y < 150; y += 6) {
    fillRect(fb, 0, y, W, 5, (y / 6) % 2 ? C.RAF_EARTH : C.RAF_EARTH_D);
    hline(fb, 0, W - 1, y + 5, C.BLACK);
  }
  // Window.
  const wx = 14, wy = 36, ww = 130, wh = 70;
  for (let y = 0; y < wh; y++) fillRect(fb, wx, wy + y, ww, 1, COPPER_BASE + Math.floor((y / wh) * 160));
  fillRect(fb, wx, wy + 48, ww, wh - 48, C.FIELD);
  fillRect(fb, wx, wy + 48, ww, 3, C.FIELD_L);
  // Parked aircraft silhouettes on the grass.
  for (let k = 0; k < 3; k++) {
    const ax = wx + 18 + k * 40, ay = wy + 54 + (k % 2) * 4;
    fillRect(fb, ax - 12, ay - 1, 26, 2, C.RAF_GREEN);
    fillRect(fb, ax - 3, ay - 4, 9, 4, C.RAF_EARTH);
    fillConvex(fb, [ax + 8, ax + 14, ax + 14], [ay - 1, ay - 7, ay - 1], 3, C.RAF_GREEN);
    fillRect(fb, ax - 2, ay + 1, 1, 3, C.BLACK);
    fillRect(fb, ax + 4, ay + 1, 1, 3, C.BLACK);
    fillCircle(fb, ax - 5, ay - 2, 1, C.BLUE);
  }
  // Window frame and bars.
  rectOutline(fb, wx - 2, wy - 2, ww + 4, wh + 4, C.BLACK);
  rectOutline(fb, wx - 1, wy - 1, ww + 2, wh + 2, C.CHALK);
  vline(fb, wx + ww / 2, wy, wy + wh, C.CHALK);
  hline(fb, wx, wx + ww, wy + wh / 2, C.CHALK);
  // Blackboard with the state.
  fillRect(fb, 168, 34, 136, 70, C.BLACK);
  rectOutline(fb, 167, 33, 138, 72, C.RAF_EARTH_L);
  drawText(fb, 'STATE: READINESS', 174, 40, C.CHALK, 'hand');
  drawText(fb, `A FLT: ${spec.leading ? 'You' : 'S/L'}, ${spec.others.slice(0, 2).map((o) => o.name.split(' ').pop()).join(', ')}`.slice(0, 21), 174, 54, C.CHALK, 'hand');
  drawText(fb, 'B FLT: released', 174, 66, C.CHALK, 'hand');
  drawText(fb, `Cloud ${Math.round(spec.weather.cover * 8)}/8`, 174, 80, C.CHALK, 'hand');
  // Floor.
  fillRect(fb, 0, 150, W, 106, C.SMOKE);
  for (let y = 152; y < 256; y += 8) hline(fb, 0, W - 1, y, C.BLACK);
  // Table with the telephone and the tea urn.
  fillRect(fb, 200, 128, 110, 6, C.RAF_EARTH_L);
  fillRect(fb, 204, 134, 4, 26, C.RAF_EARTH);
  fillRect(fb, 300, 134, 4, 26, C.RAF_EARTH);
  // Tea urn and mugs.
  fillRect(fb, 270, 104, 22, 24, C.GREY_L);
  fillRect(fb, 272, 100, 18, 4, C.CHALK);
  fillRect(fb, 279, 96, 4, 4, C.BLACK);
  fillRect(fb, 264, 116, 6, 3, C.BLACK);
  for (const mx of [244, 252]) { fillRect(fb, mx, 121, 5, 7, C.WHITE); fillRect(fb, mx + 5, 123, 2, 3, C.WHITE); }
  // Telephone: shakes when ringing.
  const sh = ringing ? ((t >> 1) % 2 ? 1 : -1) : 0;
  fillRect(fb, 212 + sh, 118, 22, 10, C.BLACK);
  fillRect(fb, 210 + sh, 113, 26, 5, C.BLACK);
  fillCircle(fb, 223 + sh, 122, 3, C.GREY_D);
  if (ringing) {
    for (let k = 0; k < 3; k++) line(fb, 238 + k * 3, 112 - k * 2, 242 + k * 3, 108 - k * 2, C.WHITE);
    for (let k = 0; k < 3; k++) line(fb, 206 - k * 3, 112 - k * 2, 202 - k * 3, 108 - k * 2, C.WHITE);
  }
  // Gramophone with its horn.
  fillRect(fb, 150, 132, 26, 16, C.RAF_EARTH);
  fillRect(fb, 152, 130, 22, 3, C.BLACK);
  fillConvex(fb, [160, 180, 190, 168], [128, 108, 120, 130], 4, C.GOLD);
  fillCircle(fb, 186, 112, 7, C.GOLD);
  fillCircle(fb, 186, 112, 4, C.RAF_EARTH_D);
  // Pilots in deckchairs, Mae Wests on.
  for (let k = 0; k < 3; k++) {
    const px = 22 + k * 46, py = 170 + (k % 2) * 6;
    // Deckchair: striped canvas on a wooden frame.
    fillConvex(fb, [px, px + 26, px + 34, px + 8], [py, py, py + 30, py + 30], 4, k % 2 ? C.FIELD_L : C.RED);
    for (let s = 0; s < 4; s++) line(fb, px + 4 + s * 6, py + 1, px + 12 + s * 6, py + 29, C.WHITE);
    line(fb, px - 2, py + 2, px + 6, py + 40, C.RAF_EARTH_L);
    line(fb, px + 28, py + 2, px + 36, py + 40, C.RAF_EARTH_L);
    // The pilot: legs, blue uniform, yellow Mae West, face, hair.
    fillRect(fb, px + 14, py + 26, 4, 14, C.BLUE);
    fillRect(fb, px + 20, py + 26, 4, 14, C.BLUE);
    fillRect(fb, px + 12, py + 36, 6, 3, C.BLACK);
    fillRect(fb, px + 20, py + 38, 6, 3, C.BLACK);
    fillRect(fb, px + 10, py + 10, 16, 16, C.FIRE_Y);
    fillRect(fb, px + 10, py + 18, 16, 3, C.GOLD);
    fillCircle(fb, px + 18, py + 5, 5, C.STUBBLE);
    fillRect(fb, px + 13, py - 1, 10, 3, k === 1 ? C.GOLD : C.RAF_EARTH_D);
    // One reads, one dozes, one has a mug.
    if (k === 0) fillRect(fb, px + 8, py + 14, 10, 8, C.WHITE);
    if (k === 2) fillRect(fb, px + 26, py + 16, 4, 5, C.WHITE);
    if (k === 1 && !ringing && (t >> 5) % 2) drawText(fb, 'z', px + 26, py - 6 - ((t >> 3) % 4), C.WHITE, 'tiny');
  }
}
