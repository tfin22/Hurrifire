// Cockpit: canopy frame, rear-view mirror housing, reflector gunsight and the
// instrument panel (the six-instrument blind-flying panel plus RPM, boost,
// oil and radiator temperature, fuel). Needles are lines, readable at 320×256.

import { clamp, MPS_TO_MPH, M_TO_FT } from '../core/math';
import { FlightState } from '../sim/flight';
import { FrameBuffer, W } from './framebuffer';
import { drawText, drawTextCentered } from './font';
import { C } from './palette';
import { fillCircle, fillConvex, fillRect, hline, line, pset, rectOutline, stippleRect, vline } from './raster';

export const PANEL_TOP_FULL = 172;
export const PANEL_TOP_SLIM = 242;

export interface CockpitLayout {
  panelTop: number;
  viewCy: number;
  mirror: { x0: number; y0: number; x1: number; y1: number };
}

export function cockpitLayout(slim: boolean): CockpitLayout {
  const panelTop = slim ? PANEL_TOP_SLIM : PANEL_TOP_FULL;
  return {
    panelTop,
    viewCy: Math.round(panelTop * 0.5),
    mirror: { x0: 134, y0: 3, x1: 186, y1: 17 },
  };
}

/** Forward canopy frame: windscreen posts, top bow, side rails. */
export function drawCanopyFrame(fb: FrameBuffer, L: CockpitLayout, typeId: string): void {
  fb.resetClip();
  const top = L.panelTop;
  const post = (x0: number, x1: number, w: number) => {
    fillConvex(fb, [x0, x0 + w, x1 + w, x1], [top, top, 10, 10], 4, C.SMOKE);
    line(fb, x0 + w, top, x1 + w, 10, C.GREY_D);
  };
  if (typeId === 'hurricane') {
    // Heavier framing, three-piece windscreen.
    post(96, 112, 6);
    post(218, 202, 6);
    fillRect(fb, 0, 0, W, 8, C.SMOKE);
    hline(fb, 0, W - 1, 8, C.GREY_D);
  } else {
    post(100, 116, 5);
    post(215, 199, 5);
    // Curved top bow of the canopy.
    for (let x = 0; x < W; x++) {
      const t = (x - 160) / 160;
      const y = Math.round(6 + t * t * 10);
      vline(fb, x, 0, y, C.SMOKE);
      pset(fb, x, y + 1, C.GREY_D);
    }
  }
  // Side rails.
  fillConvex(fb, [0, 40, 40, 0], [top - 26, top - 6, top, top], 4, C.SMOKE);
  fillConvex(fb, [280, W, W, 280], [top - 6, top - 26, top, top], 4, C.SMOKE);
  // Mirror housing.
  const m = L.mirror;
  rectOutline(fb, m.x0 - 2, m.y0 - 2, m.x1 - m.x0 + 4, m.y1 - m.y0 + 4, C.BLACK);
  rectOutline(fb, m.x0 - 1, m.y0 - 1, m.x1 - m.x0 + 2, m.y1 - m.y0 + 2, C.GREY_D);
  vline(fb, 160, 0, m.y0 - 2, C.BLACK);
  // Gunsight body on the coaming.
  fillRect(fb, 150, top - 9, 20, 9, C.BLACK);
  fillRect(fb, 152, top - 13, 16, 4, C.SMOKE);
  hline(fb, 151, 169, top - 14, C.GREY_L);
}

/** Rear canopy and armoured headrest seen when looking over a shoulder. */
export function drawRearFrame(fb: FrameBuffer, side: -1 | 1): void {
  fb.resetClip();
  // Armour plate and headrest on the inboard side.
  const x = side < 0 ? 230 : 0;
  fillRect(fb, x, 120, 90, 136, C.SMOKE);
  fillCircle(fb, side < 0 ? 270 : 50, 130, 34, C.SMOKE);
  // Canopy hoop and tail fin silhouette cue.
  fillRect(fb, 0, 0, W, 6, C.SMOKE);
  fillConvex(fb, [side < 0 ? 200 : 100, side < 0 ? 210 : 110, side < 0 ? 240 : 80, side < 0 ? 230 : 70], [6, 6, 256, 256], 4, C.SMOKE);
  hline(fb, 0, W - 1, 230, C.SMOKE);
  fillRect(fb, 0, 231, W, 25, C.PANEL);
}

/**
 * Reflector gunsight: glowing ring and dot, range bars set for the target
 * span at the convergence range. Brightest thing on the screen.
 */
export function drawGunsight(fb: FrameBuffer, cx: number, cy: number, f: number, spanM: number, rangeM: number, dim = false): void {
  const c = dim ? C.GOLD : C.SIGHT;
  const ringR = f * 0.05; // 100 mil ring
  // Ring with gaps at the cardinal points, like the GM2.
  const r = Math.round(ringR);
  let x = r, y = 0, err = 1 - r;
  const plot = (px: number, py: number) => {
    const ang = Math.abs(Math.atan2(py, px));
    const card = Math.min(ang % (Math.PI / 2), Math.PI / 2 - (ang % (Math.PI / 2)));
    if (card > 0.12) pset(fb, cx + px, cy + py, c);
  };
  while (x >= y) {
    plot(x, y); plot(-x, y); plot(x, -y); plot(-x, -y);
    plot(y, x); plot(-y, x); plot(y, -x); plot(-y, -x);
    y++;
    if (err < 0) err += 2 * y + 1;
    else { x--; err += 2 * (y - x) + 1; }
  }
  // Cross lines and dot.
  hline(fb, cx - r - 4, cx - r + 2, cy, c);
  hline(fb, cx + r - 2, cx + r + 4, cy, c);
  vline(fb, cx, cy + r - 2, cy + r + 4, c);
  pset(fb, cx, cy, C.WHITE);
  pset(fb, cx + 1, cy, c);
  pset(fb, cx - 1, cy, c);
  // Range bars: gap = set span at set range.
  const half = Math.max(2, Math.round((f * spanM) / rangeM / 2));
  hline(fb, cx - half - 5, cx - half, cy + r + 7, c);
  hline(fb, cx + half, cx + half + 5, cy + r + 7, c);
}

// ------------------------------------------------------------------ dials

function dialFace(fb: FrameBuffer, cx: number, cy: number, r: number, ticks: number, from = -150, to = 150, major = 0): void {
  fillCircle(fb, cx, cy, r + 1.5, C.GREY_D);
  fillCircle(fb, cx, cy, r, C.BLACK);
  for (let i = 0; i <= ticks; i++) {
    const a = ((from + ((to - from) * i) / ticks) * Math.PI) / 180;
    const s = Math.sin(a), co = -Math.cos(a);
    const len = major && i % major === 0 ? 3 : 1.5;
    line(fb, cx + s * (r - 0.5), cy + co * (r - 0.5), cx + s * (r - len), cy + co * (r - len), C.GREY_L);
  }
}

function needle(fb: FrameBuffer, cx: number, cy: number, angDeg: number, len: number, c: number = C.WHITE): void {
  const a = (angDeg * Math.PI) / 180;
  line(fb, cx, cy, cx + Math.sin(a) * len, cy - Math.cos(a) * len, c);
}

function valueAngle(v: number, lo: number, hi: number, from = -150, to = 150): number {
  return from + (to - from) * clamp((v - lo) / (hi - lo), 0, 1);
}

function artificialHorizon(fb: FrameBuffer, cx: number, cy: number, r: number, pitch: number, roll: number): void {
  fillCircle(fb, cx, cy, r + 1.5, C.GREY_D);
  const s = Math.sin(roll), c = Math.cos(roll);
  const off = clamp(pitch * 1.6, -1, 1) * r;
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      if (x * x + y * y > r * r) continue;
      // Rotate into the horizon frame.
      const hy = -x * s + y * c;
      fb.px[(cy + y) * W + cx + x] = hy < off ? C.SKY_D : C.RAF_EARTH;
    }
  }
  // Fixed aircraft symbol.
  hline(fb, cx - r + 3, cx - 3, cy, C.WHITE);
  hline(fb, cx + 3, cx + r - 3, cy, C.WHITE);
  pset(fb, cx, cy - 1, C.WHITE);
}

export interface PanelData {
  fs: FlightState;
  turnRate: number;
  gearDownLegs: number;
  gearMoving: boolean;
  flaps: number;
  boostOn: boolean;
  fuelGallons: number;
  fuelCapGallons: number;
  pumpProgress?: number;
  ammoFrac?: number;
  oilOnScreen?: number;
}

export function drawPanel(fb: FrameBuffer, L: CockpitLayout, d: PanelData, slim: boolean): void {
  fb.resetClip();
  const fs = d.fs;
  const mph = fs.ias * MPS_TO_MPH;
  const ft = fs.pos.y * M_TO_FT;
  const fpm = fs.vel.y * M_TO_FT * 60;
  const hdg = (fs.heading * 180) / Math.PI;
  if (slim) {
    const y = L.panelTop;
    fillRect(fb, 0, y, W, 256 - y, C.PANEL);
    hline(fb, 0, W - 1, y, C.GREY_D);
    const items = [
      `${Math.round(mph)}MPH`, `${Math.round(ft / 10) * 10}FT`, `${String(Math.round(hdg) % 360).padStart(3, '0')}`,
      `${fpm >= 0 ? '+' : ''}${Math.round(fpm / 100) * 100}`, `${Math.round(fs.rpm)}RPM`,
      `${fs.boostLb >= 0 ? '+' : ''}${fs.boostLb.toFixed(0)}LB`, `${Math.round(d.fuelGallons)}GAL`, `${Math.round(fs.radTemp)}C`,
    ];
    let x = 4;
    for (const it of items) { drawText(fb, it, x, y + 4, C.WHITE, 'tiny'); x += it.length * 4 + 7; }
    gearLamps(fb, 300, y + 4, d);
    return;
  }
  const top = L.panelTop;
  fillRect(fb, 0, top, W, 256 - top, C.PANEL);
  hline(fb, 0, W - 1, top, C.GREY_D);
  hline(fb, 0, W - 1, top + 1, C.SMOKE);
  // Blind-flying panel: a darker plate in the middle.
  fillRect(fb, 104, top + 4, 112, 78, C.SMOKE);
  rectOutline(fb, 104, top + 4, 112, 78, C.GREY_D);
  const r = 14;
  const row1 = top + 22, row2 = top + 58;
  const c1 = 124, c2 = 160, c3 = 196;
  // ASI
  dialFace(fb, c1, row1, r, 12, -150, 150, 2);
  needle(fb, c1, row1, valueAngle(mph, 0, 480), r - 2);
  drawText(fb, 'MPH', c1 - 5, row1 + 5, C.GREY_L, 'tiny');
  // Artificial horizon
  artificialHorizon(fb, c2, row1, r, fs.pitch, fs.roll);
  // Vertical speed: zero at nine o'clock.
  dialFace(fb, c3, row1, r, 8, -170, 10, 4);
  needle(fb, c3, row1, -90 + clamp(fpm / 4000, -1, 1) * 80, r - 2);
  drawText(fb, 'UP', c3 - 3, row1 - 9, C.GREY_L, 'tiny');
  // Altimeter: long hand hundreds, short hand thousands.
  dialFace(fb, c1, row2, r, 10, 0, 360, 0);
  needle(fb, c1, row2, ((ft % 1000) / 1000) * 360, r - 2);
  needle(fb, c1, row2, ((ft % 10000) / 10000) * 360, r - 6, C.SIGHT);
  // Direction indicator.
  dialFace(fb, c2, row2, r, 8, 0, 360, 2);
  for (const [lab, a] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]] as const) {
    const ang = ((a - hdg) * Math.PI) / 180;
    drawText(fb, lab, c2 + Math.sin(ang) * (r - 5) - 1, row2 - Math.cos(ang) * (r - 5) - 2, lab === 'N' ? C.SIGHT : C.GREY_L, 'tiny');
  }
  vline(fb, c2, row2 - r + 1, row2 - 3, C.WHITE);
  // Turn and slip.
  dialFace(fb, c3, row2, r, 4, -60, 60, 2);
  needle(fb, c3, row2 + 4, clamp(d.turnRate / 3, -1, 1) * 45, r - 2);
  hline(fb, c3 - 9, c3 + 9, row2 + 8, C.GREY_D);
  const ball = clamp(-fs.nyLat * 25, -8, 8);
  fillCircle(fb, c3 + ball, row2 + 8, 2, C.WHITE);
  // Engine gauges, left side.
  const ly = top + 22;
  dialFace(fb, 30, ly, 13, 8, -150, 150, 2);
  needle(fb, 30, ly, valueAngle(fs.rpm, 0, 4000), 11);
  drawText(fb, 'RPM', 25, ly + 5, C.GREY_L, 'tiny');
  dialFace(fb, 72, ly, 12, 6, -150, 150, 2);
  needle(fb, 72, ly, valueAngle(fs.boostLb, -6, 12), 10, d.boostOn ? C.FIRE_R : C.WHITE);
  drawText(fb, 'BST', 67, ly + 5, C.GREY_L, 'tiny');
  gearLamps(fb, 18, top + 46, d);
  drawText(fb, 'FLAPS', 52, top + 46, d.flaps > 0.1 ? C.SIGHT : C.GREY_D, 'tiny');
  if (d.pumpProgress !== undefined && d.pumpProgress > 0 && d.pumpProgress < 1) {
    rectOutline(fb, 18, top + 56, 60, 5, C.GREY_L);
    fillRect(fb, 19, top + 57, 58 * d.pumpProgress, 3, C.SIGHT);
    drawText(fb, 'PUMP', 34, top + 63, C.GREY_L, 'tiny');
  }
  if (d.boostOn) drawText(fb, 'BOOST', 18, top + 72, C.FIRE_R, 'tiny');
  // Right side: fuel, oil, radiator.
  dialFace(fb, 242, ly, 12, 4, -120, 120, 1);
  needle(fb, 242, ly, valueAngle(d.fuelGallons, 0, d.fuelCapGallons, -120, 120), 10, d.fuelGallons < d.fuelCapGallons * 0.15 ? C.FIRE_R : C.WHITE);
  drawText(fb, 'FUEL', 235, ly + 5, C.GREY_L, 'tiny');
  dialFace(fb, 274, ly - 4, 9, 4, -120, 120, 1);
  needle(fb, 274, ly - 4, valueAngle(fs.oilTemp, 0, 120, -120, 120), 7);
  drawText(fb, 'OIL', 269, ly + 7, C.GREY_L, 'tiny');
  dialFace(fb, 302, ly - 4, 9, 4, -120, 120, 1);
  needle(fb, 302, ly - 4, valueAngle(fs.radTemp, 40, 140, -120, 120), 7, fs.radTemp > 115 ? C.FIRE_R : C.WHITE);
  drawText(fb, 'RAD', 297, ly + 7, C.GREY_L, 'tiny');
  if (d.ammoFrac !== undefined) {
    rectOutline(fb, 236, top + 50, 70, 6, C.GREY_L);
    fillRect(fb, 237, top + 51, 68 * clamp(d.ammoFrac, 0, 1), 4, C.GOLD);
    drawText(fb, 'AMMO', 236, top + 58, C.GREY_L, 'tiny');
  }
  // Engine state warning lamp.
  if (fs.engine !== 'running') {
    drawTextCentered(fb, fs.engine === 'seized' ? 'ENGINE SEIZED' : fs.engine === 'off' ? 'ENGINE OFF' : fs.engine === 'coughing' ? 'ENGINE ROUGH' : 'ENGINE STOPPED', 270, top + 72, C.FIRE_R, 'tiny');
  }
}

function gearLamps(fb: FrameBuffer, x: number, y: number, d: PanelData): void {
  // Green = down and locked, red = up, both dark while moving.
  for (let i = 0; i < 2; i++) {
    const down = d.gearDownLegs > i;
    const col = d.gearMoving ? C.SMOKE : down ? C.FIELD_L : C.RED;
    fillCircle(fb, x + i * 8, y + 2, 2.5, col);
  }
  drawText(fb, 'U/C', x - 2, y + 7, C.GREY_L, 'tiny');
}

/** Oil on the windscreen: a darkening stipple over the forward view. */
export function drawOilScreen(fb: FrameBuffer, L: CockpitLayout, amount: number, seed: number): void {
  if (amount <= 0) return;
  fb.setClip(100, 0, 220, L.panelTop);
  stippleRect(fb, 100, 0, 120, L.panelTop, C.SMOKE, seed & 1);
  if (amount > 0.5) stippleRect(fb, 100, 0, 120, L.panelTop, C.BLACK, (seed + 1) & 1);
  if (amount > 0.8) fillRect(fb, 112, 20, 96, L.panelTop - 40, C.BLACK);
  fb.resetClip();
}

/** A centred message line in the view (warnings, prompts). */
export function viewMessage(fb: FrameBuffer, text: string, y: number, c: number = C.WHITE): void {
  drawTextCentered(fb, text, 160, y, c, 'topaz', C.BLACK);
}

