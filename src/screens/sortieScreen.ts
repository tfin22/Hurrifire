// The sortie in the air: the flight screen plus the R/T bar, start-up,
// tally-ho and orders, the ops-room map, time compression that drops back to
// x1 when anything hostile is in visual range or the controller calls, and
// the hand-over to the debrief.

import type { App } from '../app';
import { ContextButton } from '../input/devices';
import { ControlFrame, SimCmd } from '../input/input';
import { drawText } from '../render/font';
import { FrameBuffer, W } from '../render/framebuffer';
import { C } from '../render/palette';
import { fillRect, pset, rectOutline } from '../render/raster';
import { makeWorldLayer, Plume } from '../render/worldLayer';
import { lonLatToXZ } from '../content/world/map';
import { Vec3 } from '../core/math';
import type { Homing, SortieResult } from '../sim/sortie';
import type { World } from '../sim/world';
import type { WorldMap } from '../content/world/map';
import type { WorldObjects } from '../content/world/objects';
import type { Ship } from '../render/worldLayer';
import type { RTMessage } from '../sim/controller';
import type { Raid } from '../sim/raid';
import type { OtherSquadron } from '../sim/squadrons';

/** What the screen needs of a sortie: the RAF scramble, or the 109 escort. */
export interface FlownSortie {
  readonly world: World;
  readonly map: WorldMap;
  readonly objects: WorldObjects;
  readonly ships: Ship[];
  readonly spec: { start: 'readiness' | 'air'; month: number; day: number; home: string; leading: boolean };
  readonly controller: { readonly log: RTMessage[]; readonly lastVector?: { heading: number } | null; readonly targetRaid?: Raid | null };
  readonly prompts: string[];
  readonly result: SortieResult | null;
  readonly phase: string;
  readonly engaged: boolean;
  step(f: ControlFrame | null): void;
  /** Order buttons once engaged (default: the RAF squadron's four). */
  readonly orderButtons?: ContextButton[];
  /** Put shared map state back as it was at the start (for a replay). */
  rewind(): void;
  /** The field given in the last homing (marked on screen). */
  readonly homing?: Homing | null;
  /** Arcade's jump to the raid after a real take-off: why not now, or null if it can (RAF sortie only). */
  raidJumpRefusal?(): string | null;
  /** The calls on the R/T menu right now (RAF sortie only; without it, R/T is just tally-ho). */
  rtOptions?(): { cmd: SimCmd; label: string }[];
  /** The docking computer (jump to finals and autoland), where the sortie has one. */
  readonly docking?: { readonly active: boolean };
  /** Starting up (RAF sortie from readiness): where it's got to, and the next step. */
  readonly engineStart?: { strokes: number; need: number; flood: number; mags: boolean; cranking: boolean; last: string };
  nextStartStep?(): 'primer' | 'mags' | 'starter';
  /** Other squadrons of ours that are up (for the map). */
  readonly others?: readonly OtherSquadron[];
}
import { TUNING } from '../tuning';
import { FlightScreen } from './flight';
import { drawMap, OpsPlot } from './mapView';
import { wrapText } from '../render/font';
import { ScreenEffects } from '../render/display';

export class SortieScreen extends FlightScreen {
  private mapOpen = false;
  private plot = new OpsPlot();
  private rtShown = 0;
  /** The R/T menu is open. */
  private rtOpen = false;
  private rtHeard = 0;
  private rtText = '';
  private rtFrom = '';
  private rtAge = 99;
  private promptShown = 0;
  private finishing = -1;
  private raidJumpHinted = false;
  /** Drop back to x1 when the enemy is near (not in a replay). */
  protected dropCompression = true;

  constructor(app: App, readonly sortie: FlownSortie, private done: (r: SortieResult) => void, quit: () => void) {
    super(app, { world: sortie.world, terrain: sortie.map, onExit: quit });
    const spec = sortie.spec;
    const plumes = spec.month > 9 || (spec.month === 9 && spec.day >= 7) ? docksPlume(sortie) : [];
    this.scene.layers.push(makeWorldLayer(sortie.objects, sortie.world, () => sortie.ships, plumes));
    this.world.autoRudder = app.settings.autoRudder;
    app.input.throttle = sortie.spec.start === 'air' ? 0.85 : 0;
  }

  protected vectoredRaid(): Raid | null | undefined {
    return 'targetRaid' in this.sortie.controller && this.sortie.world.player?.side === 'raf' ? this.sortie.controller.targetRaid ?? null : undefined;
  }

  protected homing(): Homing | null {
    return this.sortie.homing ?? null;
  }

  /** A homing if asked for; otherwise the controller's last vector, until the fight starts. */
  protected steerHeading(): number | null {
    const h = super.steerHeading();
    if (h !== null) return h;
    const v = this.sortie.controller.lastVector;
    return v && !this.sortie.engaged ? v.heading : null;
  }

  protected stepSim(f: ControlFrame): void {
    this.sortie.step(f);
  }

  frame(): void {
    const s = this.app.input;
    const so = this.sortie;
    if (s.consume('map')) this.mapOpen = !this.mapOpen;
    if (this.mapOpen && s.taps.length) { this.mapOpen = false; s.taps.length = 0; }
    // The R/T menu: open it, and pick a call (1-6, or 1-4 while it's open instead of the orders).
    if (s.consume('rt')) {
      if (so.rtOptions) this.rtOpen = !this.rtOpen && so.rtOptions().length > 0;
      else this.cmd('tallyHo');
    }
    if (this.rtOpen) {
      const opts = so.rtOptions!();
      if (!opts.length) this.rtOpen = false;
      const keys = [['rt1', 'order1'], ['rt2', 'order2'], ['rt3', 'order3'], ['rt4', 'order4'], ['rt5'], ['rt6']] as const;
      keys.forEach((ks, i) => {
        let hit = false;
        for (const k of ks) if (s.consume(k)) hit = true;
        if (hit && opts[i] && this.rtOpen) { this.cmd(opts[i].cmd); this.rtOpen = false; }
      });
    }
    if (s.consume('tallyHo')) this.cmd('tallyHo');
    if (s.consume('homing')) this.cmd('homing');
    if (s.consume('jumpHome')) this.cmd('jumpHome');
    if (s.consume('jumpRaid')) this.cmd('jumpRaid');
    for (const o of ['order1', 'order2', 'order3', 'order4'] as const) if (s.consume(o)) this.cmd(o);
    if (s.consume('start')) this.startPress();
    if (s.consume('primer')) this.cmd('primer');
    if (s.consume('mags')) { this.cmd('mags'); this.app.sound('click'); }
    if (s.consume('starter')) this.cmd('starter');
    super.frame();
  }

  private startStep = 0;
  private heardStrokes = 0;
  private heardCrank = false;
  /** Assist: one START button; otherwise each press does the next step. */
  private startPress(): void {
    if (this.app.settings.assist) { this.cmd('startAll'); return; }
    const step = this.sortie.nextStartStep?.() ?? (['primer', 'mags', 'starter'] as const)[Math.min(2, this.startStep++)];
    this.cmd(step);
    if (step === 'mags') this.app.sound('click');
  }

  tick(): void {
    super.tick();
    const so = this.sortie;
    if (this.world.tick % 50 === 0) this.plot.update(this.world.raids, this.world.planes, so.others ?? [], this.player.side, this.world.time);
    // New R/T messages. Urgent ones drop time compression as soon as they're sent.
    const log = so.controller.log;
    for (; this.rtHeard < log.length; this.rtHeard++) if (log[this.rtHeard].urgent) this.timeIdx = 0;
    // Shown in turn, each long enough to read; a long backlog skips to the latest few.
    const read = this.rtText.length / 45 + 1.2;
    if (this.rtShown < log.length && (this.rtAge >= read || !this.rtText)) {
      if (log.length - this.rtShown > 3) this.rtShown = log.length - 3;
      const m = log[this.rtShown++];
      this.rtText = m.text;
      this.rtFrom = m.from;
      this.rtAge = 0;
      this.app.sound('rt');
    }
    this.rtAge += TUNING.sim.dt;
    // Starting up: a stroke of the pump, the starter turning (yours or assist's).
    const e = so.engineStart;
    if (e) {
      if (e.strokes > this.heardStrokes) this.app.sound('pump');
      if (e.cranking && !this.heardCrank) this.app.sound('starter');
      this.heardStrokes = e.strokes;
      this.heardCrank = e.cranking;
    }
    while (this.promptShown < so.prompts.length) this.flashMessage(so.prompts[this.promptShown++], 2.5);
    // Arcade after a real take-off: say once that the jump to the raid is there.
    if (!this.raidJumpHinted && this.app.settings.arcade && this.world.tick % 25 === 0 && so.raidJumpRefusal?.() === null) {
      this.raidJumpHinted = true;
      this.flashMessage('JUMP TO RAID WHEN READY', 3);
    }
    // Anything hostile within visual range: back to x1.
    if (this.dropCompression && this.timeIdx > 0 && this.world.tick % 10 === 0) {
      const me = this.player;
      for (const q of this.world.planes) {
        if (q.side !== me.side && q.alive && q.pos.distTo(me.pos) < TUNING.sim.compressionDropRange) { this.timeIdx = 0; break; }
      }
    }
    if (so.result && this.finishing < 0) this.finishing = 0;
    if (this.finishing >= 0) {
      this.finishing += TUNING.sim.dt;
      if (this.finishing > 1.5) { const r = so.result!; this.finishing = -99; this.done(r); }
    }
  }

  render(fb: FrameBuffer): void {
    if (this.mapOpen) {
      drawMap(fb, this.sortie.map, this.player, this.plot, this.app.settings.assist, this.sortie.spec.home, this.world.time);
      this.drawRT(fb);
      return;
    }
    super.render(fb);
    if (this.sortie.docking?.active && (this.world.tick >> 4) & 1) drawText(fb, 'AUTOLAND - MOVE STICK TO TAKE OVER', 92, 150, C.SIGHT, 'tiny');
    this.drawRT(fb);
    this.drawRTMenu(fb);
    if (this.sortie.phase === 'startup') this.drawStartUp(fb);
  }

  /** Starting up: the fitter's advice, and each step as it stands, the next one marked. */
  private drawStartUp(fb: FrameBuffer): void {
    const e = this.sortie.engineStart, fs = this.player.fs;
    if (!e || fs.engine === 'running') {
      if (this.messageT <= 0) drawText(fb, this.app.settings.assist ? 'PRESS START' : 'PRIMER - MAGS - STARTER', 4, 160, C.SIGHT, 'tiny');
      return;
    }
    const next = e.cranking ? 'starter' : this.sortie.nextStartStep?.();
    const x = 4, y = 146;
    fillRect(fb, x - 2, y - 2, 118, 34, C.BLACK);
    drawText(fb, `START UP - FITTER SAYS ${e.need}`, x, y, C.CHALK, 'tiny');
    const row = (i: number, step: string, label: string, state: string, col: number) => {
      const ry = y + 8 + i * 7;
      drawText(fb, next === step ? '>' : ' ', x, ry, C.SIGHT, 'tiny');
      drawText(fb, label, x + 6, ry, next === step ? C.SIGHT : C.GREY_L, 'tiny');
      drawText(fb, state, x + 42, ry, col, 'tiny');
    };
    // Primer: a box per stroke wanted, filled as they're given; past the flood line, red.
    const py = y + 8;
    row(0, 'primer', 'PRIMER', '', C.WHITE);
    const boxes = Math.max(e.flood, e.strokes);
    for (let i = 0; i < boxes; i++) {
      const bx = x + 42 + i * 6;
      const over = i >= e.flood, extra = i >= e.need;
      if (i < e.strokes) fillRect(fb, bx, py, 4, 5, over ? C.RED : extra ? C.GOLD : C.FIELD_L);
      else rectOutline(fb, bx, py, 4, 5, extra ? C.GREY_D : C.GREY_L);
    }
    row(1, 'mags', 'MAGS', e.mags ? 'ON' : 'OFF', e.mags ? C.FIELD_L : C.RED);
    const crank = e.cranking ? ((this.world.tick >> 3) & 1 ? 'TURNING' : 'TURNING.') : e.strokes > e.flood ? 'FLOODED' : '';
    row(2, 'starter', 'STARTER', crank, e.strokes > e.flood ? C.RED : C.WHITE);
  }

  /** The R/T menu, numbered for the keyboard (on a touch screen the buttons show it too). */
  private drawRTMenu(fb: FrameBuffer): void {
    // On a touch screen the buttons are the menu; the list is for the keyboard.
    if (!this.rtOpen || !this.sortie.rtOptions || this.app.input.lastSource === 'touch') return;
    const opts = this.sortie.rtOptions();
    const cam = this.cam;
    // Clear of the big speed and height readouts along the bottom of the view.
    const h = 10 + opts.length * 7, x = cam.vx0 + 4, y = cam.vy1 - h - 30;
    fillRect(fb, x, y, 92, h, C.BLACK);
    drawText(fb, 'R/T  (Q CLOSES)', x + 3, y + 2, C.RED, 'tiny');
    opts.forEach((o, i) => drawText(fb, `${i + 1} ${o.label}`, x + 3, y + 9 + i * 7, o.cmd === 'rtMayday' ? C.FIRE_R : C.SIGHT, 'tiny'));
  }

  /** The crackly R/T bar across the top: text types out under a hiss. */
  private drawRT(fb: FrameBuffer): void {
    if (this.rtAge > 9 || !this.rtText) return;
    const lines = wrapText(this.rtText, 300, 'tiny');
    const shown = Math.floor(this.rtAge * 45);
    const h = 4 + lines.length * 6;
    fillRect(fb, 0, 0, W, h, C.BLACK);
    let n = 0;
    lines.forEach((l, i) => {
      const part = l.slice(0, Math.max(0, shown - n));
      n += l.length;
      drawText(fb, part, 10, 2 + i * 6, this.rtFrom === 'controller' ? C.SIGHT : this.rtFrom === 'other' ? C.GREY_L : C.CHALK, 'tiny');
    });
    // Crackle.
    for (let i = 0; i < 12; i++) pset(fb, (this.world.tick * 37 + i * 53) % W, (i * 7 + this.world.tick) % h, C.GREY_D);
    drawText(fb, this.rtFrom === 'controller' ? 'R/T' : '', 0, 2, C.RED, 'tiny');
  }

  effects(): ScreenEffects {
    const fx = super.effects();
    if (this.finishing > 0) fx.fade = Math.min(1, this.finishing / 1.5);
    return fx;
  }

  contextButtons(): ContextButton[] {
    if (this.paused) return [];
    const so = this.sortie;
    // The R/T menu takes over the column while it's open.
    if (this.rtOpen && so.rtOptions) {
      const acts = ['rt1', 'rt2', 'rt3', 'rt4', 'rt5', 'rt6'] as const;
      return [...so.rtOptions().map((o, i) => ({ action: acts[i], label: o.label, lit: o.cmd === 'rtMayday' })), { action: 'rt' as const, label: 'CLOSE' }];
    }
    const fs = this.player.fs;
    if (so.phase === 'startup' && (fs.engine === 'off' || fs.engine === 'starting')) {
      if (this.app.settings.assist) return [{ action: 'start', label: 'START' }];
      const e = so.engineStart, next = so.nextStartStep?.();
      return [
        { action: 'primer', label: e ? `PRIMER ${e.strokes}` : 'PRIMER', lit: next === 'primer' },
        { action: 'mags', label: e ? `MAGS ${e.mags ? 'ON' : 'OFF'}` : 'MAGS', lit: next === 'mags' },
        { action: 'starter', label: 'STARTER', lit: next === 'starter' && fs.engine === 'off' },
      ];
    }
    const b = super.contextButtons();
    // Arcade after a real take-off: straight to the raid once she's flying.
    if (this.app.settings.arcade && so.raidJumpRefusal && so.raidJumpRefusal() === null) b.unshift({ action: 'jumpRaid', label: 'JUMP TO RAID', lit: true });
    // Ask the controller the way home: not in the middle of a fight.
    const me = this.player;
    const fighting = this.world.planes.some((q) => q.side !== me.side && q.alive && q.pos.distTo(me.pos) < TUNING.sim.compressionDropRange);
    if (!fs.onGround && !fighting && me.status === 'flying') {
      b.push({ action: 'homing', label: 'HOMING' });
      // Assist/Arcade: once there's a field to go to, the jump home.
      if (this.app.settings.assist && this.sortie.homing && !this.sortie.docking?.active) b.push({ action: 'jumpHome', label: 'JUMP HOME', lit: true });
    }
    if (so.engaged && so.spec.leading) {
      b.unshift(...(so.orderButtons ?? [
        { action: 'order1', label: 'BOMBERS' }, { action: 'order2', label: 'ESCORT' },
        { action: 'order3', label: 'FOLLOW' }, { action: 'order4', label: 'RE-FORM' },
      ]));
    }
    return b;
  }
}

/** The docks, burning since the afternoon of 7 September. */
function docksPlume(sortie: FlownSortie): Plume[] {
  const [x, z] = lonLatToXZ(51.502, -0.02);
  const fresh = sortie.spec.month === 9 && sortie.spec.day < 10;
  return [{ pos: new Vec3(x, sortie.map.heightAt(x, z), z), height: fresh ? 4500 : 2500 }];
}
