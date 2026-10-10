// The career: experience on type, which field the squadron flies from,
// postings to other squadrons and types, and the CO moving the squadron.

import { describe, expect, it } from 'vitest';
import {
  applySortie, CampaignState, currentDoy, fieldChoices, flyingFrom, formationFor, minutesOnType, moveSquadron, newCampaign,
  nextDay, nextSortieSpec, postingRefusal, postTo, SECTOR_FIELDS, setFlyFrom, typeSkill,
} from '../src/campaign/campaign';
import { worldMap } from '../src/content/world/map';
import { WorldObjects } from '../src/content/world/objects';
import { Sortie, SortieResult } from '../src/sim/sortie';
import { TUNING } from '../src/tuning';

const map = worldMap();
const opts = { surname: 'Fenwick', home: 'Biggin Hill', aircraft: 'hurricane' as const, ironman: false };
const T = TUNING.campaign;

function result(s: CampaignState, mins = 60): SortieResult {
  const { others } = formationFor(s);
  return {
    date: '', aircraft: 'Hurricane', durationMin: mins, takeoffDelay: 90, claims: [], roundsFired: 0, damageTaken: 0, damageNotes: [],
    outcome: { kind: 'landed', pilot: 'fine', aircraft: 'fine', place: s.home, line: '' },
    raidNotes: [], raidsTurned: 0, raidsBombed: 1, bombsOnTargetKg: 0, losses: [], enemyDown: 0, logLine: '', rtLog: [], engaged: false,
    fates: others.map((p) => ({ id: p.id, name: p.surname, fate: 'ok' as const, kills: 0 })), squadronKills: 0, airfieldHits: {},
  };
}

describe('experience on type', () => {
  it('starts with the OTU hours, grows with every sortie, and goes to the flight model', () => {
    const s = newCampaign(1, opts);
    expect(minutesOnType(s)).toBe(T.otuHours * 60);
    expect(typeSkill(s)).toBeCloseTo(T.otuHours / T.oldHandHours);
    const before = typeSkill(s);
    applySortie(s, result(s, 90));
    expect(minutesOnType(s)).toBe(T.otuHours * 60 + 90);
    expect(typeSkill(s)).toBeGreaterThan(before);
    expect(nextSortieSpec(s, map, { convergenceM: 250, assist: true }).typeSkill).toBeCloseTo(typeSkill(s));
  });

  it('says so as you get to know her, and tops out as an old hand', () => {
    const s = newCampaign(2, opts);
    const news: string[] = [];
    for (let i = 0; i < 60 && !s.ended; i++) news.push(...applySortie(s, result(s, 75)));
    expect(news.some((n) => /getting the feel of the Hurricane/.test(n))).toBe(true);
    expect(news.some((n) => /at home in the Hurricane/.test(n))).toBe(true);
    expect(news.some((n) => /old hand on the Hurricane/.test(n))).toBe(true);
    expect(typeSkill(s)).toBe(1);
  });

  it('an older save, without hours on type, counts everything flown as on the squadron\'s type', () => {
    const s = newCampaign(3, opts);
    applySortie(s, result(s, 60));
    delete s.player.typeMinutes;
    expect(minutesOnType(s)).toBe(T.otuHours * 60 + s.player.minutes);
    expect(minutesOnType(s, 'spitfire')).toBe(0);
  });
});

describe('where the squadron flies from', () => {
  it('a sector\'s satellites and forward fields; the sortie goes from there, with the sector\'s controller', () => {
    const s = newCampaign(4, opts);
    expect(fieldChoices(s)).toEqual(['Biggin Hill', ...SECTOR_FIELDS['Biggin Hill']]);
    setFlyFrom(s, 'Manston'); // another sector's
    expect(flyingFrom(s)).toBe('Biggin Hill');
    setFlyFrom(s, 'Hawkinge');
    expect(flyingFrom(s)).toBe('Hawkinge');
    const spec = nextSortieSpec(s, map, { convergenceM: 250, assist: true });
    expect(spec.home).toBe('Hawkinge');
    expect(spec.controller).toBe('Sapper');
  });

  it('a forward field is caught on the ground more often', () => {
    let fwd = 0, home = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const s = newCampaign(seed, opts);
      s.dayIdx = 12; // the airfields phase
      expect(nextSortieSpec(s, map, { convergenceM: 250, assist: true }).phase).toBe('airfields');
      if (nextSortieSpec(s, map, { convergenceM: 250, assist: true }).underAttack) home++;
      setFlyFrom(s, 'Hawkinge');
      if (nextSortieSpec(s, map, { convergenceM: 250, assist: true }).underAttack) fwd++;
    }
    expect(fwd).toBeGreaterThan(home * 1.2);
  });

  it('the station bombed out: the squadron flies from a satellite until it\'s open again', () => {
    const s = newCampaign(5, opts);
    // Two flying days in a row, so one night's repairs leave it shut.
    const doy = (i: number) => { s.dayIdx = i; return currentDoy(s); };
    let i = 0;
    while (doy(i + 1) - doy(i) !== 1) i++;
    s.dayIdx = i;
    s.airfields['Biggin Hill'] = 1;
    const news = nextDay(s);
    expect(flyingFrom(s)).not.toBe('Biggin Hill');
    expect(SECTOR_FIELDS['Biggin Hill']).toContain(flyingFrom(s));
    expect(news.join(' ')).toMatch(/Biggin Hill is out of action/);
    s.airfields['Biggin Hill'] = 0;
    expect(nextDay(s).join(' ')).toMatch(/Biggin Hill is open again/);
    expect(flyingFrom(s)).toBe('Biggin Hill');
  });

  it('a sortie from a forward field starts there, at readiness', () => {
    const s = newCampaign(6, opts);
    setFlyFrom(s, 'Hawkinge');
    const spec = nextSortieSpec(s, map, { convergenceM: 250, assist: true });
    const so = new Sortie(spec, map, new WorldObjects(map));
    for (let i = 0; i < 100; i++) so.step(null);
    const field = map.airfieldByName('Hawkinge')!;
    expect(so.player.fs.onGround).toBe(true);
    expect(Math.hypot(so.player.pos.x - field.pos.x, so.player.pos.z - field.pos.z)).toBeLessThan(1500);
  });
});

describe('postings', () => {
  it('to a Spitfire squadron: a new squadron and station, conversion days, and new on the type', () => {
    const s = newCampaign(7, opts);
    const was = { squadron: s.squadron, doy: currentDoy(s), ids: s.roster.map((p) => p.id) };
    expect(postingRefusal(s, 'Hornchurch', 'spitfire')).toBeNull();
    postTo(s, 'Hornchurch', 'spitfire');
    expect(s.squadron).not.toBe(was.squadron);
    expect(s.home).toBe('Hornchurch');
    expect(s.aircraft).toBe('spitfire');
    expect(currentDoy(s) - was.doy).toBeGreaterThanOrEqual(T.conversionDays);
    expect(s.roster.some((p) => was.ids.includes(p.id))).toBe(false);
    expect(s.roster.filter((p) => p.role === 'CO')).toHaveLength(1);
    expect(minutesOnType(s, 'spitfire')).toBe(T.conversionHours * 60);
    expect(minutesOnType(s, 'hurricane')).toBe(T.otuHours * 60);
    expect(typeSkill(s)).toBeLessThan(0.25);
    expect(s.news.join(' ')).toMatch(/conversion/);
    expect(s.player.awayUntil).toBeUndefined();
    expect(s.served?.map((x) => x.home)).toEqual(['Biggin Hill', 'Hornchurch']);
    // Not again so soon.
    expect(postingRefusal(s, 'Kenley', 'spitfire')).toBe('tooSoon');
  });

  it('rank goes with you: a Squadron Leader is given the new squadron', () => {
    const s = newCampaign(8, opts);
    s.player.rank = 'S/Ldr';
    postTo(s, 'Kenley', 'hurricane');
    expect(s.roster.some((p) => p.role === 'CO')).toBe(false);
    expect(formationFor(s).leading).toBe(true);
  });

  it('not while wounded, and not to where you already are', () => {
    const s = newCampaign(9, opts);
    expect(postingRefusal(s, 'Biggin Hill', 'hurricane')).toBe('same');
    s.player.status = 'wounded';
    expect(postingRefusal(s, 'Kenley', 'hurricane')).toBe('wounded');
  });

  it('commanding, you can move the squadron: same pilots, new station', () => {
    const s = newCampaign(10, opts);
    expect(moveSquadron(s, 'Tangmere')).toEqual([]);
    s.player.rank = 'S/Ldr';
    const ids = s.roster.map((p) => p.id).sort();
    const sq = s.squadron;
    moveSquadron(s, 'Tangmere');
    expect(s.home).toBe('Tangmere');
    expect(s.squadron).toBe(sq);
    expect(s.roster.map((p) => p.id).sort()).toEqual(ids);
    expect(s.news.join(' ')).toMatch(/moves from Biggin Hill to Tangmere/);
  });
});
