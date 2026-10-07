// Shared AI types: pilot skill, the view of the world an AI gets, and the
// brain interface every AI implements.

import { Vec3 } from '../../core/math';
import { Rng } from '../../core/rng';
import { TUNING } from '../../tuning';
import type { Plane } from '../plane';

export type SkillLevel = 'green' | 'average' | 'experte';

export interface Skill {
  level: SkillLevel;
  /** Spotting range multiplier. */
  spot: number;
  /** Gunnery quality, 0..1. */
  aim: number;
  /** Multiplier on how far the aim wanders (1 = as the grade has it; set by enemy difficulty). */
  wander?: number;
  /** Range (m) at which they open fire. */
  fireRange: number;
  /** Energy discipline: lowest IAS (m/s) they'll let a fight drag them to (0 = none). */
  minSpeed: number;
  /** Willingness to turn and fight rather than boom-and-zoom (0..1). */
  aggression: number;
  /** G they'll pull. */
  gLimit: number;
  /** Seconds between decisions. */
  think: number;
}

export function skillFor(level: SkillLevel): Skill {
  return { level, ...TUNING.ai.skills[level] };
}

/** Enemy difficulty setting. */
export type EnemyLevel = 'school' | 'normal' | 'veteran';
export const ENEMY_LEVELS: readonly EnemyLevel[] = ['school', 'normal', 'veteran'];

const GRADES: readonly SkillLevel[] = ['green', 'average', 'experte'];

/** An enemy pilot's skill at a difficulty: shifted a grade, then scaled. */
export function enemySkill(s: Skill, level: EnemyLevel): Skill {
  const d = TUNING.ai.enemy[level];
  if (level === 'normal') return s;
  const g = GRADES[Math.max(0, Math.min(GRADES.length - 1, GRADES.indexOf(s.level) + d.shift))];
  const b = skillFor(g);
  return {
    ...b,
    aim: Math.min(0.95, b.aim * d.aim),
    spot: b.spot * d.spot,
    think: b.think * d.think,
    gLimit: b.gLimit + d.gLimit,
    wander: d.wander,
  };
}

export interface AIContext {
  time: number;
  dt: number;
  rng: Rng;
  planes: readonly Plane[];
  sun: Vec3;
  /** Is the line of sight between two points clear of cloud? */
  losClear(a: Vec3, b: Vec3): boolean;
  /** Where "home" is for a side (France for the Luftwaffe, base for the RAF). */
  home(side: string, me: Plane): Vec3;
  groundAt(x: number, z: number): number;
}

export interface Brain {
  state: string;
  update(me: Plane, ctx: AIContext): void;
  /** Short label for the debug overlay. */
  label(): string;
  /** Called when we are hit (reaction). */
  onHit?(me: Plane, shooterId: number, ctx: AIContext): void;
}
