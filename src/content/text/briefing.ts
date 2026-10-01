// Intelligence briefings, weather-board text, debrief and logbook phrasing.
// Templates only.

import { Rng } from '../../core/rng';

export type Phase = 'channel' | 'airfields' | 'london' | 'jabo';

export const INTEL: Record<Phase, string[]> = {
  channel: [
    'Convoys passing Dover in the forenoon. Expect Stukas with 109 escort, low over the water.',
    'Plots building over Cap Gris Nez. Jerry is after the convoys again.',
    'Small raids on the Channel ports. Dover had a pasting yesterday.',
    'Intelligence says the 109s are coming over higher and later. Watch the sun.',
  ],
  airfields: [
    'Large raids building over Calais. The airfields are the target now, ours included.',
    'Manston and Hawkinge took it badly yesterday. Expect the sector stations next.',
    'Raids coming in two waves: fighters first to draw us up, then the bombers.',
    'Ground crews have filled the worst craters overnight. Mind the flags.',
    'The radar stations were hit this morning. Plots may be late and rough.',
  ],
  london: [
    'Huge formations massing over the Pas-de-Calais. London is the target.',
    'The docks are still burning. Follow the smoke if you lose your way.',
    'Bombers in boxes of thirty and more, escort stacked up to angels thirty.',
    'Big Wing from 12 Group may join us over London. Leave the bombers to nobody.',
  ],
  jabo: [
    'High-flying 109s carrying bombs, coming in fast at angels twenty-five plus.',
    'Fighter-bombers again. They drop and run; you need height early.',
    'Small, fast raids. Standing patrols at height are the only answer.',
  ],
};

export const WEATHER_BOARD = (summary: string, base: number, cover: number, wind: string, vis: string) => [
  summary,
  `Cloud: ${Math.round(cover * 8)}/8 cumulus, base ${Math.round((base * 3.28) / 500) * 500} ft`,
  wind,
  `Visibility: ${vis}`,
];

export const DISPERSAL = {
  waiting: ['Somebody puts the gramophone on again.', 'More tea from the urn.', 'A game of draughts nobody finishes.', 'The adjutant reads out the post.', 'Someone dozes in a deckchair.'],
  ring: 'The telephone rings.',
  scramble: 'Squadron, SCRAMBLE!',
};

// ----------------------------------------------------------- debrief

export const DEBRIEF = {
  claim: (n: number, type: string, what: string) => `${n} ${type} ${what}`,
  confirmed: 'Confirmed: seen to crash.',
  downgraded: 'Nobody saw it go in. Allowed as a probable.',
  damaged: 'Allowed as damaged.',
  overSea: 'Went down into the sea; no wreck to find.',
  raidTurned: (target: string) => `The raid on ${target} was turned back before it bombed.`,
  raidBombed: (target: string, hits: number) => `The raid reached ${target}. ${hits > 0 ? 'Bombs fell on the target.' : 'The bombing was scattered.'}`,
  raidPartial: (target: string) => `Part of the raid got through to ${target}; the rest turned for home.`,
  ditchAdvice: 'The IO notes, gently, that over the sea the parachute is usually the wiser choice.',
};

export const SHOOTING_PHRASES = ['Opened fire at {range} yards.', 'Fired {secs} seconds in all.'];

// ----------------------------------------------------------- logbook

const ENGAGED = ['Engaged {types} over {place}.', 'Intercepted {types} near {place}.', 'Mixed it with {types} over {place}.', 'Patrolled {place}; met {types}.'];
const NO_CONTACT = ['Patrol over {place}. No contact.', 'Scrambled; vectored about over {place}. Saw nothing.', 'Raid turned back before we got there.'];

export function logEngaged(rng: Rng, types: string, place: string): string {
  return rng.pick(ENGAGED).replace('{types}', types).replace('{place}', place);
}

export function logNoContact(rng: Rng, place: string): string {
  return rng.pick(NO_CONTACT).replace('{place}', place);
}

export function logClaims(destroyed: number, probable: number, damaged: number, type: string): string {
  const parts: string[] = [];
  if (destroyed) parts.push(`${destroyed === 1 ? 'One' : numberWord(destroyed)} destroyed`);
  if (probable) parts.push(`${probable === 1 ? 'one' : numberWord(probable)} probable`);
  if (damaged) parts.push(`${damaged === 1 ? 'one' : numberWord(damaged)} damaged`);
  if (!parts.length) return '';
  return `${cap(parts.join(', '))}${type ? ` (${type})` : ''}.`;
}

/** How you got down: "Hit in the glycol, forced landing near Ashford." etc. */
export const LANDING_LINES: Record<string, (place: string, surface: string, cause: string) => string> = {
  greaser: (place) => `Landed back at ${place}.`,
  roll: (place) => `Landed back at ${place}.`,
  bounce: (place) => `Bounced in at ${place}.`,
  groundLoop: (place) => `Ground-looped landing at ${place}. Wingtip bent.`,
  noseOver: (place, surface, cause) => `${cause}Tipped onto the nose in a ${surface} near ${place}.`,
  belly: (place, surface, cause) => `${cause}Wheels-up in a ${surface} near ${place}. Walked to the pub and telephoned the squadron.`,
  crashSurvived: (place, _surface, cause) => `${cause}Crash-landed near ${place}. Aircraft a write-off; I'm all right, more or less.`,
  ditched: (place, _s, cause) => `${cause}Ditched off ${place}. Picked up by a rescue launch, cold and wet.`,
  forced: (place, surface, cause) => `${cause}Forced landing in a ${surface} near ${place}.`,
  bailLand: (place, _s, cause) => `${cause}Baled out over ${place}. Back with the squadron by evening, a little shaken.`,
  bailSeaRescued: (place, _s, cause) => `${cause}Baled out over the Channel off ${place}. Picked up after an hour in the water.`,
};

export const LOSS_LINES = {
  lostSea: (name: string, place: string) => `${name} baled out over the Channel off ${place}. Not picked up.`,
  lostCrash: (name: string, place: string) => `${name} was killed when his aircraft crashed near ${place}.`,
  lostAir: (name: string, place: string) => `${name} was shot down over ${place} and killed.`,
  pow: (name: string) => `${name} came down in France and is a prisoner.`,
};

export const CAUSE: Record<string, string> = {
  glycol: 'Hit in the glycol. ',
  oil: 'Oil all over the windscreen. ',
  fire: 'Fire in the cockpit. ',
  seized: 'Engine seized. ',
  fuel: 'Ran out of fuel. ',
  controls: 'Controls shot about. ',
  gear: 'Undercarriage shot up. ',
  none: '',
};

export function numberWord(n: number): string {
  return ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] ?? String(n);
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Invented pilots for the squadron roster. */
export const PILOT_NAMES = {
  british: ['Ashworth', 'Bellamy', 'Carver', 'Denholm', 'Ellison', 'Fenwick', 'Gilbey', 'Hartley', 'Ingram', 'Jessop', 'Kendrick', 'Lacey', 'Maitland', 'Norris', 'Oakley', 'Pemberton', 'Quinn', 'Radley', 'Selwyn', 'Thursby', 'Upton', 'Vernon', 'Wakeham', 'Yardley'],
  first: ['John', 'Peter', 'Tony', 'Dick', 'Bill', 'Geoffrey', 'Hugh', 'Colin', 'Brian', 'Ronnie', 'Ted', 'Michael', 'Derek', 'Ian', 'Alan', 'Robert'],
  polish: ['Kowalczyk', 'Zieliński', 'Wróblewski', 'Nowicki', 'Sobczak'],
  czech: ['Novák', 'Dvořák', 'Kubíček', 'Procházka'],
  canadian: ['McAllister', 'Bouchard', 'Fraser', 'Lindsay'],
  newZealand: ['Te Whata', 'Rangi', 'McKenzie', 'Hobbs'],
  australian: ['Callaghan', 'Doyle'],
  southAfrican: ['van der Berg', 'Pretorius'],
};
