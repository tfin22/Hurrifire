// The sortie in the air: the flight screen plus the R/T bar, start-up,
// tally-ho and orders, the ops-room map, time compression that drops back to
// x1 when anything hostile is in visual range or the controller calls, and
// the hand-over to the debrief.

import type { App } from '../app';
import { ContextButton } from '../input/devices';
import { ControlFrame } from '../input/input';
import { drawText } from '../render/font';
import { FrameBuffer, W } from '../render/framebuffer';
import { C } from '../render/palette';
import { fillRect, pset } from '../render/raster';
import { makeWorldLayer, Plume } from '../render/worldLayer';
import { lonLatToXZ } from '../content/world/map';
import { Vec3 } from '../core/math';
import type { Homing, SortieResult } from '../sim/sortie';
import type { World } from '../sim/world';
import type { WorldMap } from '../content/world/map';
import type { WorldObjects } from '../content/world/objects';
import type { Ship } from '../render/worldLayer';
import type { RTMessage } from '../sim/controller';

/** What the screen needs of a sortie: the RAF scramble, or the 109 escort. */
export interface FlownSortie {
  readonly world: World;
  readonly map: WorldMap;
  readonly objects: WorldObjects;
  readonly ships: Ship[];
  readonly spec: { start: 'readiness' | 'air'; month: number; day: number; home: string; leading: boolean };
  readonly controller: { readonly log: RTMessage[]; readonly lastVector?: { heading: number } | null };
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
  /** The docking computer (jump to finals and autoland), where the sortie has one. */
  readonly docking?: { readonly active: boolean };
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
    if (s.consume('map')) this.mapOpen = !this.mapOpen;
    if (this.mapOpen && s.taps.length) { this.mapOpen = false; s.taps.length = 0; }
    if (s.consume('tallyHo')) this.cmd('tallyHo');
    if (s.consume('homing')) this.cmd('homing');
    if (s.consume('jumpHome')) this.cmd('jumpHome');
    if (s.consume('jumpRaid')) this.cmd('jumpRaid');
    for (const o of ['order1', 'order2', 'order3', 'order4'] as const) if (s.consume(o)) this.cmd(o);
    if (s.consume('start')) this.startPress();
    if (s.consume('primer')) this.cmd('primer');
    if (s.consume('mags')) this.cmd('mags');
    if (s.consume('starter')) { this.cmd('starter'); this.app.sound('starter'); }
    super.frame();
  }

  private startStep = 0;
  /** Assist: one START button; otherwise each press does the next step. */
  private startPress(): void {
    if (this.app.settings.assist) { this.cmd('startAll'); this.app.sound('starter'); return; }
    const step = (['primer', 'mags', 'starter'] as const)[Math.min(2, this.startStep++)];
    this.cmd(step);
    this.app.sound(step === 'starter' ? 'starter' : 'click');
  }

  tick(): void {
    super.tick();
    const so = this.sortie;
    if (this.world.tick % 50 === 0) this.plot.update(this.world.raids, this.world.time);
    // New R/T messages.
    const log = so.controller.log;
    if (this.rtShown < log.length) {
      const m = log[this.rtShown++];
      this.rtText = m.text;
      this.rtFrom = m.from;
      this.rtAge = 0;
      if (m.urgent) this.timeIdx = 0;
      this.app.sound('rt');
    }
    this.rtAge += TUNING.sim.dt;
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
    if (this.sortie.phase === 'startup' && this.messageT <= 0) {
      drawText(fb, this.app.settings.assist ? 'PRESS START' : 'PRIMER - MAGS - STARTER', 4, 160, C.SIGHT, 'tiny');
    }
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
      drawText(fb, part, 10, 2 + i * 6, this.rtFrom === 'controller' ? C.SIGHT : C.CHALK, 'tiny');
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
    const fs = this.player.fs;
    if (so.phase === 'startup' && (fs.engine === 'off' || fs.engine === 'starting')) {
      if (this.app.settings.assist) return [{ action: 'start', label: 'START' }];
      return [{ action: 'primer', label: 'PRIMER' }, { action: 'mags', label: 'MAGS' }, { action: 'starter', label: 'STARTER' }];
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
