// Raid templates for each phase of the battle. Sizes are per raid that this
// squadron meets (other squadrons are dealing with the rest).

import type { AircraftId } from './aircraft';
import type { GroupRole, RaidKind } from '../sim/raid';
import type { SkillLevel } from '../sim/ai/types';
import type { Phase } from './text/briefing';

export interface GroupTemplate {
  type: AircraftId;
  count: [number, number];
  role: GroupRole;
  altOffset: number;
  skill: SkillLevel[];
}

export interface RaidTemplate {
  kind: RaidKind;
  /** Bomber height range (m). */
  alt: [number, number];
  speed: number;
  groups: GroupTemplate[];
  weight: number;
}

const ESCORT_109: GroupTemplate = { type: 'bf109', count: [4, 8], role: 'closeEscort', altOffset: 600, skill: ['average', 'average', 'experte', 'green'] };
const TOP_COVER: GroupTemplate = { type: 'bf109', count: [4, 8], role: 'topCover', altOffset: 2000, skill: ['average', 'experte'] };

export const RAID_TEMPLATES: Record<Phase, RaidTemplate[]> = {
  channel: [
    { kind: 'convoy', alt: [1800, 3000], speed: 75, weight: 3, groups: [
      { type: 'ju87', count: [6, 9], role: 'diveBomber', altOffset: 0, skill: ['average'] },
      { ...ESCORT_109, count: [4, 6] },
    ] },
    { kind: 'convoy', alt: [2500, 4000], speed: 85, weight: 2, groups: [
      { type: 'do17', count: [6, 9], role: 'bomber', altOffset: 0, skill: ['average'] },
      ESCORT_109,
    ] },
    { kind: 'sweep', alt: [5000, 7000], speed: 110, weight: 1, groups: [
      { type: 'bf109', count: [6, 10], role: 'sweep', altOffset: 0, skill: ['average', 'experte'] },
    ] },
  ],
  airfields: [
    { kind: 'airfield', alt: [3500, 5000], speed: 85, weight: 3, groups: [
      { type: 'do17', count: [9, 15], role: 'bomber', altOffset: 0, skill: ['average', 'green'] },
      ESCORT_109, TOP_COVER,
    ] },
    { kind: 'airfield', alt: [4000, 5500], speed: 82, weight: 3, groups: [
      { type: 'he111', count: [9, 15], role: 'bomber', altOffset: 0, skill: ['average', 'green'] },
      { type: 'bf110', count: [4, 8], role: 'zerstorer', altOffset: 500, skill: ['average'] },
      ESCORT_109,
    ] },
    { kind: 'airfield', alt: [4500, 6000], speed: 100, weight: 2, groups: [
      { type: 'ju88', count: [6, 12], role: 'bomber', altOffset: 0, skill: ['average'] },
      ESCORT_109,
    ] },
    { kind: 'radar', alt: [2000, 3500], speed: 95, weight: 1, groups: [
      { type: 'bf110', count: [6, 9], role: 'zerstorer', altOffset: 0, skill: ['average', 'experte'] },
      { ...ESCORT_109, count: [4, 4] },
    ] },
  ],
  london: [
    { kind: 'london', alt: [4500, 6000], speed: 82, weight: 3, groups: [
      { type: 'he111', count: [15, 24], role: 'bomber', altOffset: 0, skill: ['average', 'green'] },
      { type: 'do17', count: [9, 12], role: 'bomber', altOffset: -300, skill: ['average'] },
      { ...ESCORT_109, count: [6, 10] }, { ...TOP_COVER, count: [6, 12] },
    ] },
    { kind: 'london', alt: [5000, 6500], speed: 85, weight: 2, groups: [
      { type: 'do17', count: [15, 21], role: 'bomber', altOffset: 0, skill: ['average'] },
      { type: 'bf110', count: [6, 9], role: 'zerstorer', altOffset: 400, skill: ['average'] },
      { ...ESCORT_109, count: [6, 10] }, TOP_COVER,
    ] },
  ],
  jabo: [
    { kind: 'jabo', alt: [7000, 8500], speed: 135, weight: 3, groups: [
      { type: 'bf109', count: [4, 8], role: 'jabo', altOffset: 0, skill: ['average', 'experte'] },
      { type: 'bf109', count: [6, 12], role: 'topCover', altOffset: 1000, skill: ['average', 'experte'] },
    ] },
    { kind: 'sweep', alt: [7500, 9000], speed: 120, weight: 1, groups: [
      { type: 'bf109', count: [8, 16], role: 'sweep', altOffset: 0, skill: ['average', 'experte'] },
    ] },
  ],
};

/** Phase by date (1940). */
export function phaseFor(month: number, day: number): Phase {
  if (month === 7 || (month === 8 && day < 12)) return 'channel';
  if (month === 8 || (month === 9 && day < 7)) return 'airfields';
  if (month === 9) return 'london';
  return 'jabo';
}

/** Raid targets by kind (lat, lon). Airfield raids pick from the 11 Group stations. */
export const TARGETS = {
  convoy: [{ name: 'a convoy off Dover', lat: 51.05, lon: 1.42 }, { name: 'a convoy off Folkestone', lat: 51.02, lon: 1.2 }, { name: 'a convoy off Dungeness', lat: 50.86, lon: 0.92 }, { name: 'a convoy off Beachy Head', lat: 50.68, lon: 0.3 }],
  radar: [{ name: 'the Dover radar', lat: 51.1338, lon: 1.338 }, { name: 'the Rye radar', lat: 50.957, lon: 0.73 }, { name: 'the Pevensey radar', lat: 50.822, lon: 0.332 }, { name: 'the Dunkirk radar', lat: 51.29, lon: 0.971 }],
  london: [{ name: 'the London docks', lat: 51.502, lon: -0.02 }, { name: 'the Surrey Docks', lat: 51.496, lon: -0.045 }, { name: 'Woolwich Arsenal', lat: 51.49, lon: 0.07 }],
  airfield: ['Biggin Hill', 'Kenley', 'Hornchurch', 'North Weald', 'Manston', 'Hawkinge', 'West Malling', 'Detling', 'Eastchurch', 'Croydon', 'Tangmere', 'Lympne', 'Gravesend', 'Debden', 'Northolt'],
  sweep: [{ name: 'Kent', lat: 51.2, lon: 0.6 }, { name: 'the Thames estuary', lat: 51.45, lon: 0.6 }],
  jabo: [{ name: 'London', lat: 51.5, lon: -0.1 }, { name: 'Maidstone', lat: 51.27, lon: 0.53 }, { name: 'Biggin Hill', lat: 51.33, lon: 0.03 }],
};

/** Where raids form up and cross the French coast. */
export const ASSEMBLY = [
  { lat: 50.95, lon: 1.9 }, { lat: 50.88, lon: 1.75 }, { lat: 50.75, lon: 1.65 }, { lat: 51.0, lon: 2.2 },
];
