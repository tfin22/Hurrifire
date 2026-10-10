// Campaign screens: signing on, the squadron's readiness board (the day,
// the news, the roster, the formation), and the verdict at the end.

import type { App, Screen } from '../app';
import {
  campaignDate, campaignPhase, campaignScore, CampaignState, CampaignType, currentDoy, dayWeather, fieldChoices, fitPilots, flyingFrom, isForward,
  minutesOnType, moveSquadron, pilotName, playerName, postingRefusal, postTo, RosterPilot, SECTOR_STATIONS, setFlyFrom, sortiesToday, TYPE_LEVELS,
  typeLevel, typeSkill,
} from '../campaign/campaign';
import { CAREER_END, DAY_NOTES, PHASE_NAMES, RANK_NAMES } from '../content/text/campaign';
import { PILOT_NAMES } from '../content/text/briefing';
import { noEffects, ScreenEffects } from '../render/display';
import { drawText, drawTextCentered, wrapText } from '../render/font';
import { FrameBuffer, W } from '../render/framebuffer';
import { C } from '../render/palette';
import { fillRect, hline, rectOutline, vline } from '../render/raster';
import { TUNING } from '../tuning';
import { Menu, panel } from './ui';

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October'];
const NATION_TAG: Record<RosterPilot['nation'], string> = {
  british: '', polish: ' (POL)', czech: ' (CZ)', canadian: ' (CAN)', newZealand: ' (NZ)', australian: ' (AUS)', southAfrican: ' (SA)',
};
const STATIONS = ['Biggin Hill', 'Kenley', 'Hornchurch', 'North Weald', 'Tangmere', 'Northolt', 'Debden'];

export interface NewCampaignChoice {
  surname: string;
  home: string;
  aircraft: 'hurricane' | 'spitfire';
  ironman: boolean;
}

/** Continue, or start again; and the choices for a new campaign. */
export class CampaignStartScreen implements Screen {
  touchMode = 'menu' as const;
  music = 'title' as const;
  private menu = new Menu([], 70, 70, 180, 15);
  private c: NewCampaignChoice = { surname: 'Fenwick', home: 'Biggin Hill', aircraft: 'hurricane', ironman: false };
  private confirm = false;
  private setup: boolean;

  constructor(
    private app: App,
    private existing: { state: CampaignState | null; problem: 'version' | 'corrupt' | null },
    private go: { resume: () => void; begin: (c: NewCampaignChoice) => void; back: () => void },
  ) {
    this.setup = !existing.state;
    this.build();
  }

  private cycle<T>(list: readonly T[], v: T, d: number): T {
    return list[(list.indexOf(v) + d + list.length) % list.length];
  }

  private build(): void {
    const sel = this.menu.sel;
    const c = this.c;
    const adj = (f: (d: -1 | 1) => void) => ({ act: () => { f(1); this.build(); }, adjust: (d: -1 | 1) => { f(d); this.build(); } });
    if (!this.setup) {
      const st = this.existing.state!;
      this.menu.items = [
        { label: 'CONTINUE', act: () => this.go.resume(), disabled: !!st.ended },
        { label: this.confirm ? 'SURE? TAP AGAIN' : 'NEW CAMPAIGN', act: () => { if (this.confirm) { this.setup = true; this.menu.sel = 0; } this.confirm = true; this.build(); } },
        { label: 'BACK', act: () => this.go.back() },
      ];
    } else {
      this.menu.items = [
        { label: `NAME: P/O ${c.surname.toUpperCase()}`, ...adj((d) => { c.surname = this.cycle(PILOT_NAMES.british, c.surname, d); }) },
        { label: `STATION: ${c.home.toUpperCase()}`, ...adj((d) => { c.home = this.cycle(STATIONS, c.home, d); }) },
        { label: c.aircraft === 'spitfire' ? 'SPITFIRE SQUADRON' : 'HURRICANE SQUADRON', ...adj(() => { c.aircraft = c.aircraft === 'spitfire' ? 'hurricane' : 'spitfire'; }) },
        { label: `IRONMAN: ${c.ironman ? 'ON' : 'OFF'}`, ...adj(() => { c.ironman = !c.ironman; }) },
        { label: 'REPORT FOR DUTY', act: () => this.go.begin(this.c) },
        { label: 'BACK', act: () => this.go.back() },
      ];
    }
    this.menu.sel = Math.min(sel, this.menu.items.length - 1);
  }

  frame(): void {
    const s = this.app.input;
    if (s.consume('back')) { this.go.back(); return; }
    this.menu.input(s);
  }

  tick(): void {}

  render(fb: FrameBuffer): void {
    fillRect(fb, 0, 0, W, 256, C.RAF_EARTH_D);
    panel(fb, 40, 34, 240, 150);
    this.menu.draw(fb, 'CAMPAIGN 1940');
    const st = this.existing.state;
    let y = 196;
    const line = (t: string, c: number = C.CHALK) => { for (const l of wrapText(t, 290, 'tiny')) { drawTextCentered(fb, l, 160, y, c, 'tiny'); y += 7; } };
    if (this.existing.problem === 'version') line('The saved campaign is from an older version of the game and cannot be continued.', C.FIRE_Y);
    if (this.existing.problem === 'corrupt') line('The saved campaign could not be read.', C.FIRE_Y);
    if (!this.setup && st) {
      const d = campaignDate(st);
      line(`${playerName(st)}, ${st.squadron} Squadron, ${st.home}. ${d.day} ${MONTHS[d.month]} 1940.${st.ironman ? ' Ironman.' : ''}`);
      if (st.ended) line('That campaign is over.');
    } else {
      line('July to October 1940. You start as a Pilot Officer flying as a wingman.');
      line('Ironman: one life. A lost pilot ends the career.', C.GREY_L);
    }
  }
}

/** The readiness board in the dispersal hut: the day, the squadron, the news. */
export class CampaignBoardScreen implements Screen {
  touchMode = 'menu' as const;
  private menu = new Menu([], 214, 164, 96, 11);
  private newsScroll = 0;
  private news: string[];

  constructor(
    private app: App,
    private s: CampaignState,
    private go: { fly: () => void; roster: () => void; logbook: () => void; postings: () => void; quit: () => void; save: () => void },
  ) {
    this.news = [...s.news];
    s.news.length = 0;
    go.save();
    this.build();
  }

  private build(): void {
    const s = this.s;
    const sel = this.menu.sel;
    this.menu.items = [
      { label: 'TO DISPERSAL', act: () => this.go.fly() },
      {
        label: `FORMATION: ${s.formation === 'vic' ? 'VICS' : 'PAIRS'}`,
        disabled: !s.pairsOffered,
        act: () => { s.formation = s.formation === 'vic' ? 'pairs' : 'vic'; this.go.save(); this.build(); },
        adjust: s.pairsOffered ? () => { s.formation = s.formation === 'vic' ? 'pairs' : 'vic'; this.go.save(); this.build(); } : undefined,
      },
      this.fieldItem(),
      { label: 'POSTINGS', act: () => this.go.postings() },
      { label: 'THE SQUADRON', act: () => this.go.roster() },
      { label: 'LOGBOOK', act: () => this.go.logbook() },
      { label: 'SAVE AND QUIT', act: () => this.go.quit() },
    ];
    this.menu.sel = sel;
  }

  /** Which of the sector's fields the squadron flies from: the station, or a satellite or forward field. */
  private fieldItem() {
    const s = this.s;
    const choices = fieldChoices(s);
    const from = flyingFrom(s);
    const step = (d: number) => {
      const i = choices.indexOf(from);
      setFlyFrom(s, choices[(i + d + choices.length) % choices.length]);
      this.go.save();
      this.build();
    };
    const many = choices.length > 1;
    return { label: shortField(from).toUpperCase(), disabled: !many, act: () => step(1), adjust: many ? (d: -1 | 1) => step(d) : undefined };
  }

  frame(): void {
    const inp = this.app.input;
    if (inp.consume('back')) { this.go.quit(); return; }
    // Taps on the news board scroll it.
    for (const t of inp.taps) if (t.x < 200 && t.y > 150) this.newsScroll += 3;
    if (this.menu.input(inp)) return;
    inp.taps.length = 0;
  }

  tick(): void {}

  render(fb: FrameBuffer): void {
    const s = this.s;
    const d = campaignDate(s);
    const phase = campaignPhase(s);
    // The hut: a blackboard on the wall.
    fillRect(fb, 0, 0, W, 256, C.RAF_EARTH_D);
    for (let x = 0; x < W; x += 20) vline(fb, x, 0, 255, C.RAF_EARTH);
    fillRect(fb, 6, 6, 308, 244, C.GREY_D);
    rectOutline(fb, 5, 5, 310, 246, C.RAF_EARTH);
    // The date and the phase.
    drawText(fb, `${d.day} ${MONTHS[d.month].toUpperCase()} 1940`, 12, 10, C.WHITE);
    drawText(fb, PHASE_NAMES[phase].toUpperCase(), 308 - PHASE_NAMES[phase].length * 8, 10, C.SIGHT);
    const note = DAY_NOTES[`${d.month}-${d.day}`];
    let y = 22;
    if (note) for (const l of wrapText(note, 296, 'hand')) { drawText(fb, l, 12, y, C.CHALK, 'hand'); y += 10; }
    hline(fb, 10, 310, y + 1, C.SMOKE);
    y += 5;
    // You.
    const P = s.player;
    const col1 = 12, col2 = 166;
    drawText(fb, playerName(s).toUpperCase(), col1, y, C.WHITE, 'tiny');
    drawText(fb, `${s.squadron.toUpperCase()} SQUADRON, ${s.home.toUpperCase()}`, col2, y, C.WHITE, 'tiny');
    y += 8;
    const rows1 = [
      `${RANK_NAMES[P.rank]}${P.rank === 'P/O' ? ', flying as a wingman' : P.rank === 'F/Lt' ? ', B Flight' : ', commanding'}`,
      `Sorties ${P.sorties}, ${Math.floor(P.minutes / 60)} hrs, ${Math.floor(minutesOnType(s) / 60)} on ${TYPE_PLURAL[s.aircraft]}`,
      `Destroyed ${P.destroyed}  probable ${P.probable}  damaged ${P.damaged}`,
    ];
    const fit = fitPilots(s).length;
    const strength = s.roster.filter((p) => p.status === 'fit' || p.status === 'wounded').length + 1;
    const rows2 = [
      `Pilots fit ${fit + (P.status === 'fit' ? 1 : 0)} of ${strength}`,
      `Aircraft serviceable ${s.aircraftServiceable}${s.repairs.length ? `, ${s.repairs.length} in repair` : ''}`,
      `Sortie ${s.sortieOfDay + 1} of ${sortiesToday(s)} today. ${dayWeather(s).summary}`,
    ];
    rows1.forEach((r, i) => drawText(fb, r, col1, y + i * 7, C.CHALK, 'tiny'));
    rows2.forEach((r, i) => { for (const [j, l] of wrapText(r, 144, 'tiny').slice(0, 2).entries()) drawText(fb, l, col2, y + i * 7 + j * 7, C.CHALK, 'tiny'); });
    y += 22;
    // Fatigue.
    drawText(fb, 'Fatigue', col1, y, C.GREY_L, 'tiny');
    fillRect(fb, col1 + 34, y + 1, 40, 4, C.BLACK);
    fillRect(fb, col1 + 34, y + 1, Math.round(40 * P.fatigue), 4, P.fatigue > 0.6 ? C.FIRE_R : P.fatigue > 0.3 ? C.FIRE_Y : C.RAF_GREEN);
    drawText(fb, `ON TYPE: ${TYPE_LEVELS[typeLevel(typeSkill(s))]}`, col1 + 80, y, C.CHALK, 'tiny');
    y += 10;
    // The sector stations.
    drawText(fb, 'SECTOR STATIONS', col1, y, C.SIGHT, 'tiny');
    y += 7;
    SECTOR_STATIONS.forEach((n, i) => {
      const dmg = s.airfields[n] ?? 0;
      const st = dmg >= TUNING.campaign.closedAt ? 'CLOSED' : dmg > 0.15 ? 'CRATERED' : 'OPEN';
      const x = col1 + (i % 3) * 100, yy = y + Math.floor(i / 3) * 7;
      drawText(fb, n, x, yy, n === s.home ? C.WHITE : C.CHALK, 'tiny');
      drawText(fb, st, x + 56, yy, st === 'OPEN' ? C.CHALK : st === 'CLOSED' ? C.FIRE_R : C.FIRE_Y, 'tiny');
    });
    // Flying from a satellite or forward field.
    const from = flyingFrom(s);
    if (from !== s.home) drawText(fb, `Flying from ${from}${isForward(from) ? ', forward' : ''}${s.flyFromForced ? ' (station out)' : ''}`, col1 + 100, y + 14, C.FIRE_Y, 'tiny');
    y += 24;
    hline(fb, 10, 310, y, C.SMOKE);
    y += 4;
    // The news.
    drawText(fb, 'SINCE YESTERDAY', col1, y, C.SIGHT, 'tiny');
    y += 8;
    const lines: string[] = [];
    for (const n of this.news.length ? this.news : ['Nothing to report.']) lines.push(...wrapText(n, 190, 'tiny'));
    const maxL = Math.floor((246 - y) / 7);
    if (this.newsScroll > Math.max(0, lines.length - maxL)) this.newsScroll = 0;
    lines.slice(this.newsScroll, this.newsScroll + maxL).forEach((l, i) => drawText(fb, l, col1, y + i * 7, C.CHALK, 'tiny'));
    if (lines.length > maxL) drawText(fb, 'TAP FOR MORE', 140, 242, C.GREY_L, 'tiny');
    // Orders.
    panel(fb, 206, 158, 110, 86, C.BLACK);
    this.menu.draw(fb);
    if (s.ironman) drawText(fb, 'IRONMAN', 270, 238, C.FIRE_R, 'tiny');
    if (P.status !== 'fit') drawText(fb, `In hospital until ${P.backOn! - currentDoy(s)} days`, 210, 150, C.FIRE_Y, 'tiny');
  }

  effects(): ScreenEffects {
    return noEffects();
  }
}

const TYPE_PLURAL: Record<CampaignType, string> = { hurricane: 'Hurricanes', spitfire: 'Spitfires' };
const shortField = (f: string) => f.replace(' Tawney', '');

/**
 * Postings: ask Group for a posting to another squadron (another station,
 * or the other type, with a conversion course first); or, commanding, move
 * the squadron to another station.
 */
export class PostingsScreen implements Screen {
  touchMode = 'menu' as const;
  private menu = new Menu([], 70, 120, 180, 13);
  private home: string;
  private type: CampaignType;
  private confirm: 'post' | 'move' | null = null;

  constructor(private app: App, private s: CampaignState, private back: () => void, private save: () => void) {
    this.home = s.home;
    this.type = s.aircraft;
    this.build();
  }

  private build(): void {
    const s = this.s;
    const sel = this.menu.sel;
    const adj = (f: (d: -1 | 1) => void) => ({ act: () => { f(1); this.confirm = null; this.build(); }, adjust: (d: -1 | 1) => { f(d); this.confirm = null; this.build(); } });
    const cyc = <T,>(list: readonly T[], v: T, d: number) => list[(list.indexOf(v) + d + list.length) % list.length];
    const refused = postingRefusal(s, this.home, this.type);
    const canMove = s.player.rank === 'S/Ldr' && this.type === s.aircraft && !refused;
    this.menu.items = [
      { label: `${this.type === 'spitfire' ? 'SPITFIRE' : 'HURRICANE'} SQUADRON`, ...adj(() => { this.type = this.type === 'spitfire' ? 'hurricane' : 'spitfire'; }) },
      { label: `AT ${this.home.toUpperCase()}`, ...adj((d) => { this.home = cyc(SECTOR_STATIONS, this.home, d); }) },
      {
        label: this.confirm === 'post' ? 'SURE? TAP AGAIN' : 'ASK FOR A POSTING', disabled: !!refused,
        act: () => { if (this.confirm === 'post') { postTo(s, this.home, this.type); this.save(); this.back(); return; } this.confirm = 'post'; this.build(); },
      },
      {
        label: this.confirm === 'move' ? 'SURE? TAP AGAIN' : 'MOVE THE SQUADRON', disabled: !canMove,
        act: () => { if (this.confirm === 'move') { moveSquadron(s, this.home); this.save(); this.back(); return; } this.confirm = 'move'; this.build(); },
      },
      { label: 'BACK', act: () => this.back() },
    ];
    this.menu.sel = Math.min(sel, this.menu.items.length - 1);
  }

  frame(): void {
    const inp = this.app.input;
    if (inp.consume('back')) { this.back(); return; }
    this.menu.input(inp);
  }

  tick(): void {}

  render(fb: FrameBuffer): void {
    const s = this.s;
    fillRect(fb, 0, 0, W, 256, C.RAF_EARTH_D);
    panel(fb, 10, 8, 300, 240, C.BLACK);
    drawTextCentered(fb, 'POSTINGS', 160, 14, C.SIGHT);
    let y = 28;
    const line = (t: string, c: number = C.CHALK, x = 18) => { for (const l of wrapText(t, 284, 'tiny')) { drawText(fb, l, x, y, c, 'tiny'); y += 7; } };
    // Hours on each type.
    const hrs = (t: CampaignType) => `${TYPE_PLURAL[t]} ${Math.floor(minutesOnType(s, t) / 60)} hrs${minutesOnType(s, t) ? ` (${TYPE_LEVELS[typeLevel(typeSkill(s, t))].toLowerCase()})` : ''}`;
    line(`${playerName(s)}. On type: ${hrs('hurricane')}, ${hrs('spitfire')}.`, C.WHITE);
    // Where you've served.
    const served = s.served ?? [{ squadron: s.squadron, home: s.home, aircraft: s.aircraft, from: 0 }];
    line(`Served with: ${served.map((x) => `${x.squadron} (${x.home}, ${TYPE_PLURAL[x.aircraft]})`).join('; ')}.`);
    y += 4;
    line('Group can post you to another squadron: another station, or the other type after a conversion course. Your rank goes with you. Commanding, you can move the whole squadron instead.', C.GREY_L);
    this.menu.draw(fb);
    // What the choice means.
    y = 192;
    const refused = postingRefusal(s, this.home, this.type);
    const gap = TUNING.campaign.postingGapDays - (currentDoy(s) - (s.lastMove ?? -99));
    if (refused === 'wounded') line('Not while you are in hospital.', C.FIRE_Y);
    else if (refused === 'tooSoon') line(`Group won't move you again so soon: ask in ${gap} day${gap > 1 ? 's' : ''}.`, C.FIRE_Y);
    else if (refused === 'same') line(`That's where you are: ${s.squadron} Squadron at ${s.home}.`, C.GREY_L);
    else {
      const converting = this.type !== s.aircraft;
      line(converting
        ? `A new squadron at ${this.home}, on ${TYPE_PLURAL[this.type]}. ${TUNING.campaign.conversionDays} days converting first, and you start new on the type.`
        : `A new squadron at ${this.home}. A day travelling. New pilots to get to know; they don't know you either.`);
      if (s.player.rank === 'S/Ldr' && !converting) line(`Or move ${s.squadron} Squadron, pilots and all, to ${this.home}: a day on the move.`);
    }
  }
}

/** The squadron's pilots, with their state. */
export class RosterScreen implements Screen {
  touchMode = 'menu' as const;
  private scroll = 0;
  constructor(private app: App, private s: CampaignState, private back: () => void) {}

  frame(): void {
    const inp = this.app.input;
    if (inp.consume('down')) this.scroll++;
    if (inp.consume('up')) this.scroll = Math.max(0, this.scroll - 1);
    for (const t of inp.taps) { if (t.y > 200) this.scroll += 10; else { this.back(); return; } }
    if (inp.consume('ok') || inp.consume('back')) this.back();
  }

  tick(): void {}

  render(fb: FrameBuffer): void {
    const s = this.s;
    fillRect(fb, 0, 0, W, 256, C.RAF_EARTH_D);
    fillRect(fb, 8, 8, 304, 240, C.STUBBLE);
    drawText(fb, `${s.squadron.toUpperCase()} SQUADRON - PILOTS`, 14, 12, C.BLUE, 'tiny');
    const head = ['NAME', 'SORTIES', 'CLAIMS', 'FATIGUE', 'STATE'];
    const xs = [14, 140, 180, 214, 262];
    head.forEach((h, i) => drawText(fb, h, xs[i], 22, C.RAF_EARTH, 'tiny'));
    hline(fb, 10, 309, 29, C.BLUE);
    const order = { fit: 0, wounded: 1, posted: 2, pow: 3, lost: 4 };
    const rk = (p: RosterPilot) => (p.role === 'CO' ? 0 : p.role ? 1 : 2);
    const list = [...s.roster].sort((a, b) => order[a.status] - order[b.status] || rk(a) - rk(b) || b.sorties - a.sorties);
    const rows = 29;
    this.scroll = Math.min(this.scroll, Math.max(0, list.length - rows));
    list.slice(this.scroll, this.scroll + rows).forEach((p, i) => {
      const y = 32 + i * 7;
      const gone = p.status === 'lost' || p.status === 'pow';
      const c = gone ? C.GREY_D : C.BLACK;
      const role = p.role === 'CO' ? ' (CO)' : p.role ? ` (${p.role} Flt)` : '';
      drawText(fb, `${pilotName(p)}${role}${NATION_TAG[p.nation]}`.slice(0, 31), xs[0], y, c, 'tiny');
      drawText(fb, String(p.sorties), xs[1], y, c, 'tiny');
      drawText(fb, String(p.kills), xs[2], y, c, 'tiny');
      if (!gone) {
        fillRect(fb, xs[3], y + 1, 36, 3, C.GREY_L);
        fillRect(fb, xs[3], y + 1, Math.round(36 * p.fatigue), 3, p.fatigue > 0.6 ? C.RED : C.RAF_GREEN);
      }
      const state = p.status === 'fit' ? (p.fatigue >= TUNING.campaign.fatigueRest ? 'resting' : p.skill === 'green' ? 'fit (new)' : 'fit') : p.status === 'pow' ? 'prisoner' : p.status === 'lost' ? 'missing' : p.status;
      drawText(fb, state, xs[4], y, p.status === 'lost' ? C.RED : c, 'tiny');
    });
    drawTextCentered(fb, 'TAP TO CLOSE', 160, 240, C.RAF_EARTH, 'tiny');
  }
}

/** The end of the campaign: the score and the verdict. */
export class CampaignEndScreen implements Screen {
  touchMode = 'menu' as const;
  music = 'debrief' as const;
  private t = 0;
  constructor(private app: App, private s: CampaignState, private next: () => void) {}

  frame(): void {
    const inp = this.app.input;
    if (this.t > 50 && (inp.taps.length || inp.consume('ok') || inp.consume('back'))) this.next();
  }

  tick(): void { this.t++; }

  render(fb: FrameBuffer): void {
    const s = this.s;
    const sc = campaignScore(s);
    fillRect(fb, 0, 0, W, 256, C.SEA_D);
    panel(fb, 20, 16, 280, 224, C.BLACK);
    const P = s.player;
    const over = s.ended === 'october';
    drawTextCentered(fb, over ? 'THE END OF OCTOBER 1940' : 'THE END OF A CAREER', 160, 24, C.SIGHT);
    let y = 40;
    const L = (t: string, c: number = C.CHALK, f: 'tiny' | 'hand' = 'tiny') => { for (const l of wrapText(t, 260, f)) { drawText(fb, l, 30, y, c, f); y += f === 'hand' ? 10 : 7; } };
    if (!over) L(s.ended === 'pow' ? CAREER_END.pow : CAREER_END.killed, C.WHITE, 'hand');
    L(`${playerName(s)}, ${s.squadron} Squadron. ${P.sorties} sorties. Destroyed ${P.destroyed}, probable ${P.probable}, damaged ${P.damaged}.`);
    y += 4;
    const rows: [string, number, number][] = [
      ['Sector stations kept open', sc.airfields, 300],
      ['Raids turned back', sc.raids, 250],
      ['The squadron\'s survival', sc.survival, 250],
      ['Your own record', sc.record, 150],
      ['Rank', sc.rank, 50],
    ];
    for (const [k, v, max] of rows) {
      drawText(fb, k, 30, y, C.CHALK, 'tiny');
      fillRect(fb, 170, y + 1, 80, 4, C.GREY_D);
      fillRect(fb, 170, y + 1, Math.round((80 * v) / max), 4, C.SIGHT);
      drawText(fb, String(v), 258, y, C.WHITE, 'tiny');
      y += 9;
    }
    hline(fb, 30, 290, y, C.SMOKE);
    y += 4;
    drawText(fb, 'TOTAL', 30, y, C.WHITE);
    drawText(fb, `${sc.total} / 1000`, 220, y, C.WHITE);
    y += 14;
    L(sc.verdict, C.WHITE, 'hand');
    y += 4;
    L(`The squadron lost ${s.stats.lost} pilots and claimed ${s.stats.squadronKills} enemy aircraft over ${s.stats.sorties} sorties.`, C.GREY_L);
    drawTextCentered(fb, 'TAP TO CONTINUE', 160, 228, C.GREY_L, 'tiny');
  }

  effects(): ScreenEffects {
    const fx = noEffects();
    fx.fade = Math.max(0, 1 - this.t / 40);
    return fx;
  }
}
