// Small ready-made situations: the 1-v-1 against a 109 (milestone 4), and
// helpers used by tests and the debug menu.

import { Vec3 } from '../core/math';
import { AircraftId } from '../content/aircraft';
import { GroundModel } from './ground';
import { FighterBrain } from './ai/fighter';
import { skillFor, SkillLevel } from './ai/types';
import { World } from './world';

export function oneVersusOne(seed: number, ground: GroundModel, playerType: AircraftId = 'spitfire', skill: SkillLevel = 'average', convergenceM = 274): World {
  const w = new World(seed, ground);
  const p = w.addPlane(playerType, 'raf', 'Gannet Leader', 0.75, convergenceM);
  p.isPlayer = true;
  w.player = p;
  p.fs.setAirborne(new Vec3(0, 3000, 0), 0, 120);
  p.fs.throttle = 0.85;
  const e = w.addPlane('bf109', 'lw', 'Gelb 3', 0.7);
  e.skill = skillFor(skill);
  e.fs.setAirborne(new Vec3(400, 3400, 4500), Math.PI, 125);
  e.brain = new FighterBrain({ waypoint: new Vec3(0, 3400, -20000) });
  w.homes.raf = new Vec3(0, 1000, 0);
  return w;
}
