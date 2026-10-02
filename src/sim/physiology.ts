// Pilot G tolerance. Sustained positive G builds "stress" that greys the
// view from the edges, then blacks it out; releasing the G recovers it.
// Negative G gives a brief redout. Applies to AI pilots as well — a blacked
// out pilot's stick goes slack, whoever they are.

import { clamp } from '../core/math';
import { TUNING } from '../tuning';

export class Physiology {
  stress = 0;
  negStress = 0;
  grey = 0;
  black = 0;
  red = 0;
  /** Extra tolerance loss (G): wounds and fatigue. */
  penalty = 0;

  get unconscious(): boolean {
    return this.black > 0.92;
  }

  step(nz: number, dt: number): void {
    const E = TUNING.effects;
    const start = E.greyStartG - this.penalty;
    if (nz > start) this.stress += (nz - start) * E.gTolerancePerSec * dt;
    else this.stress -= (E.gRecoveryPerSec + (start - nz) * 0.15) * dt;
    this.stress = clamp(this.stress, 0, 2.8);
    this.grey = clamp(this.stress / 1.0, 0, 1);
    this.black = clamp((this.stress - 1.3) / 1.0, 0, 1);
    const rs = E.redoutStartG + this.penalty * 0.3;
    if (nz < rs) this.negStress += (rs - nz) * 0.8 * dt;
    else this.negStress -= 0.6 * dt;
    this.negStress = clamp(this.negStress, 0, 1.5);
    this.red = clamp(this.negStress, 0, 1);
  }
}
