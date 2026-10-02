// Input devices: keyboard + mouse, touch (DOM controls in the letterbox
// margins), tilt (DeviceOrientation) and the Gamepad API. Each writes into a
// shared InputState.

import { TUNING } from '../tuning';
import { Action, InputState, stickCurve } from './input';
import { H, W } from '../render/framebuffer';

export interface ContextButton {
  action: Action;
  label: string;
  /** Held buttons also drive a state flag while pressed. */
  hold?: 'pump' | 'lookBack' | 'brake';
  /** Highlight (e.g. currently selected time compression). */
  lit?: boolean;
}

export type TouchMode = 'flight' | 'menu';

// ---------------------------------------------------------------- keyboard

const KEY_ACTIONS: Record<string, Action> = {
  g: 'gear', f: 'flaps', p: 'padlock', t: 'tallyHo',
  '1': 'order1', '2': 'order2', '3': 'order3', '4': 'order4',
  F1: 'view1', F2: 'view2', F3: 'view3', F4: 'view4',
  '[': 'timeDown', ']': 'timeUp',
  i: 'start', j: 'bailOut', m: 'map', '`': 'debug', Escape: 'pause',
  v: 'homing', x: 'engineOff', n: 'jumpHome',
  h: 'help', e: 'boost', c: 'canopy', k: 'panel', '9': 'debugNext', '0': 'debugAct',
  Enter: 'ok', Backspace: 'back',
};

export class Keyboard {
  private down = new Set<string>();
  private mouseX = 0;
  private mouseY = 0;

  constructor(private input: InputState, canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.down.clear());
    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouseX = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.mouseY = ((e.clientY - r.top) / r.height) * 2 - 1;
    });
  }

  private onKey(e: KeyboardEvent, isDown: boolean): void {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k.startsWith('F') && k.length <= 3 && k !== 'F') e.preventDefault();
    if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Backspace'].includes(e.key)) e.preventDefault();
    if (isDown) {
      if (!this.down.has(k)) {
        const a = KEY_ACTIONS[k];
        if (a) this.input.push(a);
        if (k === 'D' || (k === 'd' && e.shiftKey)) this.input.push('debug');
        if (e.key === 'ArrowUp') this.input.push('up');
        if (e.key === 'ArrowDown') this.input.push('down');
        if (e.key === 'ArrowLeft') this.input.push('left');
        if (e.key === 'ArrowRight') this.input.push('right');
        if (e.key === ' ') this.input.push('ok');
        if (k === 'Escape') this.input.push('back');
        if (k === 'n') this.input.mouseStick = !this.input.mouseStick;
      }
      this.down.add(k);
    } else {
      this.down.delete(k);
    }
  }

  /** Called once per frame with real elapsed seconds. */
  update(dt: number): void {
    const s = this.input;
    const d = this.down;
    const { keyboardRampPerSec: ramp, keyboardReturnPerSec: ret, throttleKeyRate } = TUNING.input;
    const anyStickKey = d.has('ArrowUp') || d.has('ArrowDown') || d.has('ArrowLeft') || d.has('ArrowRight') ||
      d.has('w') || d.has('a') || d.has('s') || d.has('d');
    if (anyStickKey) {
      const tp = (d.has('ArrowDown') || d.has('s') ? 1 : 0) - (d.has('ArrowUp') || d.has('w') ? 1 : 0);
      const tr = (d.has('ArrowRight') || d.has('d') ? 1 : 0) - (d.has('ArrowLeft') || d.has('a') ? 1 : 0);
      s.pitch = rampTo(s.pitch, tp, (tp === 0 ? ret : ramp) * dt);
      s.roll = rampTo(s.roll, tr, (tr === 0 ? ret : ramp) * dt);
      s.lastSource = 'keys';
    } else if (s.mouseStick) {
      s.pitch = stickCurve(Math.max(-1, Math.min(1, this.mouseY * 1.6)));
      s.roll = stickCurve(Math.max(-1, Math.min(1, this.mouseX * 1.4)));
    } else if (s.lastSource === 'keys') {
      s.pitch = rampTo(s.pitch, 0, ret * dt);
      s.roll = rampTo(s.roll, 0, ret * dt);
    }
    const ty = (d.has('x') ? 1 : 0) - (d.has('z') ? 1 : 0);
    if (ty !== 0 || s.lastSource === 'keys') s.yaw = rampTo(s.yaw, ty, ramp * dt);
    if (d.has('+') || d.has('=')) s.throttle = Math.min(1, s.throttle + throttleKeyRate * dt);
    if (d.has('-') || d.has('_')) s.throttle = Math.max(0, s.throttle - throttleKeyRate * dt);
    if (d.has(' ')) s.fire = true;
    if (d.has('b')) s.lookBack = true;
    if (d.has('g')) s.pumpHeld = true;
    if (d.has(',')) s.brake = true;
  }
}

function rampTo(v: number, target: number, step: number): number {
  if (v < target) return Math.min(target, v + step);
  return Math.max(target, v - step);
}

// ---------------------------------------------------------------- gamepad

export class GamepadSource {
  private prevButtons: boolean[] = [];
  connected = false;

  constructor(private input: InputState) {
    window.addEventListener('gamepadconnected', () => (this.connected = true));
    window.addEventListener('gamepaddisconnected', () => (this.connected = false));
  }

  update(dt: number): void {
    if (!navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    const pad = pads && Array.from(pads).find((p) => p && p.connected);
    if (!pad) return;
    this.connected = true;
    const s = this.input;
    const dz = TUNING.input.gamepadDeadzone;
    const ax = (i: number) => {
      const v = pad.axes[i] ?? 0;
      return Math.abs(v) < dz ? 0 : (v - Math.sign(v) * dz) / (1 - dz);
    };
    const lx = ax(0), ly = ax(1);
    if (lx !== 0 || ly !== 0 || s.lastSource === 'pad') {
      s.roll = stickCurve(lx);
      s.pitch = stickCurve(ly); // stick back (down on the pad) = nose up
      s.lastSource = 'pad';
    }
    const rx = ax(2), ry = ax(3);
    if (rx !== 0) s.yaw = rx;
    else if (s.lastSource === 'pad') s.yaw = 0;
    if (ry !== 0) s.throttle = Math.max(0, Math.min(1, s.throttle - ry * dt * 0.8));
    const b = (i: number) => !!pad.buttons[i]?.pressed;
    if (b(7) || b(5)) s.fire = true;
    if (b(6)) s.lookBack = true;
    if (b(2)) s.pumpHeld = true;
    if (b(12)) s.throttle = Math.min(1, s.throttle + dt * 0.6);
    if (b(13)) s.throttle = Math.max(0, s.throttle - dt * 0.6);
    const edges: [number, Action][] = [
      [0, 'tallyHo'], [1, 'padlock'], [2, 'gear'], [3, 'flaps'], [4, 'view1'],
      [8, 'map'], [9, 'pause'], [14, 'timeDown'], [15, 'timeUp'], [10, 'boost'], [11, 'start'],
    ];
    for (const [i, a] of edges) {
      if (b(i) && !this.prevButtons[i]) {
        s.push(a);
        if (i === 0) s.push('ok');
        if (i === 1) s.push('back');
      }
    }
    // D-pad doubles as menu navigation.
    if (b(12) && !this.prevButtons[12]) s.push('up');
    if (b(13) && !this.prevButtons[13]) s.push('down');
    if (b(14) && !this.prevButtons[14]) s.push('left');
    if (b(15) && !this.prevButtons[15]) s.push('right');
    this.prevButtons = pad.buttons.map((x) => x.pressed);
  }
}

// ---------------------------------------------------------------- tilt

interface OrientationEventWithPermission {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

export class TiltSource {
  private beta = 0;
  private gamma = 0;
  private refBeta = 0;
  private refGamma = 0;
  private have = false;
  private listening = false;

  constructor(private input: InputState) {}

  /** Must be called from a user gesture (iOS permission prompt). */
  async enable(): Promise<boolean> {
    const DOE = (window as unknown as { DeviceOrientationEvent?: OrientationEventWithPermission }).DeviceOrientationEvent;
    if (!DOE) return false;
    if (typeof DOE.requestPermission === 'function') {
      try {
        if ((await DOE.requestPermission()) !== 'granted') return false;
      } catch {
        return false;
      }
    }
    if (!this.listening) {
      window.addEventListener('deviceorientation', (e) => {
        if (e.beta == null || e.gamma == null) return;
        this.beta = e.beta;
        this.gamma = e.gamma;
        if (!this.have) this.calibrate();
        this.have = true;
      });
      this.listening = true;
    }
    this.input.tiltEnabled = true;
    this.calibrate();
    return true;
  }

  disable(): void {
    this.input.tiltEnabled = false;
  }

  /** Take the current hold angle as neutral. */
  calibrate(): void {
    this.refBeta = this.beta;
    this.refGamma = this.gamma;
  }

  update(): void {
    if (!this.input.tiltEnabled || !this.have) return;
    const angle = (screen.orientation && screen.orientation.angle) ?? (window.orientation as number) ?? 90;
    const range = TUNING.input.tiltRangeDeg;
    let roll: number, pitch: number;
    const db = this.beta - this.refBeta;
    const dg = this.gamma - this.refGamma;
    if (angle === 90) { roll = db; pitch = dg; }
    else if (angle === 270 || angle === -90) { roll = -db; pitch = -dg; }
    else { roll = dg; pitch = -db; }
    this.input.roll = stickCurve(Math.max(-1, Math.min(1, roll / range)));
    this.input.pitch = stickCurve(Math.max(-1, Math.min(1, pitch / range)));
    this.input.lastSource = 'tilt';
  }
}

// ---------------------------------------------------------------- touch

/**
 * The on-screen controls live in the letterbox margins either side of the
 * 5:4 game image, so the view itself is never covered.
 */
export class TouchControls {
  private root: HTMLDivElement;
  private left: HTMLDivElement;
  private right: HTMLDivElement;
  private stickBase: HTMLDivElement;
  private stickKnob: HTMLDivElement;
  private throttleTrack: HTMLDivElement;
  private throttleKnob: HTMLDivElement;
  private ctxBox: HTMLDivElement;
  private fireBtn: HTMLDivElement;
  private smallBox: HTMLDivElement;
  private stickId: number | null = null;
  private stickOX = 0;
  private stickOY = 0;
  private stickR = 60;
  private throttleId: number | null = null;
  private mode: TouchMode = 'menu';
  private ctxKey = '';
  usedTouch = false;
  firing = false;
  lookBackHeld = false;
  private holds = new Map<number, ContextButton['hold']>();

  constructor(private input: InputState, canvas: HTMLCanvasElement) {
    const root = (this.root = el('div', 'touch-root'));
    this.left = el('div', 'zone zone-left');
    this.right = el('div', 'zone zone-right');
    root.append(this.left, this.right);
    document.body.append(root);

    this.stickBase = el('div', 'stick-base');
    this.stickKnob = el('div', 'stick-knob');
    this.left.append(this.stickBase, this.stickKnob);
    this.ctxBox = el('div', 'ctx-box');
    this.left.append(this.ctxBox);

    this.throttleTrack = el('div', 'throttle-track');
    this.throttleKnob = el('div', 'throttle-knob');
    this.throttleTrack.append(this.throttleKnob);
    const tlabel = el('div', 'throttle-label');
    tlabel.textContent = 'THR';
    this.throttleTrack.append(tlabel);
    this.fireBtn = el('div', 'btn btn-fire');
    this.fireBtn.textContent = 'FIRE';
    this.smallBox = el('div', 'small-box');
    this.right.append(this.throttleTrack, this.fireBtn, this.smallBox);

    this.makeSmall('PADLOCK', 'padlock');
    this.makeSmall('LOOK BACK', null, 'lookBack');
    this.makeSmall('TALLY-HO', 'tallyHo');
    this.makeSmall('VIEW', 'view1');
    this.makeSmall('MAP', 'map');
    this.makeSmall('II', 'pause');

    this.left.addEventListener('pointerdown', (e) => this.stickDown(e));
    this.left.addEventListener('pointermove', (e) => this.stickMove(e));
    this.left.addEventListener('pointerup', (e) => this.stickUp(e));
    this.left.addEventListener('pointercancel', (e) => this.stickUp(e));

    this.throttleTrack.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      this.throttleId = e.pointerId;
      this.throttleTrack.setPointerCapture(e.pointerId);
      this.throttleFrom(e);
    });
    this.throttleTrack.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.throttleId) this.throttleFrom(e);
    });
    const tEnd = (e: PointerEvent) => { if (e.pointerId === this.throttleId) this.throttleId = null; };
    this.throttleTrack.addEventListener('pointerup', tEnd);
    this.throttleTrack.addEventListener('pointercancel', tEnd);

    this.fireBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      this.fireBtn.setPointerCapture(e.pointerId);
      this.firing = true;
      this.fireBtn.classList.add('on');
    });
    const fEnd = () => { this.firing = false; this.fireBtn.classList.remove('on'); };
    this.fireBtn.addEventListener('pointerup', fEnd);
    this.fireBtn.addEventListener('pointercancel', fEnd);

    canvas.addEventListener('pointerdown', (e) => {
      const r = canvas.getBoundingClientRect();
      this.input.taps.push({
        x: ((e.clientX - r.left) / r.width) * W,
        y: ((e.clientY - r.top) / r.height) * H,
      });
    });

    window.addEventListener('touchstart', (e) => {
      this.usedTouch = true;
      if (e.touches.length === 3) this.input.push('debug');
    }, { passive: true });
    // Stop the page scrolling/zooming under our fingers.
    document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

    this.setMode('menu');
  }

  private makeSmall(label: string, action: Action | null, hold?: ContextButton['hold']): HTMLDivElement {
    const b = el('div', 'btn btn-small');
    b.textContent = label;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      b.setPointerCapture(e.pointerId);
      b.classList.add('on');
      if (action) this.input.push(action);
      if (hold) this.holds.set(e.pointerId, hold);
    });
    const end = (e: PointerEvent) => { b.classList.remove('on'); this.holds.delete(e.pointerId); };
    b.addEventListener('pointerup', end);
    b.addEventListener('pointercancel', end);
    this.smallBox.append(b);
    return b;
  }

  setMode(mode: TouchMode): void {
    this.mode = mode;
    this.root.dataset.mode = mode;
    if (mode === 'menu') {
      this.firing = false;
      this.stickId = null;
      this.stickBase.style.display = 'none';
      this.stickKnob.style.display = 'none';
    }
  }

  /** Context buttons appear only when relevant (START, GEAR, FLAPS, BAIL OUT, time ×...). */
  setContext(buttons: ContextButton[]): void {
    const key = buttons.map((b) => b.label + (b.lit ? '*' : '')).join('|');
    if (key === this.ctxKey) return;
    this.ctxKey = key;
    this.ctxBox.textContent = '';
    for (const cb of buttons) {
      const b = el('div', 'btn btn-ctx' + (cb.lit ? ' lit' : ''));
      b.textContent = cb.label;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        b.setPointerCapture(e.pointerId);
        b.classList.add('on');
        this.input.push(cb.action);
        if (cb.hold) this.holds.set(e.pointerId, cb.hold);
      });
      const end = (e: PointerEvent) => { b.classList.remove('on'); this.holds.delete(e.pointerId); };
      b.addEventListener('pointerup', end);
      b.addEventListener('pointercancel', end);
      this.ctxBox.append(b);
    }
  }

  private stickDown(e: PointerEvent): void {
    if (this.mode !== 'flight' || this.stickId !== null) return;
    if ((e.target as HTMLElement).classList.contains('btn')) return;
    e.preventDefault();
    this.stickId = e.pointerId;
    this.left.setPointerCapture(e.pointerId);
    const r = this.left.getBoundingClientRect();
    this.stickR = Math.max(36, r.width * TUNING.input.stickRadiusFrac);
    this.stickOX = e.clientX - r.left;
    this.stickOY = e.clientY - r.top;
    this.placeStick(0, 0);
    this.stickBase.style.display = 'block';
    this.stickKnob.style.display = 'block';
  }

  private stickMove(e: PointerEvent): void {
    if (e.pointerId !== this.stickId) return;
    const r = this.left.getBoundingClientRect();
    let dx = (e.clientX - r.left - this.stickOX) / this.stickR;
    let dy = (e.clientY - r.top - this.stickOY) / this.stickR;
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    this.placeStick(dx, dy);
    if (!this.input.tiltEnabled) {
      this.input.roll = stickCurve(dx);
      this.input.pitch = stickCurve(dy); // drag down = stick back = nose up
      this.input.lastSource = 'touch';
    }
  }

  private stickUp(e: PointerEvent): void {
    if (e.pointerId !== this.stickId) return;
    this.stickId = null;
    this.stickBase.style.display = 'none';
    this.stickKnob.style.display = 'none';
    if (!this.input.tiltEnabled) {
      this.input.roll = 0;
      this.input.pitch = 0;
    }
  }

  private placeStick(dx: number, dy: number): void {
    const R = this.stickR;
    Object.assign(this.stickBase.style, {
      left: `${this.stickOX - R}px`, top: `${this.stickOY - R}px`, width: `${2 * R}px`, height: `${2 * R}px`,
    });
    const k = R * 0.45;
    Object.assign(this.stickKnob.style, {
      left: `${this.stickOX + dx * R - k}px`, top: `${this.stickOY + dy * R - k}px`, width: `${2 * k}px`, height: `${2 * k}px`,
    });
  }

  private throttleFrom(e: PointerEvent): void {
    const r = this.throttleTrack.getBoundingClientRect();
    const t = 1 - (e.clientY - r.top) / r.height;
    this.input.throttle = Math.max(0, Math.min(1, t));
    this.input.lastSource = 'touch';
  }

  /** Apply held state each frame and mirror the throttle position. */
  update(): void {
    if (this.firing) this.input.fire = true;
    for (const h of this.holds.values()) {
      if (h === 'pump') this.input.pumpHeld = true;
      if (h === 'lookBack') this.input.lookBack = true;
      if (h === 'brake') this.input.brake = true;
    }
    this.throttleKnob.style.bottom = `${this.input.throttle * 100}%`;
  }

  /** Lay out the zones in the margins around the game image. */
  layout(imgLeft: number, imgWidth: number, vw: number, vh: number): void {
    const margin = imgLeft;
    const narrow = margin < 90;
    this.root.classList.toggle('narrow', narrow);
    const zw = narrow ? Math.max(margin, vw * 0.22) : margin;
    Object.assign(this.left.style, { left: '0px', top: '0px', width: `${zw}px`, height: `${vh}px` });
    Object.assign(this.right.style, { left: `${narrow ? vw - zw : imgLeft + imgWidth}px`, top: '0px', width: `${zw}px`, height: `${vh}px` });
  }
}

function el(tag: 'div', cls: string): HTMLDivElement {
  const d = document.createElement(tag);
  d.className = cls;
  return d;
}

// ---------------------------------------------------------------- haptics

export const haptics = {
  enabled: true,
  pulse(ms: number | number[]): void {
    if (!this.enabled) return;
    try {
      navigator.vibrate?.(ms);
    } catch {
      /* not supported */
    }
  },
};
