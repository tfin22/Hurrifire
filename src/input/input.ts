// Input abstraction. Keyboard, mouse, touch, tilt and gamepad all feed one
// InputState; screens read the state and the per-frame action queue.
// The flight screen converts the state into a quantised ControlFrame per
// simulation tick, which is what gets recorded for replays.

import { TUNING } from '../tuning';

export type Action =
  | 'gear' | 'flaps' | 'padlock' | 'tallyHo'
  | 'order1' | 'order2' | 'order3' | 'order4'
  | 'view1' | 'view2' | 'view3' | 'view4'
  | 'timeUp' | 'timeDown'
  | 'start' | 'primer' | 'mags' | 'starter'
  | 'bailOut' | 'map' | 'debug' | 'pause' | 'help'
  | 'up' | 'down' | 'left' | 'right' | 'ok' | 'back'
  | 'trackCycle' | 'panel' | 'boost' | 'canopy' | 'debugNext' | 'debugAct'
  | 'homing' | 'engineOff' | 'jumpHome';

export interface Tap {
  /** In framebuffer pixels (0..320, 0..256). */
  x: number;
  y: number;
}

export class InputState {
  // Continuous controls, -1..1 (pitch +1 = stick back / nose up; roll +1 = right).
  pitch = 0;
  roll = 0;
  yaw = 0;
  /** 0..1, persistent. */
  throttle = 0.0;
  fire = false;
  lookBack = false;
  /** Gear held (Spitfire hand pump). */
  pumpHeld = false;
  brake = false;
  boost = false;
  // Source flags.
  tiltEnabled = false;
  mouseStick = false;
  // Per-frame queues.
  actions: Action[] = [];
  taps: Tap[] = [];
  /** Throttle changed by an absolute source this frame. */
  lastSource: 'keys' | 'touch' | 'pad' | 'tilt' = 'keys';

  push(a: Action): void {
    this.actions.push(a);
  }
  has(a: Action): boolean {
    return this.actions.includes(a);
  }
  consume(a: Action): boolean {
    const i = this.actions.indexOf(a);
    if (i < 0) return false;
    this.actions.splice(i, 1);
    return true;
  }
  endFrame(): void {
    this.actions.length = 0;
    this.taps.length = 0;
  }
}

/** Soft-centre, firm-edge response curve. */
export function stickCurve(x: number): number {
  const { stickExpo, stickLinear, deadzone } = TUNING.input;
  const a = Math.abs(x);
  if (a < deadzone) return 0;
  const t = Math.min(1, (a - deadzone) / (1 - deadzone));
  const v = stickLinear * t + (1 - stickLinear) * Math.pow(t, stickExpo);
  return Math.sign(x) * v;
}

/** Discrete commands, recorded with the controls so replays are exact. */
export type SimCmd =
  | 'gear' | 'flaps' | 'bailOut' | 'primer' | 'mags' | 'starter' | 'startAll'
  | 'tallyHo' | 'order1' | 'order2' | 'order3' | 'order4' | 'canopy'
  | 'homing' | 'engineOff' | 'jumpHome';

/** Control inputs for one simulation tick, quantised so replays are exact. */
export interface ControlFrame {
  cmds?: SimCmd[];
  pitch: number;
  roll: number;
  yaw: number;
  throttle: number;
  fire: boolean;
  boost: boolean;
  brake: boolean;
  pump: boolean;
}

const q = (v: number) => Math.round(Math.max(-1, Math.min(1, v)) * 127) / 127;

export function quantiseControls(s: InputState): ControlFrame {
  return {
    pitch: q(s.pitch),
    roll: q(s.roll),
    yaw: q(s.yaw),
    throttle: Math.round(Math.max(0, Math.min(1, s.throttle)) * 255) / 255,
    fire: s.fire,
    boost: s.boost,
    brake: s.brake,
    pump: s.pumpHeld,
  };
}

export const neutralControls = (): ControlFrame => ({
  pitch: 0, roll: 0, yaw: 0, throttle: 0, fire: false, boost: false, brake: false, pump: false,
});
