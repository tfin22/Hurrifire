import { it } from 'vitest';
import { AIRCRAFT, AircraftId, stallSpeed, massOf } from '../src/content/aircraft';
import { climbRate, diveSpeed, levelTopSpeed, mph, fpm, sustainedTurnRate, turnTime } from './helpers/flightHarness';

it.skipIf(!process.env.PROBE)('probe performance', () => {
  const ids: AircraftId[] = ['spitfire', 'hurricane', 'bf109', 'bf110', 'do17', 'he111', 'ju88', 'ju87'];
  for (const id of ids) {
    const t = AIRCRAFT[id];
    const vs = stallSpeed(t, massOf(t, t.fuelCapacity * 0.8));
    const top0 = levelTopSpeed(id, 300), top5 = levelTopSpeed(id, 5500);
    const climb = climbRate(id, 1500, t.role === 'fighter' ? 75 : 80);
    const turn = sustainedTurnRate(id, 4500, 110);
    const tt = turnTime(id, 4500, 110);
    const dive = diveSpeed(id, 7000, 110, 20);
    console.log(`${t.short.padEnd(9)} stall ${mph(vs).toFixed(0)}mph  top SL ${mph(top0).toFixed(0)} / 18k ${mph(top5).toFixed(0)} mph  climb ${fpm(climb).toFixed(0)} fpm  sust.turn ${turn.toFixed(1)} deg/s  360 in ${tt.time.toFixed(1)}s (lost ${tt.altLoss.toFixed(0)}m, end ${mph(tt.endSpeed).toFixed(0)})  dive20s ${mph(dive).toFixed(0)} mph`);
  }
}, 60000);

it.skipIf(!process.env.PROBE)('turn by altitude', () => {
  for (const alt of [1000, 4500, 6500]) {
    const r = (['spitfire', 'hurricane', 'bf109'] as AircraftId[]).map((id) => `${id} ${sustainedTurnRate(id, alt, 110).toFixed(1)}`);
    console.log(`alt ${alt}: ${r.join('  ')}`);
  }
}, 60000);
