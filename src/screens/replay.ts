// The replay: the same sortie re-run from its seed and the recorded
// controls, watched from any camera and following any aircraft. It works
// because the simulation is deterministic: same seed, same inputs, same fight.

import type { App } from '../app';
import type { ContextButton } from '../input/devices';
import type { ControlFrame } from '../input/input';
import { drawText, drawTextCentered } from '../render/font';
import type { FrameBuffer } from '../render/framebuffer';
import { C } from '../render/palette';
import { TUNING } from '../tuning';
import { FlownSortie, SortieScreen } from './sortieScreen';

const IDLE: ControlFrame = { pitch: 0, roll: 0, yaw: 0, throttle: 0, fire: false, boost: false, brake: false, pump: false };

export class ReplayScreen extends SortieScreen {
  private i = 0;
  private ended = false;
  private blink = 0;

  constructor(app: App, sortie: FlownSortie, private frames: readonly ControlFrame[], assists: { autoRudder: boolean; stallGuard: boolean; bigTargets: boolean }, private end: () => void) {
    super(app, sortie, () => this.finish(), () => this.finish());
    this.world.autoRudder = assists.autoRudder;
    this.world.stallGuard = assists.stallGuard;
    this.world.bigTargets = assists.bigTargets;
    this.view = 'chase';
    this.touchMode = 'menu';
    this.dropCompression = false;
  }

  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    this.end();
  }

  protected controlFrame(): ControlFrame {
    return this.frames[this.i++] ?? IDLE;
  }

  /** Follow the next or previous aircraft still in the air, nearest the player first. */
  private cycleSubject(d: -1 | 1): void {
    const me = this.player;
    const list = this.world.planes.filter((q) => q.status === 'flying' || q === me).sort((a, b) => (a === me ? -1 : b === me ? 1 : a.pos.distTo(me.pos) - b.pos.distTo(me.pos)));
    const cur = Math.max(0, list.findIndex((q) => q.id === (this.subjectId < 0 ? me.id : this.subjectId)));
    const next = list[(cur + d + list.length) % list.length];
    this.subjectId = next === me ? -1 : next.id;
    if (this.view === 'cockpit' || this.view === 'padlock') this.view = 'chase';
    if (this.view === 'flyby') this.placeFlyby();
  }

  frame(): void {
    const s = this.app.input;
    if (s.consume('back') || s.consume('pause')) { this.finish(); return; }
    if (s.consume('view1') || s.consume('ok')) this.cycleView();
    if (s.consume('left')) this.cycleSubject(-1);
    if (s.consume('right')) this.cycleSubject(1);
    if (s.consume('timeUp')) this.timeIdx = Math.min(TUNING.sim.timeCompression.length - 1, this.timeIdx + 1);
    if (s.consume('timeDown')) this.timeIdx = Math.max(0, this.timeIdx - 1);
    for (const t of s.taps) {
      if (t.y > 226) this.finish();
      else if (t.x < 90) this.cycleSubject(-1);
      else if (t.x > 230) this.cycleSubject(1);
      else this.cycleView();
    }
    s.taps.length = 0;
  }

  tick(): void {
    if (this.ended) return;
    if (this.i >= this.frames.length) { this.finish(); return; }
    super.tick();
    this.blink++;
  }

  render(fb: FrameBuffer): void {
    super.render(fb);
    if ((this.blink >> 5) & 1) drawText(fb, 'REPLAY', 280, 12, C.FIRE_R, 'tiny');
    const t = Math.floor((this.i * TUNING.sim.dt) / 60), sec = Math.floor(this.i * TUNING.sim.dt) % 60;
    drawText(fb, `${t}:${String(sec).padStart(2, '0')}  x${TUNING.sim.timeCompression[this.timeIdx]}`, 274, 20, C.WHITE, 'tiny');
    drawTextCentered(fb, '< AIRCRAFT    TAP: CAMERA    AIRCRAFT >', 160, 236, C.CHALK, 'tiny');
    drawTextCentered(fb, 'TAP HERE TO END THE REPLAY', 160, 245, C.GREY_L, 'tiny');
  }

  contextButtons(): ContextButton[] {
    return [];
  }
}
