// Navigation between screens.

import type { App } from './app';
import { Game } from './game';
import { allModels } from './content/models';
import { BenchScreen } from './screens/bench';
import { DebriefScreen, LogbookScreen, SettingsScreen } from './screens/debrief';
import { DispersalScreen } from './screens/dispersal';
import { TitleScreen } from './screens/menu';
import { SortieScreen } from './screens/sortieScreen';
import { Sortie, SortieSpec } from './sim/sortie';
import { Vec3 } from './core/math';

export class Flow {
  readonly game: Game;
  constructor(readonly app: App) {
    this.game = new Game(app);
  }

  title(): TitleScreen {
    return new TitleScreen(this.app, this.game, {
      campaign: () => this.campaign(),
      scramble: () => this.scramble(),
      quickCombat: () => this.quickCombat(),
      logbook: () => this.app.setScreen(new LogbookScreen(this.app, this.game, () => this.toTitle())),
      settings: () => this.app.setScreen(new SettingsScreen(this.app, () => this.toTitle())),
      modelViewer: () => this.app.setScreen(new BenchScreen(this.app, () => this.toTitle(), allModels())),
    });
  }

  toTitle(): void {
    this.app.setScreen(this.title());
  }

  /** Campaign: wired up in milestone 9; until then a random day. */
  campaign(): void {
    this.scramble();
  }

  scramble(): void {
    const spec = this.game.randomScramble((Date.now() & 0x7fffffff) >>> 0);
    this.app.setScreen(new DispersalScreen(this.app, this.game, spec, (s) => this.fly(s), () => this.toTitle()));
  }

  quickCombat(): void {
    const spec = this.game.randomScramble((Date.now() & 0x7fffffff) >>> 0);
    const r = spec.raids[0];
    spec.start = 'air';
    // Start at height, a few miles off the raid's track.
    const p = r.entry.clone().lerp(r.target, 0.3);
    spec.airStart = { pos: new Vec3(p.x - 6000, r.alt + 600, p.z - 6000), heading: Math.atan2(r.start.x - p.x, r.start.z - p.z) };
    for (const rs of spec.raids) { rs.delay = 0; rs.start = r.entry.clone().lerp(r.start, 0.3); }
    this.fly(spec);
  }

  fly(spec: SortieSpec): void {
    const sortie = new Sortie(spec, this.game.map, this.game.objects);
    this.app.setScreen(new SortieScreen(this.app, sortie, (res) => {
      this.game.record(res);
      this.app.setScreen(new DebriefScreen(this.app, res, () => this.app.setScreen(new LogbookScreen(this.app, this.game, () => this.toTitle()))));
    }, () => this.toTitle()));
  }
}
