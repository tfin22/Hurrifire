// Screen flow and shared game state: the decoded map, the pilot's record,
// and how to get from the title to dispersal to the air to the debrief.

import type { App } from './app';
import { Rng } from './core/rng';
import { worldMap, WorldMap } from './content/world/map';
import { WorldObjects } from './content/world/objects';
import { phaseFor } from './content/raids';
import { CALLSIGNS } from './content/text/rt';
import { generateWeather } from './sim/weather';
import { generateRaids, SortieResult, SortieSpec } from './sim/sortie';
import { SkillLevel } from './sim/ai/types';
import { AircraftId } from './content/aircraft';

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

/** Created once; screens reach shared state through it. */
export class Game {
  readonly map: WorldMap;
  readonly objects: WorldObjects;
  pilot: PilotRecord;
  lastResult: SortieResult | null = null;

  constructor(readonly app: App) {
    this.map = worldMap();
    this.objects = new WorldObjects(this.map);
    this.pilot = loadPilot();
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
    const others: { name: string; skill: SkillLevel; fatigue: number }[] = [
      { name: 'F/O Ashworth', skill: 'average', fatigue: 0.2 },
      { name: 'Sgt Bellamy', skill: 'green', fatigue: 0.1 },
    ];
    return {
      seed, month, day, hour: 9 + rng.int(9), weather, phase,
      home: homeName, playerType: rng.chance(0.5) ? 'spitfire' : 'hurricane', playerName: this.pilot.name,
      squadron: rng.pick(CALLSIGNS.squadrons), controller: CALLSIGNS.controllers[homeName] ?? 'Sapper',
      leading: true, others, raids: generateRaids(rng, phase, home, this.map, underAttack, phase === 'london' ? 2 : 1),
      start: 'readiness', convergenceM: this.app.settings.convergenceYards * 0.9144, underAttack,
      fatigue: 0, assist: this.app.settings.assist,
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
