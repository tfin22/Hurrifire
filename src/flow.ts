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
import { QuickCombatScreen } from './screens/quickCombat';
import { CampaignBoardScreen, CampaignEndScreen, CampaignStartScreen, RosterScreen } from './screens/campaign';
import { abortedSortie, applyAirfieldState, applySortie, nextSortieSpec } from './campaign/campaign';
import type { SortieResult } from './sim/sortie';

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

  campaign(): void {
    const g = this.game;
    this.app.setScreen(new CampaignStartScreen(this.app, { state: g.campaign, problem: g.campaignProblem }, {
      resume: () => this.board(),
      begin: (c) => { g.startCampaign(c); this.board(); },
      back: () => this.toTitle(),
    }));
  }

  /** The squadron's readiness board, or the end of the campaign. */
  board(): void {
    const g = this.game;
    const s = g.campaign!;
    if (s.ended) {
      this.app.setScreen(new CampaignEndScreen(this.app, s, () => this.toTitle()));
      return;
    }
    this.app.setScreen(new CampaignBoardScreen(this.app, s, {
      fly: () => this.campaignSortie(),
      roster: () => this.app.setScreen(new RosterScreen(this.app, s, () => this.board())),
      logbook: () => this.app.setScreen(new LogbookScreen(this.app, g, () => this.board())),
      quit: () => { g.saveCampaign(); this.toTitle(); },
      save: () => g.saveCampaign(),
    }));
  }

  private campaignSortie(): void {
    const g = this.game;
    const s = g.campaign!;
    applyAirfieldState(s, g.map);
    const spec = nextSortieSpec(s, g.map, { convergenceM: this.app.settings.convergenceYards * 0.9144, assist: this.app.settings.assist });
    g.pilot.name = spec.playerName;
    this.app.setScreen(new DispersalScreen(this.app, g, spec, (sp) => this.fly(sp, {
      done: (res) => {
        const refly = res.outcome.pilot === 'lost' && !s.ironman;
        if (!refly) g.record(res);
        applySortie(s, res);
        g.saveCampaign();
        this.app.setScreen(new DebriefScreen(this.app, res, () => this.board()));
      },
      quit: () => {
        // Ironman: no walking away from a sortie that's going badly.
        if (s.ironman) { const r = abortedSortie(s, sp); g.record(r); applySortie(s, r); g.saveCampaign(); }
        this.board();
      },
    }), () => this.board()));
  }

  scramble(): void {
    const spec = this.game.randomScramble((Date.now() & 0x7fffffff) >>> 0);
    this.app.setScreen(new DispersalScreen(this.app, this.game, spec, (s) => this.fly(s), () => this.toTitle()));
  }

  quickCombat(): void {
    this.app.setScreen(new QuickCombatScreen(this.app, (cfg) => this.fly(this.game.quickCombatSpec(cfg, (Date.now() & 0x7fffffff) >>> 0)), () => this.toTitle()));
  }

  fly(spec: SortieSpec, campaign?: { done: (r: SortieResult) => void; quit: () => void }): void {
    if (!campaign) for (const af of this.game.map.airfields) { af.craters = []; af.damaged = 0; }
    const sortie = new Sortie(spec, this.game.map, this.game.objects);
    this.app.setScreen(new SortieScreen(this.app, sortie, (res) => {
      if (campaign) { campaign.done(res); return; }
      this.game.record(res);
      this.app.setScreen(new DebriefScreen(this.app, res, () => this.app.setScreen(new LogbookScreen(this.app, this.game, () => this.toTitle()))));
    }, () => (campaign ? campaign.quit() : this.toTitle())));
  }
}
