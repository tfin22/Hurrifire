// Starting up at readiness: prime her as the fitter says, magnetos on, and
// a turn on the starter. Primed right she usually catches first time, but
// not always; too little and she coughs and dies; too much and she floods.

import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { worldMap } from '../src/content/world/map';
import { WorldObjects } from '../src/content/world/objects';
import type { SimCmd } from '../src/input/input';
import { Sortie, SortieSpec } from '../src/sim/sortie';
import { generateWeather } from '../src/sim/weather';
import { TUNING } from '../src/tuning';

const map = worldMap();
const objects = new WorldObjects(map);
const home = map.airfieldByName('Biggin Hill')!;

function sortie(seed: number, o: Partial<SortieSpec> = {}): Sortie {
  return new Sortie({
    seed, month: 8, day: 18, hour: 13, weather: { ...generateWeather(new Rng(seed), 8), cover: 0 }, phase: 'airfields',
    home: home.name, playerType: 'hurricane', playerName: 'P/O Test', squadron: 'Gannet', controller: 'Sapper',
    leading: true, others: [], raids: [], start: 'readiness', convergenceM: 274, underAttack: false, fatigue: 0, assist: false,
    otherSquadrons: false, ...o,
  }, map, objects);
}

const still = { pitch: 0, roll: 0, yaw: 0, throttle: 0, fire: false, boost: false, brake: true, pump: false };
const wait = (s: Sortie, secs: number) => { for (let i = 0; i < secs * 50; i++) s.step(still); };
const press = (s: Sortie, ...cmds: SimCmd[]) => s.step({ ...still, cmds });
/** Turns on the starter until she catches (or `max` turns). */
function crankUntil(s: Sortie, max: number): number {
  for (let k = 1; k <= max; k++) {
    press(s, 'starter');
    wait(s, TUNING.sortie.crankToCatch + 0.5);
    if (s.player.fs.engine === 'running') return k;
  }
  return Infinity;
}

describe('starting up', () => {
  it('the fitter says how many strokes: more on a cold morning or late in the year', () => {
    const need = (o: Partial<SortieSpec>) => Array.from({ length: 30 }, (_, i) => sortie(i + 1, o).primeNeed);
    const afternoon = need({}), dawn = need({ hour: 6 });
    expect(Math.min(...afternoon)).toBe(TUNING.sortie.primeBase);
    expect(Math.min(...dawn)).toBe(TUNING.sortie.primeBase + 1);
    expect(new Set(afternoon).size).toBe(2);
    const s = sortie(1);
    expect(s.prompts[0]).toBe(`FITTER: ${s.primeNeed} STROKES SHOULD DO HER, SIR`);
  });

  it('done as the fitter says, she usually catches first turn, and always within a few', () => {
    const turns = Array.from({ length: 40 }, (_, i) => {
      const s = sortie(i + 1);
      press(s, ...Array<SimCmd>(s.primeNeed).fill('primer'), 'mags');
      return crankUntil(s, 6);
    });
    const first = turns.filter((t) => t === 1).length / turns.length;
    expect(first).toBeGreaterThan(0.6);
    expect(first).toBeLessThan(0.95);
    expect(Math.max(...turns)).toBeLessThanOrEqual(5);
  });

  it('magnetos off, or no priming: she never fires, and says why', () => {
    const a = sortie(3);
    press(a, ...Array<SimCmd>(a.primeNeed).fill('primer'));
    expect(crankUntil(a, 3)).toBe(Infinity);
    expect(a.lastStart).toBe('mags');
    expect(a.prompts).toContain('MAGNETOS ARE OFF');
    const b = sortie(3);
    press(b, 'mags');
    expect(crankUntil(b, 3)).toBe(Infinity);
    expect(b.prompts).toContain('NOT PRIMED - SHE WON\'T FIRE');
  });

  it('a stroke short: now and then she catches, more often she coughs and dies', () => {
    let caught = 0;
    for (let i = 1; i <= 40; i++) {
      const s = sortie(i);
      press(s, ...Array<SimCmd>(s.primeNeed - 1).fill('primer'), 'mags');
      if (crankUntil(s, 1) === 1) caught++;
      else expect(s.prompts).toContain('SHE COUGHS AND DIES - ANOTHER STROKE');
    }
    expect(caught).toBeGreaterThan(3);
    expect(caught).toBeLessThan(25);
  });

  it('over-primed she floods; turning her over clears it, then she starts', () => {
    const s = sortie(5);
    press(s, ...Array<SimCmd>(s.primeNeed + TUNING.sortie.primeFlood + 3).fill('primer'), 'mags');
    press(s, 'starter');
    wait(s, 3);
    expect(s.player.fs.engine).toBe('off');
    expect(s.prompts).toContain('FLOODED - KEEP CRANKING TO CLEAR HER');
    expect(crankUntil(s, 8)).toBeLessThan(Infinity);
  });

  it('the one START key does the next step each press, never over-priming', () => {
    const s = sortie(9);
    const steps: string[] = [];
    for (let i = 0; i < 30 && s.player.fs.engine !== 'running'; i++) {
      if (s.player.fs.engine === 'off') { steps.push(s.nextStartStep()); press(s, s.nextStartStep()); }
      wait(s, 0.5);
    }
    expect(s.player.fs.engine).toBe('running');
    expect(steps.slice(0, s.primeNeed + 2)).toEqual([...Array(s.primeNeed).fill('primer'), 'mags', 'starter']);
    expect(s.engineStart.strokes).toBe(s.primeNeed);
  });

  it('assist START does it all, step by step, and always gets her going', () => {
    for (let i = 1; i <= 20; i++) {
      const s = sortie(i, { assist: true, hour: 6 });
      press(s, 'startAll');
      let t = 0;
      while (s.player.fs.engine !== 'running' && t < 30) { s.step(still); t += TUNING.sim.dt; }
      expect(s.player.fs.engine).toBe('running');
      expect(t).toBeLessThan(15);
      expect(s.engineStart.strokes).toBe(s.primeNeed);
    }
  });
});
