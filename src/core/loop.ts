// Fixed-timestep loop: the simulation ticks at exactly 50 Hz (PAL) regardless
// of display refresh; rendering happens once per animation frame.

import { TUNING } from '../tuning';

export interface LoopHooks {
  /** Number of sim ticks to run per real tick (time compression). */
  ticksPerStep(): number;
  frame(realDt: number): void;
  tick(): void;
  render(): void;
  /** Render rate cap in fps (0 = uncapped), for 1990 mode. */
  renderCap(): number;
}

export class FixedLoop {
  private acc = 0;
  private last = 0;
  private renderAcc = 0;
  running = false;
  fps = 0;
  private fpsCount = 0;
  private fpsTime = 0;

  constructor(private hooks: LoopHooks) {}

  start(): void {
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame((t) => this.step(t));
  }

  private step(now: number): void {
    if (!this.running) return;
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.25) dt = 0.25; // tab was asleep
    this.hooks.frame(dt);
    const tdt = TUNING.sim.dt;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= tdt && steps < TUNING.sim.maxStepsPerFrame) {
      const n = this.hooks.ticksPerStep();
      for (let i = 0; i < n; i++) this.hooks.tick();
      this.acc -= tdt;
      steps++;
    }
    if (steps >= TUNING.sim.maxStepsPerFrame) this.acc = 0;
    const cap = this.hooks.renderCap();
    this.renderAcc += dt;
    if (cap <= 0 || this.renderAcc >= 1 / cap - 0.002) {
      this.renderAcc = cap > 0 ? Math.max(0, this.renderAcc - 1 / cap) : 0;
      this.hooks.render();
      this.fpsCount++;
    }
    this.fpsTime += dt;
    if (this.fpsTime >= 1) {
      this.fps = this.fpsCount / this.fpsTime;
      this.fpsCount = 0;
      this.fpsTime = 0;
    }
    requestAnimationFrame((t) => this.step(t));
  }
}
