// Navigation between screens.

import type { App } from './app';
import { Game } from './game';
import { allModels } from './content/models';
import { BenchScreen } from './screens/bench';
import { DebriefScreen, LogbookScreen, SettingsScreen } from './screens/debrief';
import { DispersalScreen } from './screens/dispersal';
import { TitleScreen } from './screens/menu';
import { SortieScreen } from './screens/sortieScreen';
import { arcadeSpec, Sortie, SortieSpec } from './sim/sortie';
import { QuickCombatScreen } from './screens/quickCombat';
import { CampaignBoardScreen, CampaignEndScreen, CampaignStartScreen, PostingsScreen, RosterScreen } from './screens/campaign';
import { abortedSortie, applyAirfieldState, applySortie, nextSortieSpec } from './campaign/campaign';
import type { SortieResult } from './sim/sortie';
import { ReplayScreen } from './screens/replay';
import { ManualScreen } from './screens/manual';
import { FlownSortie } from './screens/sortieScreen';
import { EscortSortie, EscortSpec } from './sim/escort';
import { Rng } from './core/rng';
import { generateWeather } from './sim/weather';

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
      manual: () => this.app.setScreen(new ManualScreen(this.app, () => this.toTitle())),
      modelViewer: () => this.app.setScreen(new BenchScreen(this.app, () => this.toTitle(), allModels())),
      escort: () => this.escort(),
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
      postings: () => this.app.setScreen(new PostingsScreen(this.app, s, () => this.board(), () => g.saveCampaign())),
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
      done: (res, replay) => {
        const refly = res.outcome.pilot === 'lost' && !s.ironman;
        if (!refly) g.record(res);
        applySortie(s, res);
        g.saveCampaign();
        const debrief: DebriefScreen = new DebriefScreen(this.app, res, () => this.board(), () => replay(() => this.app.setScreen(debrief)));
        this.app.setScreen(debrief);
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

  fly(spec: SortieSpec, campaign?: { done: (r: SortieResult, replay: (back: () => void) => void) => void; quit: () => void }): void {
    // Arcade: straight into the air near the raid, against a less skilled enemy.
    if (this.app.settings.arcade) spec = arcadeSpec(spec, this.app.settings.arcadeTakeoff);
    if (!campaign) for (const af of this.game.map.airfields) { af.craters = []; af.damaged = 0; }
    this.flySortie(() => new Sortie(spec, this.game.map, this.game.objects), (res, replay) => {
      if (campaign) { campaign.done(res, replay); return; }
      this.game.record(res);
      const debrief: DebriefScreen = new DebriefScreen(this.app, res, () => this.app.setScreen(new LogbookScreen(this.app, this.game, () => this.toTitle())), () => replay(() => this.app.setScreen(debrief)));
      this.app.setScreen(debrief);
    }, () => (campaign ? campaign.quit() : this.toTitle()));
  }

  /** The other side: a 109 escort to London and back, on one of the big days. */
  escort(): void {
    const seed = (Date.now() & 0x7fffffff) >>> 0;
    const rng = new Rng(seed);
    const [month, day] = rng.pick([[8, 24], [8, 30], [9, 7], [9, 9], [9, 11], [9, 15], [9, 27], [9, 30]] as [number, number][]);
    const weather = generateWeather(rng, month);
    weather.cover = Math.min(weather.cover, 0.45);
    const spec: EscortSpec = {
      seed, month, day, hour: 11 + rng.int(5), weather, playerName: 'Lt Brandt', colour: rng.pick(['Gelb', 'Rot', 'Weiss', 'Schwarz']),
      convergenceM: 300, assist: this.app.settings.assist,
    };
    this.flySortie(() => new EscortSortie(spec, this.game.map, this.game.objects), (res, replay) => {
      const debrief: DebriefScreen = new DebriefScreen(this.app, res, () => this.toTitle(), () => replay(() => this.app.setScreen(debrief)));
      this.app.setScreen(debrief);
    }, () => this.toTitle());
  }

  private flySortie(make: () => FlownSortie, done: (r: SortieResult, replay: (back: () => void) => void) => void, quit: () => void): void {
    const sortie = make();
    const screen: SortieScreen = new SortieScreen(this.app, sortie, (res) => done(res, (back) => this.replay(sortie, make, screen, back)), quit);
    this.app.setScreen(screen);
  }

  /** Re-run a finished sortie from its seed and recorded controls. */
  private replay(sortie: FlownSortie, make: () => FlownSortie, flown: SortieScreen, back: () => void): void {
    sortie.rewind();
    const again = make();
    this.app.setScreen(new ReplayScreen(this.app, again, flown.recording, { autoRudder: flown.world.autoRudder, stallGuard: flown.world.stallGuard, bigTargets: flown.world.bigTargets, arcade: flown.world.arcade, enemyLevel: flown.world.enemyLevel }, back));
  }
}
