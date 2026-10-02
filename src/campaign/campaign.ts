// The campaign, July to October 1940: the days, the squadron's roster and
// aircraft, the player's rank, the sector's airfields, and the score.
// Pure state and rules (no DOM); the screens drive it and save it.
//
// Only the big days are flown. The days between pass off-screen: the
// squadron flies, loses pilots, claims, gets replacements and rests, and the
// airfields are bombed and repaired.

import { hash3, Rng } from '../core/rng';
import { phaseFor } from '../content/raids';
import type { Phase } from '../content/text/briefing';
import { CALLSIGNS } from '../content/text/rt';
import { PILOT_NAMES } from '../content/text/briefing';
import { CAMPAIGN_DAYS, NEWS, RANK_NAMES, VERDICTS } from '../content/text/campaign';
import type { WorldMap } from '../content/world/map';
import { SkillLevel } from '../sim/ai/types';
import { generateWeather, DayWeather } from '../sim/weather';
import { generateRaids, SortieResult, SortieSpec, SquadronPilot } from '../sim/sortie';
import { TUNING } from '../tuning';

export const CAMPAIGN_VERSION = 1;
export const CAMPAIGN_KEY = 'scramble.campaign';

export type Rank = keyof typeof RANK_NAMES;
export type Nation = 'british' | 'polish' | 'czech' | 'canadian' | 'newZealand' | 'australian' | 'southAfrican';

export interface RosterPilot {
  id: number;
  rank: string;
  surname: string;
  nation: Nation;
  skill: SkillLevel;
  sorties: number;
  kills: number;
  fatigue: number;
  status: 'fit' | 'wounded' | 'lost' | 'pow' | 'posted';
  /** Day of year when fit again. */
  backOn?: number;
  /** CO, or a flight commander. */
  role?: 'CO' | 'A' | 'B';
}

export interface CampaignPlayer {
  surname: string;
  rank: Rank;
  sorties: number;
  sortiesAtRank: number;
  destroyed: number;
  probable: number;
  damaged: number;
  fatigue: number;
  minutes: number;
  status: 'fit' | 'wounded' | 'killed' | 'pow';
  backOn?: number;
  /** Reprimands: sound aircraft put down in fields. Each holds promotion back. */
  writeUps?: number;
}

export interface CampaignState {
  version: number;
  seed: number;
  ironman: boolean;
  home: string;
  squadron: string;
  aircraft: 'hurricane' | 'spitfire';
  /** Index into CAMPAIGN_DAYS. */
  dayIdx: number;
  sortieOfDay: number;
  /** Re-flights of the current sortie (not Ironman). */
  retries: number;
  player: CampaignPlayer;
  roster: RosterPilot[];
  nextId: number;
  aircraftServiceable: number;
  /** Days left for each aircraft in repair. */
  repairs: number[];
  /** Damage 0..1 of each sector station. */
  airfields: Record<string, number>;
  formation: 'vic' | 'pairs';
  pairsOffered: boolean;
  stats: {
    raidsTurned: number;
    raidsBombed: number;
    airfieldDays: number;
    airfieldOpenDays: number;
    lost: number;
    pilotsTotal: number;
    squadronKills: number;
    sorties: number;
  };
  /** News since the player last looked at the board. */
  news: string[];
  ended: null | 'october' | 'killed' | 'pow';
}

export const SECTOR_STATIONS = ['Biggin Hill', 'Kenley', 'Hornchurch', 'North Weald', 'Northolt', 'Tangmere', 'Debden'];
export const PAIRS_FROM = dayOfYear(8, 13);

export function dayOfYear(month: number, day: number): number {
  const start = [0, 0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  return start[month] + day;
}

function fromDayOfYear(doy: number): [number, number] {
  const start = [0, 0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365];
  let m = 1;
  while (doy > start[m + 1]) m++;
  return [m, doy - start[m]];
}

const END_OF_CAMPAIGN = dayOfYear(10, 31);

// ------------------------------------------------------------------ setup

export interface NewCampaignOpts {
  surname: string;
  home: string;
  aircraft: 'hurricane' | 'spitfire';
  ironman: boolean;
}

export function newCampaign(seed: number, o: NewCampaignOpts): CampaignState {
  const rng = new Rng(seed);
  const s: CampaignState = {
    version: CAMPAIGN_VERSION, seed, ironman: o.ironman, home: o.home,
    squadron: rng.pick(CALLSIGNS.squadrons), aircraft: o.aircraft,
    dayIdx: 0, sortieOfDay: 0, retries: 0,
    player: { surname: o.surname, rank: 'P/O', sorties: 0, sortiesAtRank: 0, destroyed: 0, probable: 0, damaged: 0, fatigue: 0, minutes: 0, status: 'fit' },
    roster: [], nextId: 1,
    aircraftServiceable: TUNING.campaign.startAircraft, repairs: [],
    airfields: Object.fromEntries(SECTOR_STATIONS.map((n) => [n, 0])),
    formation: 'vic', pairsOffered: false,
    stats: { raidsTurned: 0, raidsBombed: 0, airfieldDays: 0, airfieldOpenDays: 0, lost: 0, pilotsTotal: 0, squadronKills: 0, sorties: 0 },
    news: [], ended: null,
  };
  const ranks = ['S/Ldr', 'F/Lt', 'F/Lt', 'F/O', 'F/O', 'F/O', 'P/O', 'P/O', 'P/O', 'P/O', 'Sgt', 'Sgt', 'Sgt', 'Sgt', 'F/Sgt', 'Sgt', 'P/O', 'Sgt'];
  for (let i = 0; i < TUNING.campaign.startPilots - 1; i++) {
    const p = makePilot(s, rng, ranks[i % ranks.length], i < 3 ? 'experte' : i < 9 ? 'average' : rng.pick(['green', 'average'] as SkillLevel[]), 0.05);
    p.sorties = i < 3 ? 40 + rng.int(30) : i < 9 ? 10 + rng.int(20) : rng.int(8);
    p.kills = i < 3 ? 2 + rng.int(5) : i < 9 ? rng.int(3) : 0;
    if (i === 0) p.role = 'CO';
    if (i === 1) p.role = 'A';
    if (i === 2) p.role = 'B';
  }
  s.stats.pilotsTotal = s.roster.length + 1;
  startDay(s);
  return s;
}

function makePilot(s: CampaignState, rng: Rng, rank: string, skill: SkillLevel, foreignChance: number): RosterPilot {
  const foreign = rng.chance(foreignChance);
  const nation: Nation = foreign ? rng.pick(['polish', 'czech', 'canadian', 'newZealand', 'australian', 'southAfrican'] as Nation[]) : 'british';
  const taken = new Set([...s.roster.map((p) => p.surname), s.player.surname]);
  const pool = PILOT_NAMES[nation].filter((n) => !taken.has(n));
  const surname = pool.length ? rng.pick(pool) : `${rng.pick(PILOT_NAMES.british)}-${rng.pick(PILOT_NAMES.british)}`;
  const p: RosterPilot = { id: s.nextId++, rank, surname, nation, skill, sorties: 0, kills: 0, fatigue: 0, status: 'fit' };
  s.roster.push(p);
  return p;
}

// ------------------------------------------------------------------ the day

export function campaignDate(s: CampaignState): { month: number; day: number } {
  const [month, day] = CAMPAIGN_DAYS[Math.min(s.dayIdx, CAMPAIGN_DAYS.length - 1)];
  return { month, day };
}

export function currentDoy(s: CampaignState): number {
  const d = campaignDate(s);
  return dayOfYear(d.month, d.day);
}

export function campaignPhase(s: CampaignState): Phase {
  const d = campaignDate(s);
  return phaseFor(d.month, d.day);
}

export function dayWeather(s: CampaignState): DayWeather {
  const d = campaignDate(s);
  return generateWeather(new Rng(hash3(s.seed, d.month, d.day)), d.month);
}

/** Sorties the squadron flies today: 1 to 3. */
export function sortiesToday(s: CampaignState): number {
  const d = campaignDate(s);
  if (d.month === 9 && d.day === 15) return 2;
  const rng = new Rng(hash3(s.seed, d.month * 31 + d.day, 7));
  const w = dayWeather(s);
  if (w.cover > 0.8) return 1;
  const phase = campaignPhase(s);
  return phase === 'airfields' ? 2 + rng.int(2) : phase === 'london' ? 1 + rng.int(3) : 1 + rng.int(2);
}

export function playerName(s: CampaignState): string {
  return `${s.player.rank} ${s.player.surname}`;
}

export const pilotName = (p: RosterPilot) => `${p.rank} ${p.surname}`;

export function fitPilots(s: CampaignState): RosterPilot[] {
  return s.roster.filter((p) => p.status === 'fit' && p.fatigue < TUNING.campaign.fatigueRest);
}

/** Who flies with the player: the CO leads unless it's the player; a flight commander takes his flight. */
export function formationFor(s: CampaignState): { leading: boolean; others: RosterPilot[] } {
  const T = TUNING.campaign;
  const rank = s.player.rank;
  const leading = rank !== 'P/O';
  const size = Math.min(rank === 'F/Lt' ? T.flightSize : T.squadronSize, s.aircraftServiceable);
  const fit = fitPilots(s);
  const order = (p: RosterPilot) => (p.role === 'CO' ? 0 : p.role ? 1 : 2) * 10 + p.fatigue;
  let pool = [...fit].sort((a, b) => order(a) - order(b) || a.id - b.id);
  // Leading a flight: B Flight's pilots, not the CO.
  if (rank === 'F/Lt') pool = pool.filter((p) => p.role !== 'CO' && p.role !== 'A');
  return { leading, others: pool.slice(0, Math.max(0, size - 1)) };
}

/** The next sortie's spec. */
export function nextSortieSpec(s: CampaignState, map: WorldMap, opts: { convergenceM: number; assist: boolean }): SortieSpec {
  const d = campaignDate(s);
  const phase = campaignPhase(s);
  const seed = hash3(s.seed, s.dayIdx * 8 + s.sortieOfDay, s.retries + 1) >>> 0;
  const rng = new Rng(seed);
  const home = map.airfieldByName(s.home)!;
  const underAttack = phase === 'airfields' && rng.chance(0.3);
  const big = d.month === 9 && d.day === 15;
  const { leading, others } = formationFor(s);
  const hours = [[8, 11], [12, 15], [16, 18]][Math.min(2, s.sortieOfDay)];
  const toSp = (p: RosterPilot): SquadronPilot => ({ id: p.id, name: pilotName(p), skill: p.skill, fatigue: p.fatigue });
  return {
    seed, month: d.month, day: d.day, hour: hours[0] + rng.int(hours[1] - hours[0] + 1),
    weather: dayWeather(s), phase, home: s.home, playerType: s.aircraft, playerName: playerName(s),
    squadron: s.squadron, controller: CALLSIGNS.controllers[s.home] ?? 'Sapper',
    leading, others: others.map(toSp),
    raids: generateRaids(rng, phase, home, map, underAttack, big ? 2 : 1),
    start: 'readiness', convergenceM: opts.convergenceM, underAttack,
    fatigue: s.player.fatigue, assist: opts.assist, formation: s.formation,
  };
}

/** Put each sector station's craters on the map to match its damage. */
export function applyAirfieldState(s: CampaignState, map: WorldMap): void {
  for (const af of map.airfields) {
    const dmg = s.airfields[af.name] ?? 0;
    const n = Math.round(dmg * 30);
    af.craters = [];
    af.damaged = 0;
    for (let i = 0; i < n; i++) {
      const h = hash3(s.seed, af.name.length * 1000 + i, s.dayIdx);
      const u = ((h & 0xffff) / 0xffff - 0.5) * 1.6, v = (((h >>> 16) & 0xffff) / 0xffff - 0.5) * 1.6;
      af.craters.push({ x: af.pos.x + u * af.half, z: af.pos.z + v * af.half, r: 6 + (h % 5) });
    }
  }
}

// ------------------------------------------------------------------ after a sortie

/** Fold a flown sortie into the campaign. Returns the news to show. */
export function applySortie(s: CampaignState, r: SortieResult): string[] {
  const T = TUNING.campaign;
  const news: string[] = [];
  const rng = new Rng(hash3(s.seed, s.dayIdx * 8 + s.sortieOfDay, 99));
  const P = s.player;
  const o = r.outcome;
  if (o.pilot === 'lost') {
    if (!s.ironman) {
      s.retries++;
      news.push(NEWS.refly);
      s.news.push(...news);
      return news;
    }
    P.status = o.kind === 'pow' ? 'pow' : 'killed';
    s.ended = P.status;
  }
  s.retries = 0;
  // The player.
  P.sorties++;
  P.sortiesAtRank++;
  P.minutes += r.durationMin;
  P.fatigue = Math.min(1, P.fatigue + T.fatiguePerSortie);
  for (const c of r.claims) if (c.allowed !== 'none') P[c.allowed]++;
  if (o.pilot === 'wounded' && !s.ended) {
    const days = T.woundedDays[0] + rng.int(T.woundedDays[1] - T.woundedDays[0] + 1);
    P.status = 'wounded';
    P.backOn = currentDoy(s) + days;
    news.push(NEWS.youWounded(days));
  }
  // Aircraft.
  const hurt = (days: number) => { s.aircraftServiceable--; s.repairs.push(days); };
  if (o.aircraft === 'writeOff') s.aircraftServiceable--;
  else if (o.aircraft === 'repairable') hurt(3 + rng.int(4));
  else if (o.aircraft === 'damaged') hurt(1 + rng.int(3));
  else if (o.aircraft === 'minor') hurt(1);
  else if (o.kind === 'forced') { hurt(1); news.push(NEWS.aircraftRecovered); }
  if (o.writtenUp && !s.ended) {
    P.writeUps = (P.writeUps ?? 0) + 1;
    news.push(NEWS.writtenUp(P.writeUps));
  }
  // The others.
  for (const f of r.fates) {
    const p = s.roster.find((q) => q.id === f.id);
    if (!p) continue;
    p.sorties++;
    p.kills += f.kills;
    p.fatigue = Math.min(1, p.fatigue + T.fatiguePerSortie);
    if (f.fate === 'lost' || f.fate === 'pow') { p.status = f.fate; s.stats.lost++; s.aircraftServiceable--; }
    else if (f.fate === 'safe') s.aircraftServiceable--;
    else if (f.fate === 'wounded') { p.status = 'wounded'; p.backOn = currentDoy(s) + 5 + rng.int(10); hurt(2 + rng.int(3)); }
    else if (f.fate === 'damaged') hurt(1 + rng.int(3));
    improve(p);
  }
  s.aircraftServiceable = Math.max(0, s.aircraftServiceable);
  // The raid and the airfields.
  s.stats.raidsTurned += r.raidsTurned;
  s.stats.raidsBombed += r.raidsBombed;
  s.stats.squadronKills += r.squadronKills + r.claims.filter((c) => c.allowed === 'destroyed').length;
  s.stats.sorties++;
  for (const [name, hits] of Object.entries(r.airfieldHits)) {
    if (!(name in s.airfields)) continue;
    const was = s.airfields[name];
    s.airfields[name] = Math.min(1, was + hits * T.damagePerBomb);
    if (was < T.closedAt && s.airfields[name] >= T.closedAt) news.push(NEWS.airfieldClosed(name));
  }
  news.push(...vacancies(s, rng));
  news.push(...promotion(s));
  // On to the next sortie, or the next day.
  if (!s.ended) {
    s.sortieOfDay++;
    if (s.sortieOfDay >= sortiesToday(s) || P.status === 'wounded') news.push(...nextDay(s));
  }
  s.news.push(...news);
  return news;
}

function improve(p: RosterPilot): void {
  const T = TUNING.campaign;
  if (p.skill === 'green' && p.sorties >= T.averageAfter) p.skill = 'average';
  if (p.skill === 'average' && p.sorties >= T.experteAfter && p.kills >= T.experteKills) p.skill = 'experte';
}

/** Ironman: leaving a sortie part way counts as turning back with a rough engine. */
export function abortedSortie(s: CampaignState, spec: SortieSpec): SortieResult {
  const d = campaignDate(s);
  return {
    date: `${d.day}/${d.month}/1940`, aircraft: s.aircraft === 'spitfire' ? 'Spitfire I' : 'Hurricane I', durationMin: 20, takeoffDelay: -1,
    claims: [], roundsFired: 0, damageTaken: 0, damageNotes: [],
    outcome: { kind: 'landed', pilot: 'fine', aircraft: 'minor', place: s.home, line: 'Returned early, engine rough.' },
    raidNotes: [], raidsTurned: 0, raidsBombed: spec.raids.length, bombsOnTargetKg: 0, losses: [], enemyDown: 0,
    logLine: 'Returned early, engine running rough. Nothing found by the fitters.', rtLog: [], engaged: false,
    fates: spec.others.map((o) => ({ id: o.id ?? -1, name: o.name, fate: 'ok' as const, kills: 0 })), squadronKills: 0, airfieldHits: {},
  };
}

// ------------------------------------------------------------------ rank

/** Fill the CO's and flight commanders' posts left by losses. */
function vacancies(s: CampaignState, rng: Rng): string[] {
  const T = TUNING.campaign;
  const news: string[] = [];
  const P = s.player;
  const holder = (role: 'CO' | 'A' | 'B') => s.roster.find((p) => p.role === role && p.status !== 'lost' && p.status !== 'pow' && p.status !== 'posted');
  const senior = () => s.roster.filter((p) => p.status === 'fit' && !p.role).sort((a, b) => b.sorties - a.sorties || a.id - b.id)[0];
  // The CO.
  const co = holder('CO');
  if (!co && P.rank !== 'S/Ldr') {
    const gone = s.roster.find((p) => p.role === 'CO');
    if (gone) gone.role = undefined;
    if (P.rank === 'F/Lt' && P.sortiesAtRank >= T.vacancySorties - 1 && P.status === 'fit') {
      promote(s, 'S/Ldr');
      news.push(NEWS.promotedSqnVacancy(gone ? pilotName(gone) : 'the CO'));
    } else {
      const next = holder('A') ?? holder('B') ?? senior();
      if (next) {
        next.role = 'CO';
        next.rank = 'S/Ldr';
        news.push(NEWS.newCO(pilotName(next)));
      }
    }
  }
  // Flight commanders (the player holds B Flight as a F/Lt).
  for (const role of ['A', 'B'] as const) {
    if (holder(role)) continue;
    if (role === 'B' && P.rank === 'F/Lt') continue;
    const gone = s.roster.find((p) => p.role === role);
    if (gone) gone.role = undefined;
    if (role === 'B' && P.rank === 'P/O' && P.sorties >= T.vacancySorties && P.status === 'fit') {
      promote(s, 'F/Lt');
      news.push(NEWS.promotedFltVacancy(gone ? pilotName(gone) : 'the flight commander'));
      continue;
    }
    const next = senior();
    if (next) {
      next.role = role;
      next.rank = 'F/Lt';
      news.push(NEWS.newFlt(pilotName(next)));
    }
  }
  void rng;
  return news;
}

/** Promotion on merit. */
function promotion(s: CampaignState): string[] {
  const T = TUNING.campaign;
  const P = s.player;
  if (P.status !== 'fit' && P.status !== 'wounded') return [];
  // Each reprimand counts against the sorties that earn promotion.
  const pen = (P.writeUps ?? 0) * T.writeUpSorties;
  const sorties = P.sorties - pen, atRank = P.sortiesAtRank - pen;
  if (P.rank === 'P/O' && ((sorties >= T.fltLtSorties && P.destroyed >= T.fltLtKills) || sorties >= T.fltLtSortiesAlone)) {
    const b = s.roster.find((p) => p.role === 'B');
    if (b) { b.role = undefined; b.status = 'posted'; }
    promote(s, 'F/Lt');
    return [NEWS.promotedFlt(b ? pilotName(b) : 'the flight commander')];
  }
  if (P.rank === 'F/Lt' && ((atRank >= T.sqnLdrSortiesAtRank && P.destroyed >= T.sqnLdrKills) || sorties >= T.sqnLdrSortiesAlone)) {
    const co = s.roster.find((p) => p.role === 'CO');
    if (co) { co.role = undefined; co.status = 'posted'; }
    promote(s, 'S/Ldr');
    // Someone takes over B Flight.
    const next = s.roster.filter((p) => p.status === 'fit' && !p.role).sort((a, b) => b.sorties - a.sorties)[0];
    if (next) { next.role = 'B'; next.rank = 'F/Lt'; }
    return [NEWS.promotedSqn(co ? pilotName(co) : 'the CO')];
  }
  return [];
}

function promote(s: CampaignState, r: Rank): void {
  s.player.rank = r;
  s.player.sortiesAtRank = 0;
}

// ------------------------------------------------------------------ the days between

/** Overnight, and any days off-screen until the next campaign day. */
export function nextDay(s: CampaignState): string[] {
  const news: string[] = [];
  const from = currentDoy(s);
  s.dayIdx++;
  s.sortieOfDay = 0;
  const to = s.dayIdx < CAMPAIGN_DAYS.length ? currentDoy(s) : END_OF_CAMPAIGN + 1;
  let flown = 0, kills = 0;
  for (let doy = from + 1; doy <= to; doy++) {
    news.push(...overnight(s, doy));
    // The days in between, and today's sorties while the player is in hospital, are flown off-screen.
    const offscreen = doy < to || s.player.status === 'wounded';
    if (offscreen && doy <= END_OF_CAMPAIGN) {
      const r = offscreenDay(s, doy);
      flown += r.sorties;
      kills += r.kills;
      news.push(...r.news);
    }
  }
  if (to - from > 1) news.unshift(NEWS.quietDays(to - from - 1));
  if (flown) news.push(NEWS.sortiesFlown(flown, kills));
  if (s.dayIdx >= CAMPAIGN_DAYS.length) {
    s.ended = 'october';
    return news;
  }
  if (s.player.status === 'wounded') return [...news, ...nextDay(s)];
  if (!s.pairsOffered && currentDoy(s) >= PAIRS_FROM) {
    s.pairsOffered = true;
    news.push(NEWS.pairsAvailable);
  }
  startDay(s);
  return news;
}

function startDay(s: CampaignState): void {
  for (const n of SECTOR_STATIONS) {
    s.stats.airfieldDays++;
    if ((s.airfields[n] ?? 0) < TUNING.campaign.closedAt) s.stats.airfieldOpenDays++;
  }
}

/** A night: rest, repairs, replacements, hospital. */
function overnight(s: CampaignState, doy: number): string[] {
  const T = TUNING.campaign;
  const news: string[] = [];
  const rng = new Rng(hash3(s.seed, doy, 3));
  const [month] = fromDayOfYear(doy);
  const P = s.player;
  P.fatigue = Math.max(0, P.fatigue - T.fatigueRecovery);
  if (P.status === 'wounded' && P.backOn !== undefined && doy >= P.backOn) { P.status = 'fit'; P.backOn = undefined; news.push(NEWS.youBack); }
  for (const p of s.roster) {
    const tired = p.fatigue >= T.fatigueRest;
    p.fatigue = Math.max(0, p.fatigue - T.fatigueRecovery * (tired ? 1.6 : 1));
    if (p.status === 'wounded' && p.backOn !== undefined && doy >= p.backOn) { p.status = 'fit'; p.backOn = undefined; news.push(NEWS.backFromHospital(pilotName(p))); }
  }
  // Repairs.
  let back = 0;
  s.repairs = s.repairs.map((d) => d - 1).filter((d) => { if (d <= 0) { back++; return false; } return true; });
  s.aircraftServiceable += back;
  if (back) news.push(NEWS.repaired(back));
  // Replacements: an aircraft a day, a pilot most days, while under strength.
  if (s.aircraftServiceable + s.repairs.length < T.startAircraft) { s.aircraftServiceable++; news.push(NEWS.replacementAircraft(1)); }
  const strength = s.roster.filter((p) => p.status === 'fit' || p.status === 'wounded').length + 1;
  if (strength < T.establishment && rng.chance(0.7)) {
    const green = rng.chance(0.75);
    const p = makePilot(s, rng, rng.pick(['P/O', 'Sgt', 'Sgt']), green ? 'green' : 'average', month >= 8 ? 0.3 : 0.12);
    s.stats.pilotsTotal++;
    news.push(NEWS.replacementPilot(pilotName(p), green));
  }
  // Airfields mend.
  for (const n of SECTOR_STATIONS) {
    const was = s.airfields[n];
    s.airfields[n] = Math.max(0, was - T.repairPerDay);
    if (was >= T.closedAt && s.airfields[n] < T.closedAt) news.push(NEWS.airfieldOpen(n));
  }
  return news;
}

/** A day of the battle the player doesn't fly. */
function offscreenDay(s: CampaignState, doy: number): { sorties: number; kills: number; news: string[] } {
  const T = TUNING.campaign;
  const news: string[] = [];
  const rng = new Rng(hash3(s.seed, doy, 5));
  const [month, day] = fromDayOfYear(doy);
  const phase = phaseFor(month, day);
  const n = rng.chance(0.25) ? 0 : 1 + rng.int(phase === 'airfields' ? 3 : 2); // some days are quiet or wet
  let kills = 0;
  for (let k = 0; k < n; k++) {
    const fliers = [...fitPilots(s)].sort((a, b) => a.fatigue - b.fatigue).slice(0, Math.min(T.squadronSize, s.aircraftServiceable));
    for (const p of fliers) {
      p.sorties++;
      p.fatigue = Math.min(1, p.fatigue + T.fatiguePerSortie);
      const skillLoss = p.skill === 'green' ? 1.9 : p.skill === 'experte' ? 0.45 : 1;
      const skillKill = p.skill === 'green' ? 0.4 : p.skill === 'experte' ? 2.2 : 1;
      if (rng.chance(T.killPerSortie[phase] * skillKill)) { p.kills++; kills++; }
      const lossP = T.lossPerSortie[phase] * skillLoss * (s.formation === 'vic' ? T.vicLossFactor : 1) * (1 + p.fatigue * 0.5);
      if (rng.chance(lossP)) {
        const r = rng.next();
        s.aircraftServiceable = Math.max(0, s.aircraftServiceable - 1);
        if (r < 0.45) { p.status = 'lost'; s.stats.lost++; news.push(NEWS.lostOffscreen(pilotName(p))); }
        else if (r < 0.65) { p.status = 'wounded'; p.backOn = doy + 5 + rng.int(12); news.push(NEWS.woundedOffscreen(pilotName(p))); }
        else news.push(NEWS.safeOffscreen(pilotName(p)));
      } else if (rng.chance(0.06)) {
        s.aircraftServiceable = Math.max(0, s.aircraftServiceable - 1);
        s.repairs.push(1 + rng.int(3));
      }
      improve(p);
    }
    if (rng.chance(T.turnBackChance)) s.stats.raidsTurned++;
    else s.stats.raidsBombed++;
  }
  s.stats.squadronKills += kills;
  s.stats.sorties += n;
  // The sector stations under attack.
  if (phase === 'airfields') {
    for (const name of SECTOR_STATIONS) {
      if (!rng.chance(T.airfieldRaidChance)) continue;
      const was = s.airfields[name];
      s.airfields[name] = Math.min(1, was + rng.range(0.3, 0.85));
      news.push(was < T.closedAt && s.airfields[name] >= T.closedAt ? NEWS.airfieldClosed(name) : NEWS.airfieldBombed(name));
    }
  }
  for (const p of s.roster) if (p.status === 'fit' && p.fatigue >= T.fatigueRest && rng.chance(0.3)) news.push(NEWS.rested(pilotName(p)));
  // Losses among the CO and flight commanders are filled the same night.
  news.push(...vacancies(s, rng));
  for (const n of SECTOR_STATIONS) {
    s.stats.airfieldDays++;
    if ((s.airfields[n] ?? 0) < T.closedAt) s.stats.airfieldOpenDays++;
  }
  return { sorties: n, kills, news };
}

// ------------------------------------------------------------------ score

export interface CampaignScore {
  airfields: number;
  raids: number;
  survival: number;
  record: number;
  rank: number;
  total: number;
  verdict: string;
}

/** Did the sector's airfields stay open, were raids turned back, did the squadron survive, and your record. */
export function campaignScore(s: CampaignState): CampaignScore {
  const st = s.stats;
  const P = s.player;
  const airfields = Math.round(300 * (st.airfieldDays ? st.airfieldOpenDays / st.airfieldDays : 1));
  const raids = Math.round(250 * (st.raidsTurned / Math.max(1, st.raidsTurned + st.raidsBombed)));
  const survival = Math.round(250 * Math.max(0, 1 - st.lost / Math.max(1, st.pilotsTotal)));
  const record = Math.round(150 * Math.min(1, (P.destroyed + 0.5 * P.probable + 0.2 * P.damaged) / 12));
  const rank = P.rank === 'S/Ldr' ? 50 : P.rank === 'F/Lt' ? 25 : 0;
  const total = airfields + raids + survival + record + rank;
  return { airfields, raids, survival, record, rank, total, verdict: VERDICTS.find((v) => total >= v.min)!.text };
}

// ------------------------------------------------------------------ save

export interface KeyValueStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export function saveCampaign(s: CampaignState, store: KeyValueStore): void {
  store.setItem(CAMPAIGN_KEY, JSON.stringify(s));
}

export type LoadResult = { ok: true; state: CampaignState } | { ok: false; reason: 'none' | 'corrupt' | 'version' };

export function loadCampaign(store: KeyValueStore): LoadResult {
  const raw = store.getItem(CAMPAIGN_KEY);
  if (!raw) return { ok: false, reason: 'none' };
  let s: CampaignState;
  try { s = JSON.parse(raw); } catch { return { ok: false, reason: 'corrupt' }; }
  if (!s || typeof s !== 'object' || !Array.isArray(s.roster)) return { ok: false, reason: 'corrupt' };
  if (s.version !== CAMPAIGN_VERSION) return { ok: false, reason: 'version' };
  return { ok: true, state: s };
}

export function resetCampaign(store: KeyValueStore): void {
  store.removeItem(CAMPAIGN_KEY);
}
