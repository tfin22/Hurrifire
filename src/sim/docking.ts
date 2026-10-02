// The "docking computer" (Assist and Arcade): after a homing, jump straight
// to a long final approach for the field, lined up into the wind with the
// wheels and flaps down, and let the approach autopilot land her. Move the
// stick and you have her back. Not remotely period: a convenience for when
// the fight is over and the flight home is just a flight home.

import { Vec3 } from '../core/math';
import { stallSpeed } from '../content/aircraft';
import type { ControlFrame, SimCmd } from '../input/input';
import { TUNING } from '../tuning';
import { ApproachTarget, flyApproach } from './ai/approach';
import { idleControls } from './ai/pilot';
import type { Plane } from './plane';
import type { Homing } from './sortie';
import type { World } from './world';

export class DockingComputer {
  /** Flying the approach for the player. */
  active = false;
  target: ApproachTarget | null = null;
  private ctl = idleControls(0);
  private switchedOff = false;

  /** Why the jump can't be made now, or null if it can. */
  static refuse(world: World, p: Plane, homing: Homing | null): string | null {
    if (!homing) return 'ASK FOR A HOMING FIRST';
    if (p.status !== 'flying' || p.fs.onGround) return 'NOT IN THE AIR';
    for (const q of world.planes) {
      if (q.side !== p.side && q.alive && q.pos.distTo(p.pos) < TUNING.docking.clearOfEnemy) return 'NOT WITH THE ENEMY ABOUT';
    }
    return null;
  }

  /** Put the player on a long final for the homing field. */
  engage(p: Plane, h: Homing): void {
    const D = TUNING.docking;
    const f = h.field, dir = h.landDir;
    const dx = Math.sin(dir), dz = Math.cos(dir);
    // Touch down a little way into the landing run.
    const tx = f.pos.x - dx * (f.len / 2 - D.touchdownIn), tz = f.pos.z - dz * (f.len / 2 - D.touchdownIn);
    this.target = { x: tx, z: tz, h: f.pos.y, dir };
    const fs = p.fs;
    const vApp = stallSpeed(p.type, fs.mass, 1.225, 1) * 1.3;
    const start = new Vec3(tx - dx * D.finalM, f.pos.y + p.type.gearHeight + D.finalM * 0.075, tz - dz * D.finalM);
    fs.setAirborne(start, dir, vApp, -0.04);
    fs.gear = fs.gearCmd = 1;
    fs.flaps = fs.flapsCmd = 1;
    fs.throttle = 0.35;
    p.prevPos.copy(p.pos);
    this.active = true;
    this.switchedOff = false;
  }

  /** The controls for this tick: the autopilot's, unless the pilot takes over. */
  control(p: Plane, f: ControlFrame | null): ControlFrame | null {
    if (!this.active || !this.target || !f) return f;
    if (Math.abs(f.pitch) > TUNING.docking.takeOver || Math.abs(f.roll) > TUNING.docking.takeOver || p.status !== 'flying') {
      this.active = false;
      return f;
    }
    const c = this.ctl;
    flyApproach(p.fs, this.target, c, { glide: p.fs.engine !== 'running' });
    const cmds: SimCmd[] = [...(f.cmds ?? [])];
    // Down and nearly stopped: switch off, and the sortie is over.
    if (p.fs.onGround && Math.hypot(p.fs.vel.x, p.fs.vel.z) < 4 && !this.switchedOff) { cmds.push('engineOff'); this.switchedOff = true; }
    return { pitch: c.pitch, roll: c.roll, yaw: c.yaw, throttle: c.throttle, fire: false, boost: false, brake: c.brake, pump: false, ...(cmds.length ? { cmds } : {}) };
  }
}
