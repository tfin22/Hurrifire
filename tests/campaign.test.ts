import { describe, expect, it } from 'vitest';
import {
  applyAirfieldState, applySortie, campaignDate, campaignScore, CampaignState, fitPilots, formationFor, loadCampaign,
  newCampaign, nextSortieSpec, resetCampaign, saveCampaign, sortiesToday, KeyValueStore,
} from '../src/campaign/campaign';
import { CAMPAIGN_DAYS } from '../src/content/text/campaign';
import { worldMap } from '../src/content/world/map';
import type { SortieResult } from '../src/sim/sortie';
import type { Claim } from '../src/sim/claims';
import { TUNING } from '../src/tuning';

const opts = { surname: 'Fenwick', home: 'Biggin Hill', aircraft: 'hurricane' as const, ironman: false };

/** A sortie result as the sim would report it, with the given claims and fates. */
function result(s: CampaignState, o: Partial<SortieResult> = {}, destroyed = 0): SortieResult {
  const { others } = formationFor(s);
  const claims = Array.from({ length: destroyed }, () => ({ type: 'Do 17', claimed: 'destroyed', allowed: 'destroyed', note: 'confirmed' }) as unknown as Claim);
  return {
    date: '', aircraft: 'Hurricane', durationMin: 60, takeoffDelay: 90, claims, roundsFired: 1200, damageTaken: 0, damageNotes: [],
    outcome: { kind: 'landed', pilot: 'fine', aircraft: 'fine', place: 'Biggin Hill', line: '' },
    raidNotes: [], raidsTurned: 1, raidsBombed: 0, bombsOnTargetKg: 0, losses: [], enemyDown: 3, logLine: '', rtLog: [], engaged: true,
    fates: others.map((p) => ({ id: p.id, name: p.surname, fate: 'ok' as const, kills: 0 })), squadronKills: 1, airfieldHits: {},
    ...o,
  };
}

function memStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

describe('campaign progression', () => {
  it('starts on 10 July as a Pilot Officer flying as a wingman', () => {
    const s = newCampaign(1, opts);
    expect(campaignDate(s)).toEqual({ month: 7, day: 10 });
    expect(s.player.rank).toBe('P/O');
    const f = formationFor(s);
    expect(f.leading).toBe(false);
    expect(f.others[0].role).toBe('CO');
    expect(f.others.length).toBe(TUNING.campaign.squadronSize - 1);
  });

  it('is completable from July to the end of October', () => {
    const s = newCampaign(2, opts);
    let n = 0;
    while (!s.ended && n < 500) { applySortie(s, result(s)); n++; }
    expect(s.ended).toBe('october');
    expect(n).toBeGreaterThan(CAMPAIGN_DAYS.length);
    expect(n).toBeLessThanOrEqual(CAMPAIGN_DAYS.length * 3);
    const sc = campaignScore(s);
    expect(sc.total).toBeGreaterThan(0);
    expect(sc.total).toBe(sc.airfields + sc.raids + sc.survival + sc.record + sc.rank);
    // Losses happened off-screen and replacements came in.
    expect(s.stats.pilotsTotal).toBeGreaterThan(TUNING.campaign.startPilots);
  });

  it('flies 1-3 sorties a day, and two on 15 September', () => {
    const s = newCampaign(3, opts);
    for (let i = 0; i < CAMPAIGN_DAYS.length; i++) {
      s.dayIdx = i;
      const n = sortiesToday(s);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(3);
      const d = campaignDate(s);
      if (d.month === 9 && d.day === 15) expect(n).toBe(2);
    }
  });

  it('builds a full sortie spec: phase from the date, the roster in the air, three raids or more on 15 September', () => {
    const map = worldMap();
    const s = newCampaign(4, opts);
    const spec = nextSortieSpec(s, map, { convergenceM: 230, assist: true });
    expect(spec.phase).toBe('channel');
    expect(spec.playerName).toBe('P/O Fenwick');
    expect(spec.others.every((o) => o.id! > 0)).toBe(true);
    s.dayIdx = CAMPAIGN_DAYS.findIndex(([m, d]) => m === 9 && d === 15);
    const big = nextSortieSpec(s, map, { convergenceM: 230, assist: true });
    expect(big.phase).toBe('london');
    expect(big.raids.filter((r) => r.name !== 'freehunt').length).toBeGreaterThanOrEqual(3);
  });

  it('fatigue builds with sorties and rests overnight', () => {
    const s = newCampaign(5, opts);
    const n = sortiesToday(s);
    for (let i = 0; i < n - 1; i++) applySortie(s, result(s));
    const tired = s.player.fatigue;
    expect(tired).toBeGreaterThan(0);
    applySortie(s, result(s)); // last of the day: overnight
    expect(s.player.fatigue).toBeLessThan(tired + TUNING.campaign.fatiguePerSortie);
  });
});

describe('promotion', () => {
  it('to Flight Lieutenant with sorties and victories, then Squadron Leader', () => {
    const s = newCampaign(6, opts);
    for (let i = 0; i < TUNING.campaign.fltLtSorties - 1; i++) applySortie(s, result(s, {}, i < 2 ? 1 : 0));
    expect(s.player.rank).toBe('P/O');
    applySortie(s, result(s));
    expect(s.player.rank).toBe('F/Lt');
    // Leading a flight now.
    const f = formationFor(s);
    expect(f.leading).toBe(true);
    expect(f.others.length).toBeLessThanOrEqual(TUNING.campaign.flightSize - 1);
    for (let i = 0; i < TUNING.campaign.sqnLdrSortiesAtRank; i++) applySortie(s, result(s, {}, 1));
    expect(s.player.rank).toBe('S/Ldr');
    expect(formationFor(s).others.length).toBeGreaterThan(TUNING.campaign.flightSize - 1);
    expect(s.roster.some((p) => p.role === 'CO' && p.status === 'fit')).toBe(false);
  });

  it('on sorties alone, eventually', () => {
    const s = newCampaign(7, opts);
    for (let i = 0; i < TUNING.campaign.fltLtSortiesAlone; i++) applySortie(s, result(s));
    expect(s.player.rank).not.toBe('P/O');
  });

  it('fills a vacancy: lose the flight commander and an experienced P/O takes the flight', () => {
    const s = newCampaign(8, opts);
    for (let i = 0; i < TUNING.campaign.vacancySorties; i++) applySortie(s, result(s));
    expect(s.player.rank).toBe('P/O');
    const b = s.roster.find((p) => p.role === 'B')!;
    const r = result(s);
    const f = r.fates.find((x) => x.id === b.id);
    if (f) f.fate = 'lost'; else r.fates.push({ id: b.id, name: b.surname, fate: 'lost', kills: 0 });
    const news = applySortie(s, r);
    expect(s.player.rank).toBe('F/Lt');
    expect(news.join(' ')).toMatch(/B Flight/);
  });

  it('the CO lost: the senior flight commander takes the squadron', () => {
    const s = newCampaign(9, opts);
    const co = s.roster.find((p) => p.role === 'CO')!;
    const a = s.roster.find((p) => p.role === 'A')!;
    const r = result(s);
    r.fates.find((x) => x.id === co.id)!.fate = 'lost';
    applySortie(s, r);
    expect(a.role).toBe('CO');
    expect(a.rank).toBe('S/Ldr');
    expect(s.roster.filter((p) => p.role === 'A' && p.status === 'fit').length).toBe(1);
  });
});

describe('the player\'s fate', () => {
  it('Ironman: a lost pilot ends the career', () => {
    const s = newCampaign(10, { ...opts, ironman: true });
    applySortie(s, result(s, { outcome: { kind: 'killed', pilot: 'lost', aircraft: 'writeOff', place: '', line: '' } }));
    expect(s.ended).toBe('killed');
    const p = newCampaign(10, { ...opts, ironman: true });
    applySortie(p, result(p, { outcome: { kind: 'pow', pilot: 'lost', aircraft: 'writeOff', place: '', line: '' } }));
    expect(p.ended).toBe('pow');
  });

  it('not Ironman: the sortie is flown again with a fresh seed', () => {
    const map = worldMap();
    const s = newCampaign(11, opts);
    const seed = nextSortieSpec(s, map, { convergenceM: 230, assist: true }).seed;
    applySortie(s, result(s, { outcome: { kind: 'killed', pilot: 'lost', aircraft: 'writeOff', place: '', line: '' } }));
    expect(s.ended).toBeNull();
    expect(s.player.sorties).toBe(0);
    expect(s.dayIdx).toBe(0);
    expect(nextSortieSpec(s, map, { convergenceM: 230, assist: true }).seed).not.toBe(seed);
  });

  it('wounded: days in hospital pass off-screen, then back on the squadron', () => {
    const s = newCampaign(12, opts);
    const day0 = s.dayIdx;
    applySortie(s, result(s, { outcome: { kind: 'belly', pilot: 'wounded', aircraft: 'repairable', place: '', line: '' } }));
    expect(s.player.status).toBe('fit');
    expect(s.dayIdx).toBeGreaterThan(day0);
    expect(s.news.join(' ')).toMatch(/hospital/);
    expect(s.repairs.length + s.aircraftServiceable).toBeGreaterThan(0);
  });
});

describe('squadron and airfields', () => {
  it('losses come off the roster and replacements arrive', () => {
    const s = newCampaign(13, opts);
    const r = result(s);
    r.fates.slice(3, 6).forEach((f) => (f.fate = 'lost'));
    const fit = fitPilots(s).length;
    applySortie(s, r);
    expect(s.stats.lost).toBe(3);
    // Play on a few days: replacements top the squadron up.
    for (let i = 0; i < 8 && !s.ended; i++) applySortie(s, result(s));
    expect(s.roster.filter((p) => p.status === 'fit' || p.status === 'wounded').length).toBeGreaterThanOrEqual(fit - 5);
    expect(s.news.some((n) => /joins the squadron/.test(n))).toBe(true);
  });

  it('a bombed airfield closes, gets craters, and is repaired', () => {
    const map = worldMap();
    const s = newCampaign(14, opts);
    while (sortiesToday(s) < 2) s.dayIdx++;
    const n = sortiesToday(s);
    applySortie(s, result(s, { airfieldHits: { 'Biggin Hill': 30 } }));
    expect(s.airfields['Biggin Hill']).toBeGreaterThanOrEqual(TUNING.campaign.closedAt);
    applyAirfieldState(s, map);
    const af = map.airfieldByName('Biggin Hill')!;
    expect(af.craters.length).toBeGreaterThan(10);
    for (let i = 1; i < n; i++) applySortie(s, result(s));
    for (let i = 0; i < 6; i++) applySortie(s, result(s)); // some days later
    expect(s.airfields['Biggin Hill']).toBeLessThan(TUNING.campaign.closedAt);
    applyAirfieldState(s, map);
    expect(af.craters.length).toBeLessThan(10);
  });

  it('offers the pairs formation from Adlertag', () => {
    const s = newCampaign(15, opts);
    while (!s.pairsOffered && !s.ended) applySortie(s, result(s));
    const d = campaignDate(s);
    expect(d.month * 100 + d.day).toBeGreaterThanOrEqual(813);
    expect(s.news.some((n) => /pairs/.test(n))).toBe(true);
  });

  it('pairs lose fewer pilots than vics over the campaign (off-screen)', () => {
    let vic = 0, pairs = 0;
    for (let seed = 20; seed < 26; seed++) {
      for (const f of ['vic', 'pairs'] as const) {
        const s = newCampaign(seed, opts);
        s.formation = f;
        while (!s.ended) applySortie(s, result(s));
        if (f === 'vic') vic += s.stats.lost; else pairs += s.stats.lost;
      }
    }
    expect(pairs).toBeLessThan(vic);
  });
});

describe('save and load', () => {
  it('round-trips, rejects other versions and junk, and resets', () => {
    const st = memStore();
    expect(loadCampaign(st)).toEqual({ ok: false, reason: 'none' });
    const s = newCampaign(16, opts);
    applySortie(s, result(s, {}, 1));
    saveCampaign(s, st);
    const l = loadCampaign(st);
    expect(l.ok).toBe(true);
    if (l.ok) expect(l.state).toEqual(s);
    st.data.set('scramble.campaign', JSON.stringify({ ...s, version: 999 }));
    expect(loadCampaign(st)).toEqual({ ok: false, reason: 'version' });
    st.data.set('scramble.campaign', '{nope');
    expect(loadCampaign(st)).toEqual({ ok: false, reason: 'corrupt' });
    resetCampaign(st);
    expect(loadCampaign(st)).toEqual({ ok: false, reason: 'none' });
  });

  it('the same seed and results give the same campaign', () => {
    const a = newCampaign(17, opts), b = newCampaign(17, opts);
    for (let i = 0; i < 20; i++) { applySortie(a, result(a)); applySortie(b, result(b)); }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
