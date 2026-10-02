// Quick Combat setup: aircraft, raid, escort, weather, how many with you.

import type { App, Screen } from '../app';
import type { QuickCombatConfig } from '../game';
import { drawTextCentered } from '../render/font';
import { FrameBuffer, W } from '../render/framebuffer';
import { C } from '../render/palette';
import { fillRect } from '../render/raster';
import { Menu, panel } from './ui';

const RAIDS: QuickCombatConfig['raid'][] = ['bombers', 'stukas', 'big', 'fighters', 'jabo'];
const RAID_NAMES: Record<QuickCombatConfig['raid'], string> = {
  bombers: 'DO 17S / HE 111S', stukas: 'STUKAS OVER A CONVOY', big: '15 SEPTEMBER: LONDON', fighters: '109 FREE HUNT', jabo: 'HIGH 109 JABOS',
};
const WEATHER: QuickCombatConfig['weather'][] = ['clear', 'cumulus', 'cloudy'];
const WINGMEN = [0, 2, 5, 11];

export class QuickCombatScreen implements Screen {
  touchMode = 'menu' as const;
  music = 'title' as const;
  private cfg: QuickCombatConfig = { playerType: 'spitfire', raid: 'bombers', escort: true, weather: 'cumulus', wingmen: 2 };
  private menu: Menu;

  constructor(private app: App, private go: (cfg: QuickCombatConfig) => void, private back: () => void) {
    this.menu = new Menu([], 60, 60, 200, 15);
    this.build();
  }

  private cycle<T>(list: readonly T[], v: T, d: number): T {
    return list[(list.indexOf(v) + d + list.length) % list.length];
  }

  private build(): void {
    const c = this.cfg;
    const sel = this.menu.sel;
    const adj = (f: (d: -1 | 1) => void) => ({ act: () => { f(1); this.build(); }, adjust: (d: -1 | 1) => { f(d); this.build(); } });
    this.menu.items = [
      { label: c.playerType === 'spitfire' ? 'SPITFIRE MK I' : 'HURRICANE MK I', ...adj(() => { c.playerType = c.playerType === 'spitfire' ? 'hurricane' : 'spitfire'; }) },
      { label: RAID_NAMES[c.raid], ...adj((d) => { c.raid = this.cycle(RAIDS, c.raid, d); }) },
      { label: `ESCORT: ${c.escort ? 'YES' : 'NO'}`, ...adj(() => { c.escort = !c.escort; }) },
      { label: `WEATHER: ${c.weather.toUpperCase()}`, ...adj((d) => { c.weather = this.cycle(WEATHER, c.weather, d); }) },
      { label: `WITH YOU: ${c.wingmen}`, ...adj((d) => { c.wingmen = this.cycle(WINGMEN, c.wingmen, d); }) },
      { label: 'SCRAMBLE!', act: () => this.go(this.cfg) },
      { label: 'BACK', act: () => this.back() },
    ];
    this.menu.sel = sel;
  }

  frame(): void {
    const s = this.app.input;
    if (s.consume('back')) { this.back(); return; }
    this.menu.input(s);
  }

  tick(): void {}

  render(fb: FrameBuffer): void {
    fillRect(fb, 0, 0, W, 256, C.SEA_D);
    panel(fb, 40, 30, 240, 150);
    this.menu.draw(fb, 'QUICK COMBAT');
    drawTextCentered(fb, 'START AT HEIGHT NEAR THE RAID. TAP ARROWS OR USE LEFT/RIGHT.', 160, 200, C.CHALK, 'tiny');
  }
}
