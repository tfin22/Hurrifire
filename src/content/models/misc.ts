// Small models: parachute, debris, smoke-pall base.

import { ModelBuilder, withLods } from '../../render/model';

/** Parachute canopy and a hanging figure. */
function parachute(detail: number) {
  const b = new ModelBuilder();
  const n = detail === 0 ? 8 : 5;
  const R = 3.2, H = 1.6, top = 7.5;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const p0: [number, number, number] = [Math.cos(a0) * R, top - H, Math.sin(a0) * R];
    const p1: [number, number, number] = [Math.cos(a1) * R, top - H, Math.sin(a1) * R];
    const q0: [number, number, number] = [Math.cos(a0) * R * 0.45, top, Math.sin(a0) * R * 0.45];
    const q1: [number, number, number] = [Math.cos(a1) * R * 0.45, top, Math.sin(a1) * R * 0.45];
    const mid: [number, number, number] = [Math.cos((a0 + a1) / 2), 0.4, Math.sin((a0 + a1) / 2)];
    b.poly(i % 2 ? 'white' : 'chalk', [p0, p1, q1, q0], mid);
    b.poly('chalk', [p0, p1, q1, q0], [-mid[0], -0.4, -mid[2]]);
  }
  b.disc('white', [0, top, 0], R * 0.45, [0, 1, 0], n);
  // Rigging lines are too thin to see; the figure is a small dark box.
  b.box('black', [-0.25, 0, -0.15], [0.25, 1.7, 0.15]);
  return b.build('Parachute');
}

export const parachuteModel = withLods(parachute(0), parachute(1));

/** A tumbling chunk of wreckage. */
function debris() {
  const b = new ModelBuilder();
  b.box('smoke', [-0.6, -0.2, -0.9], [0.6, 0.2, 0.9]);
  return b.build('Debris');
}
export const debrisModel = debris();
