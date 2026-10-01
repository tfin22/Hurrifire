// Milestone 1 test card: palette, copper bands, input readout. Reachable from
// the debug menu; kept as a quick sanity check for the display path.

import type { App, Screen } from '../app';
import { FrameBuffer, W } from '../render/framebuffer';
import { fillRect, rectOutline, circle, line } from '../render/raster';
import { drawText } from '../render/font';
import { C, COPPER_BASE } from '../render/palette';

export class TestCardScreen implements Screen {
  touchMode = 'flight' as const;
  private t = 0;

  constructor(private app: App, private onExit?: () => void) {}

  frame(): void {
    if (this.app.input.consume('back') || this.app.input.consume('pause')) this.onExit?.();
  }

  tick(): void {
    this.t++;
  }

  render(fb: FrameBuffer): void {
    fb.clear(C.BLACK);
    // Copper gradient across the top half.
    const cop = this.app.display.copper;
    for (let i = 0; i < 224; i++) {
      const k = i / 223;
      cop[i * 3] = 40 + 120 * k; cop[i * 3 + 1] = 70 + 130 * k; cop[i * 3 + 2] = 140 + 100 * k;
    }
    for (let y = 0; y < 128; y++) fillRect(fb, 0, y, W, 1, COPPER_BASE + Math.floor((y / 127) * 223));
    for (let i = 0; i < 32; i++) fillRect(fb, (i % 16) * 20, 132 + Math.floor(i / 16) * 20, 20, 20, i);
    rectOutline(fb, 0, 132, 320, 40, C.WHITE);
    const s = this.app.input;
    drawText(fb, 'SCRAMBLE! TEST CARD', 8, 8, C.WHITE, 'topaz', C.BLACK);
    drawText(fb, `pitch ${s.pitch.toFixed(2)} roll ${s.roll.toFixed(2)} yaw ${s.yaw.toFixed(2)}`, 8, 180, C.WHITE);
    drawText(fb, `thr ${s.throttle.toFixed(2)} fire ${s.fire ? 'Y' : 'n'} back ${s.lookBack ? 'Y' : 'n'}`, 8, 192, C.WHITE);
    drawText(fb, `fps ${this.app.loop.fps.toFixed(1)}  tick ${this.t}`, 8, 204, C.SIGHT);
    drawText(fb, 'Logbook hand: Engaged He 111s.', 8, 220, C.CHALK, 'hand');
    drawText(fb, '0123456789 ANGELS 20 MPH', 8, 236, C.SIGHT, 'tiny');
    const cx = 260, cy = 210;
    circle(fb, cx, cy, 20, C.SIGHT);
    line(fb, cx, cy, cx + s.roll * 20, cy + s.pitch * 20, C.WHITE);
  }
}
