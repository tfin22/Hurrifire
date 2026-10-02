// Debrief with the intelligence officer, the logbook, and settings.

import type { App, Screen } from '../app';
import type { Game, LogEntry } from '../game';
import { DEBRIEF } from '../content/text/briefing';
import type { SortieResult } from '../sim/sortie';
import { noEffects, ScreenEffects } from '../render/display';
import { drawText, drawTextCentered, wrapText } from '../render/font';
import { FrameBuffer, W } from '../render/framebuffer';
import { C } from '../render/palette';
import { fillCircle, fillRect, hline, rectOutline, vline } from '../render/raster';
import { Menu, panel } from './ui';

export class DebriefScreen implements Screen {
  touchMode = 'menu' as const;
  music = 'debrief' as const;
  private t = 0;
  private lines: { text: string; c: number }[] = [];
  private scroll = 0;

  constructor(private app: App, r: SortieResult, private next: () => void, private replay?: () => void) {
    const L = (text: string, c: number = C.CHALK) => this.lines.push({ text, c });
    L(`${r.date}.  ${r.aircraft}, ${r.durationMin} min.`, C.WHITE);
    if (r.takeoffDelay >= 0) L(`Airborne ${r.takeoffDelay} seconds after the scramble.`);
    L('');
    L('CLAIMS', C.SIGHT);
    if (!r.claims.length) L(r.engaged ? 'No claims.' : 'No contact with the enemy.');
    for (const c of r.claims) {
      const verdict = c.allowed === c.claimed ? (c.note === 'wreck' ? 'Wreck found. Confirmed.' : c.note === 'confirmed' ? DEBRIEF.confirmed : DEBRIEF.damaged)
        : c.note === 'overclaim' || c.note === 'downgraded' ? DEBRIEF.downgraded : '';
      L(`${c.type}: claimed ${c.claimed}. Allowed: ${c.allowed}.`, C.WHITE);
      if (verdict) L(`  ${verdict}`);
    }
    L('');
    L('THE RAID', C.SIGHT);
    for (const n of r.raidNotes) L(n);
    L(`Enemy aircraft seen to go down: ${r.enemyDown}.`);
    L('');
    L('YOU', C.SIGHT);
    L(`Rounds fired: ${r.roundsFired}.`);
    L(r.damageTaken > 0.01 ? `Damage: ${r.damageNotes.join(', ')}.` : 'Aircraft undamaged.');
    L(r.outcome.line);
    if (r.outcome.writtenUp) L(r.outcome.writtenUp, C.FIRE_R);
    if (r.outcome.kind === 'ditched' || r.outcome.kind === 'lostSea') L(DEBRIEF.ditchAdvice, C.GREY_L);
    if (r.losses.length) {
      L('');
      L('THE SQUADRON', C.SIGHT);
      for (const l of r.losses) L(l.line, l.lost ? C.FIRE_R : C.CHALK);
    }
  }

  frame(): void {
    const s = this.app.input;
    if (s.consume('down')) this.scroll++;
    if (s.consume('up')) this.scroll = Math.max(0, this.scroll - 1);
    if (this.replay && s.consume('view1')) { this.replay(); return; }
    if (s.taps.length || s.consume('ok') || s.consume('back')) {
      const t = s.taps[0];
      if (t && t.y > 228 && t.x < 107 && this.replay) this.replay();
      else if (t && t.y > 228 && t.x < 213) this.scroll += 5;
      else this.next();
    }
  }

  tick(): void { this.t++; }

  render(fb: FrameBuffer): void {
    drawOffice(fb);
    panel(fb, 8, 72, 304, 176, C.BLACK);
    drawText(fb, 'INTELLIGENCE OFFICER', 14, 76, C.SIGHT);
    const wrapped: { text: string; c: number }[] = [];
    for (const l of this.lines) for (const w of wrapText(l.text, 292, 'tiny')) wrapped.push({ text: w, c: l.c });
    const max = 25;
    this.scroll = Math.min(this.scroll, Math.max(0, wrapped.length - max));
    wrapped.slice(this.scroll, this.scroll + max).forEach((l, i) => drawText(fb, l.text, 14, 88 + i * 6, l.c, 'tiny'));
    if (this.replay) drawTextCentered(fb, 'REPLAY (V)', 53, 240, C.SIGHT, 'tiny');
    if (wrapped.length > max) drawTextCentered(fb, 'MORE', 160, 240, C.GREY_L, 'tiny');
    drawTextCentered(fb, 'CONTINUE', 266, 240, C.GREY_L, 'tiny');
  }

  effects(): ScreenEffects {
    const fx = noEffects();
    fx.fade = Math.max(0, 1 - this.t / 30);
    return fx;
  }
}

/** The IO's office: a desk, a lamp, a map on the wall. */
function drawOffice(fb: FrameBuffer): void {
  fillRect(fb, 0, 0, W, 256, C.GREY_D);
  for (let x = 0; x < W; x += 16) vline(fb, x, 0, 70, C.SMOKE);
  // Wall map.
  fillRect(fb, 200, 8, 100, 56, C.SEA);
  fillRect(fb, 200, 8, 60, 30, C.FIELD_L);
  fillRect(fb, 250, 46, 50, 18, C.GOLD);
  rectOutline(fb, 199, 7, 102, 58, C.RAF_EARTH_D);
  // The officer: older, spectacles, pipe.
  fillRect(fb, 70, 40, 40, 32, C.BLUE);
  fillCircle(fb, 90, 30, 11, C.STUBBLE);
  fillRect(fb, 80, 18, 20, 5, C.GREY_L);
  hline(fb, 83, 88, 30, C.BLACK);
  hline(fb, 92, 97, 30, C.BLACK);
  fillRect(fb, 96, 36, 8, 2, C.RAF_EARTH_D);
  // Desk lamp and desk.
  fillRect(fb, 20, 54, 4, 16, C.RAF_GREEN);
  fillRect(fb, 14, 48, 16, 7, C.RAF_GREEN);
  fillRect(fb, 0, 66, W, 6, C.RAF_EARTH);
}

export class LogbookScreen implements Screen {
  touchMode = 'menu' as const;
  music = 'debrief' as const;
  private page: number;
  constructor(private app: App, private game: Game, private next: () => void) {
    this.page = Math.max(0, Math.ceil(game.pilot.logbook.length / 6) - 1);
  }

  frame(): void {
    const s = this.app.input;
    const pages = Math.max(1, Math.ceil(this.game.pilot.logbook.length / 6));
    if (s.consume('left')) this.page = Math.max(0, this.page - 1);
    if (s.consume('right')) this.page = Math.min(pages - 1, this.page + 1);
    for (const t of s.taps) {
      if (t.x < 60) this.page = Math.max(0, this.page - 1);
      else if (t.x > 260) this.page = Math.min(pages - 1, this.page + 1);
      else this.next();
    }
    if (s.consume('ok') || s.consume('back')) this.next();
  }

  tick(): void {}

  render(fb: FrameBuffer): void {
    fillRect(fb, 0, 0, W, 256, C.RAF_EARTH_D);
    fillRect(fb, 10, 8, 300, 240, C.STUBBLE);
    vline(fb, 160, 8, 247, C.GOLD);
    const p = this.game.pilot;
    drawText(fb, `PILOT'S FLYING LOG BOOK - ${p.name.toUpperCase()}`, 16, 12, C.BLUE, 'tiny');
    drawText(fb, `Sorties ${p.sorties}.  Destroyed ${p.destroyed}, probable ${p.probable}, damaged ${p.damaged}.`, 16, 20, C.BLUE, 'tiny');
    hline(fb, 12, 307, 28, C.BLUE);
    const entries: LogEntry[] = p.logbook.slice(this.page * 6, this.page * 6 + 6);
    if (!entries.length) drawText(fb, 'No entries yet.', 20, 40, C.BLACK, 'hand');
    let y = 34;
    for (const e of entries) {
      drawText(fb, `${e.date}  ${e.aircraft}  ${Math.floor(e.duration / 60)}.${String(e.duration % 60).padStart(2, '0')}`, 16, y, C.RED, 'tiny');
      y += 8;
      for (const l of wrapText(e.remarks, 284, 'hand').slice(0, 3)) { drawText(fb, l, 18, y, C.BLACK, 'hand'); y += 10; }
      hline(fb, 12, 307, y, C.GOLD);
      y += 4;
    }
    drawTextCentered(fb, `< PAGE ${this.page + 1} >   TAP CENTRE TO CLOSE`, 160, 240, C.RAF_EARTH, 'tiny');
  }
}

export class SettingsScreen implements Screen {
  touchMode = 'menu' as const;
  music = 'title' as const;
  private menu: Menu;
  constructor(private app: App, private next: () => void) {
    const st = app.settings;
    const on = (b: boolean) => (b ? 'ON' : 'OFF');
    const items = () => [
      // Arcade -> Assist -> Authentic -> Arcade.
      { label: `MODE: ${st.arcade ? 'ARCADE' : st.assist ? 'ASSIST' : 'AUTHENTIC'}`, act: () => {
        if (st.arcade) { st.arcade = false; st.assist = true; } else if (st.assist) st.assist = false; else { st.arcade = true; st.assist = true; }
        this.refresh();
      } },
      { label: `ENEMY MARKERS: ${on(st.markers)}`, act: () => { st.markers = !st.markers; this.refresh(); } },
      { label: `BIG SPEED/HEIGHT: ${on(st.bigReadouts)}`, act: () => { st.bigReadouts = !st.bigReadouts; this.refresh(); } },
      { label: `AMMO BAR: ${on(st.ammoBar)}`, act: () => { st.ammoBar = !st.ammoBar; this.refresh(); } },
      { label: `AUTO-RUDDER: ${on(st.autoRudder)}`, act: () => { st.autoRudder = !st.autoRudder; this.refresh(); } },
      { label: `STALL GUARD: ${on(st.stallGuard)}`, act: () => { st.stallGuard = !st.stallGuard; this.refresh(); } },
      { label: `BIG TARGETS: ${on(st.bigTargets)}`, act: () => { st.bigTargets = !st.bigTargets; this.refresh(); } },
      { label: `COMPASS STRIP: ${on(st.compass)}`, act: () => { st.compass = !st.compass; this.refresh(); } },
      { label: `TILT CONTROL: ${on(st.tilt)}`, act: () => { void this.tilt(); } },
      { label: `HAPTICS: ${on(st.haptics)}`, act: () => { st.haptics = !st.haptics; this.refresh(); } },
      { label: `1990 MODE: ${on(st.retro)}`, act: () => { st.retro = !st.retro; this.refresh(); } },
      { label: `SOUND: ${Math.round(st.sound * 10)}`, act: () => { st.sound = (Math.round(st.sound * 10 + 2) % 12) / 10; this.refresh(); }, adjust: (d: -1 | 1) => { st.sound = Math.max(0, Math.min(1, st.sound + d * 0.1)); this.refresh(); } },
      { label: `MUSIC: ${on(st.music)}`, act: () => { st.music = !st.music; this.refresh(); } },
      { label: `PANEL: ${st.slimPanel ? 'SLIM' : 'FULL'}`, act: () => { st.slimPanel = !st.slimPanel; this.refresh(); } },
      { label: 'DONE', act: () => this.next() },
    ];
    this.menu = new Menu(items(), 70, 32, 180, 12);
    this.refresh = () => { app.saveSettings(); const sel = this.menu.sel; this.menu.items = items(); this.menu.sel = sel; };
  }
  private refresh: () => void;
  private async tilt(): Promise<void> {
    const st = this.app.settings;
    if (st.tilt) { this.app.tilt.disable(); st.tilt = false; } else st.tilt = await this.app.tilt.enable();
    this.refresh();
  }
  frame(): void {
    const s = this.app.input;
    if (s.consume('back')) { this.next(); return; }
    this.menu.input(s);
  }
  tick(): void {}
  render(fb: FrameBuffer): void {
    fillRect(fb, 0, 0, W, 256, C.SMOKE);
    panel(fb, 50, 24, 220, 200);
    this.menu.draw(fb, 'SETTINGS');
    const st = this.app.settings;
    drawTextCentered(fb, st.arcade ? 'ARCADE: START NEAR THE RAID, QUICK AND TOUGH, NO BLACKOUT' : st.assist ? 'ASSIST: LEAD MARKER, LANDING AIDS, ONE START BUTTON' : 'AUTHENTIC: AS IT WAS', 160, 229, C.CHALK, 'tiny');
    drawTextCentered(fb, 'KEYS: ARROWS/WASD STICK, SPACE FIRE, +/- THROTTLE, G GEAR, F FLAPS,', 160, 238, C.GREY_L, 'tiny');
    drawTextCentered(fb, 'P PADLOCK, B LOOK BACK, T TALLY-HO, 1-4 ORDERS, M MAP, V HOMING,', 160, 245, C.GREY_L, 'tiny');
    drawTextCentered(fb, 'I START, X ENGINE OFF, N JUMP HOME, J BAIL OUT, [ ] TIME, ` DEBUG', 160, 252, C.GREY_L, 'tiny');
  }
}
