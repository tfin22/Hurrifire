// Screen flow and shared game state: the decoded map, the pilot's record,
// and how to get from the title to dispersal to the air to the debrief.

import type { App } from './app';
import { Rng } from './core/rng';
import { Vec3 } from './core/math';
import { worldMap, WorldMap } from './content/world/map';
import { WorldObjects } from './content/world/objects';
import { phaseFor } from './content/raids';
import { CALLSIGNS } from './content/text/rt';
import { PILOT_NAMES } from './content/text/briefing';
import { generateWeather } from './sim/weather';
import { generateRaids, SortieResult, SortieSpec } from './sim/sortie';
import { SkillLevel } from './sim/ai/types';
import { AircraftId } from './content/aircraft';
import { CampaignState, loadCampaign, newCampaign, NewCampaignOpts, saveCampaign, KeyValueStore } from './campaign/campaign';

/** localStorage, or nothing (private windows, blocked storage). */
const store: KeyValueStore = {
  getItem: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  removeItem: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

export interface LogEntry {
  date: string;
  aircraft: string;
  duration: number;
  remarks: string;
}

export interface PilotRecord {
  name: string;
  logbook: LogEntry[];
  sorties: number;
  destroyed: number;
  probable: number;
  damaged: number;
}

const PILOT_KEY = 'scramble.pilot.v1';

export function loadPilot(): PilotRecord {
  try {
    const raw = localStorage.getItem(PILOT_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { name: 'P/O Fenwick', logbook: [], sorties: 0, destroyed: 0, probable: 0, damaged: 0 };
}

export function savePilot(p: PilotRecord): void {
  try { localStorage.setItem(PILOT_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

export interface QuickCombatConfig {
  playerType: AircraftId;
  raid: 'stukas' | 'bombers' | 'big' | 'fighters' | 'jabo';
  escort: boolean;
  weather: 'clear' | 'cumulus' | 'cloudy';
  wingmen: number;
}

/** A squadron's other pilots for one-off sorties (the campaign keeps a real roster). */
export function squadronOthers(rng: Rng, n: number): { name: string; skill: SkillLevel; fatigue: number }[] {
  const ranks = ['F/Lt', 'F/O', 'F/O', 'P/O', 'P/O', 'P/O', 'Sgt', 'Sgt', 'Sgt', 'F/Sgt', 'P/O'];
  const pool = [...PILOT_NAMES.british];
  const out: { name: string; skill: SkillLevel; fatigue: number }[] = [];
  for (let i = 0; i < n; i++) {
    const foreign = rng.chance(0.18);
    const list = foreign ? rng.pick([PILOT_NAMES.polish, PILOT_NAMES.czech, PILOT_NAMES.canadian, PILOT_NAMES.newZealand]) : pool;
    const name = rng.pick(list);
    if (!foreign) pool.splice(pool.indexOf(name), 1);
    out.push({ name: `${ranks[i % ranks.length]} ${name}`, skill: rng.pick(['green', 'average', 'average', 'experte'] as SkillLevel[]), fatigue: rng.range(0, 0.3) });
  }
  return out;
}

/** Created once; screens reach shared state through it. */
export class Game {
  readonly map: WorldMap;
  readonly objects: WorldObjects;
  pilot: PilotRecord;
  lastResult: SortieResult | null = null;
  campaign: CampaignState | null = null;
  campaignProblem: 'version' | 'corrupt' | null = null;

  constructor(readonly app: App) {
    this.map = worldMap();
    this.objects = new WorldObjects(this.map);
    this.pilot = loadPilot();
    const c = loadCampaign(store);
    if (c.ok) this.campaign = c.state;
    else if (c.reason !== 'none') this.campaignProblem = c.reason;
  }

  startCampaign(o: NewCampaignOpts): CampaignState {
    this.campaign = newCampaign((Date.now() & 0x7fffffff) >>> 0, o);
    this.campaignProblem = null;
    this.pilot = { name: `P/O ${o.surname}`, logbook: [], sorties: 0, destroyed: 0, probable: 0, damaged: 0 };
    savePilot(this.pilot);
    this.saveCampaign();
    return this.campaign;
  }

  saveCampaign(): void {
    if (this.campaign) saveCampaign(this.campaign, store);
  }

  /** A "Scramble only" sortie: a random day of the battle, from readiness. */
  randomScramble(seed: number): SortieSpec {
    const rng = new Rng(seed);
    const days: [number, number][] = [[7, 10], [7, 19], [7, 25], [8, 8], [8, 12], [8, 13], [8, 15], [8, 18], [8, 24], [8, 30], [8, 31], [9, 7], [9, 9], [9, 15], [9, 27], [10, 5], [10, 12], [10, 25]];
    const [month, day] = rng.pick(days);
    const phase = phaseFor(month, day);
    const homeName = rng.pick(['Biggin Hill', 'Kenley', 'Hornchurch', 'North Weald', 'Tangmere']);
    const home = this.map.airfieldByName(homeName)!;
    const underAttack = phase === 'airfields' && rng.chance(0.35);
    const weather = generateWeather(rng, month);
    const others = squadronOthers(rng, 11);
    return {
      seed, month, day, hour: 9 + rng.int(9), weather, phase,
      home: homeName, playerType: rng.chance(0.5) ? 'spitfire' : 'hurricane', playerName: this.pilot.name,
      squadron: rng.pick(CALLSIGNS.squadrons), controller: CALLSIGNS.controllers[homeName] ?? 'Sapper',
      leading: true, others, raids: generateRaids(rng, phase, home, this.map, underAttack, phase === 'london' ? 2 : 1),
      start: 'readiness', convergenceM: this.app.settings.convergenceYards * 0.9144, underAttack,
      fatigue: 0, assist: this.app.settings.assist,
    };
  }

  /** Quick Combat: start at height near a raid of the player's choosing. */
  quickCombatSpec(cfg: QuickCombatConfig, seed: number): SortieSpec {
    const rng = new Rng(seed);
    const kind = { stukas: 'channel', bombers: 'airfields', big: 'london', fighters: 'airfields', jabo: 'jabo' }[cfg.raid] as 'channel' | 'airfields' | 'london' | 'jabo';
    const month = kind === 'channel' ? 7 : kind === 'airfields' ? 8 : kind === 'london' ? 9 : 10;
    const day = kind === 'london' ? 15 : 18;
    const home = this.map.airfieldByName('Biggin Hill')!;
    const base = this.randomScramble(seed);
    const raids = generateRaids(rng, kind, home, this.map, false, kind === 'london' ? 2 : 1);
    for (const r of raids) {
      if (cfg.raid === 'fighters') r.groups = r.groups.filter((g) => g.type === 'bf109').map((g) => ({ ...g, role: 'sweep' as const }));
      else if (!cfg.escort) r.groups = r.groups.filter((g) => g.role === 'bomber' || g.role === 'diveBomber' || g.role === 'jabo');
      if (cfg.raid === 'big' && r === raids[0]) {
        // 15 September: thirty-plus bombers and twenty-plus escorts in one go.
        r.groups = [
          { type: 'he111', count: 18, role: 'bomber', altOffset: 0, skill: 'average' },
          { type: 'do17', count: 15, role: 'bomber', altOffset: -200, skill: 'average' },
          ...(cfg.escort ? [
            { type: 'bf110' as const, count: 6, role: 'zerstorer' as const, altOffset: 400, skill: 'average' as const },
            { type: 'bf109' as const, count: 10, role: 'closeEscort' as const, altOffset: 600, skill: 'average' as const },
            { type: 'bf109' as const, count: 12, role: 'topCover' as const, altOffset: 2000, skill: 'experte' as const },
          ] : []),
        ];
      }
      if (cfg.raid === 'stukas') r.groups = [{ type: 'ju87', count: 9, role: 'diveBomber', altOffset: 0, skill: 'average' }, ...r.groups.filter((g) => g.type === 'bf109')];
      r.delay = 0;
      r.start = r.entry.clone().lerp(r.start, 0.25);
    }
    const r = raids[0];
    const p = r.entry.clone().lerp(r.target, 0.15);
    const weather = { ...base.weather };
    if (cfg.weather === 'clear') { weather.cover = 0.03; weather.summary = 'Clear'; }
    if (cfg.weather === 'cumulus') { weather.cover = 0.3; weather.cloudBase = 1500; weather.cloudTop = 2600; }
    if (cfg.weather === 'cloudy') { weather.cover = 0.7; weather.cloudBase = 1000; weather.cloudTop = 2400; }
    return {
      ...base, month, day, phase: kind, weather, playerType: cfg.playerType, raids, start: 'air', underAttack: false,
      others: base.others.slice(0, cfg.wingmen), leading: true,
      airStart: { pos: new Vec3(p.x - 7000, r.alt + 800, p.z - 7000), heading: Math.atan2(r.entry.x - (p.x - 7000), r.entry.z - (p.z - 7000)) },
    };
  }

  /** Record a finished sortie in the pilot's logbook. */
  record(r: SortieResult): void {
    this.lastResult = r;
    const p = this.pilot;
    p.sorties++;
    for (const c of r.claims) if (c.allowed !== 'none') p[c.allowed]++;
    p.logbook.push({ date: r.date, aircraft: r.aircraft, duration: r.durationMin, remarks: r.logLine });
    if (p.logbook.length > 200) p.logbook.shift();
    savePilot(p);
  }
}
