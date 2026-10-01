// Campaign text: the days of the battle, the squadron's news, promotions,
// and the verdict at the end. Templates only; the logic is in campaign/.

import type { Phase } from './briefing';

/** The days the campaign plays, July to the end of October. Days in between pass off-screen. */
export const CAMPAIGN_DAYS: [number, number][] = [
  [7, 10], [7, 13], [7, 19], [7, 25], [7, 29],
  [8, 8], [8, 11], [8, 12], [8, 13], [8, 15], [8, 16], [8, 18], [8, 24], [8, 26], [8, 30], [8, 31],
  [9, 1], [9, 4], [9, 6], [9, 7], [9, 9], [9, 11], [9, 15], [9, 18], [9, 27], [9, 30],
  [10, 5], [10, 12], [10, 15], [10, 25], [10, 29],
];

/** Days with a story of their own. */
export const DAY_NOTES: Record<string, string> = {
  '7-10': 'Convoys in the Channel have been bombed for a week. Today it starts in earnest.',
  '8-13': 'Adlertag: Eagle Day. The Luftwaffe means to destroy Fighter Command on the ground.',
  '8-15': 'Raids from Norway in the north and over Kent in the south. The hardest day yet.',
  '8-18': 'The Hardest Day. Kenley and Biggin Hill are the targets.',
  '8-30': 'Biggin Hill has been bombed again. The sector stations are in a bad way.',
  '9-7': 'The bombers have turned on London. The docks are burning.',
  '9-15': 'Two great raids on London, one this morning and one this afternoon. Everything is up.',
  '9-27': 'One of the last big daylight raids.',
  '10-5': 'Bomb-carrying 109s, very high and very fast. Hard to catch.',
  '10-29': 'The last days. The weather is closing in.',
};

export const PHASE_NAMES: Record<Phase, string> = {
  channel: 'The Channel battles',
  airfields: 'The airfields',
  london: 'London',
  jabo: 'The fighter-bombers',
};

export const RANK_NAMES = { 'P/O': 'Pilot Officer', 'F/Lt': 'Flight Lieutenant', 'S/Ldr': 'Squadron Leader' } as const;

export const NEWS = {
  promotedFlt: (name: string) => `You are promoted Flight Lieutenant and given B Flight. ${name} is posted to an OTU to instruct.`,
  promotedFltVacancy: (name: string) => `With ${name} gone you are given B Flight, and the rank of Flight Lieutenant.`,
  promotedSqn: (name: string) => `You are promoted Squadron Leader and given the squadron. ${name} is rested.`,
  promotedSqnVacancy: (name: string) => `With ${name} gone the squadron is yours. You are promoted Squadron Leader.`,
  newCO: (name: string) => `${name} takes over the squadron.`,
  newFlt: (name: string) => `${name} takes over a flight.`,
  replacementPilot: (name: string, green: boolean) => `${name} joins the squadron${green ? ', straight from an OTU with a dozen hours on type' : ''}.`,
  replacementAircraft: (n: number) => `${n === 1 ? 'A replacement aircraft arrives' : `${n} replacement aircraft arrive`} from the Maintenance Unit.`,
  repaired: (n: number) => `${n === 1 ? 'One aircraft is' : `${n} aircraft are`} back from repair.`,
  backFromHospital: (name: string) => `${name} is back from hospital.`,
  rested: (name: string) => `${name} is stood down for a rest.`,
  lostOffscreen: (name: string) => `${name} did not come back.`,
  safeOffscreen: (name: string) => `${name} baled out and is safe.`,
  woundedOffscreen: (name: string) => `${name} was wounded and is in hospital.`,
  airfieldBombed: (name: string) => `${name} was bombed.`,
  airfieldClosed: (name: string) => `${name} is out of action.`,
  airfieldOpen: (name: string) => `${name} is serviceable again.`,
  youWounded: (days: number) => `You are in hospital for ${days} days. The squadron fights on without you.`,
  youBack: 'You are passed fit and back on the squadron.',
  pairsAvailable: 'The squadron could fly in pairs now: looser, every pilot searching the sky. The vic is pretty but it gets people killed.',
  refly: 'The sortie is struck from the record. (Not Ironman: fly it again.)',
  quietDays: (n: number) => `${n === 1 ? 'A day passes' : `${n} days pass`} before the next big day.`,
  sortiesFlown: (n: number, kills: number) => `The squadron flew ${n} sortie${n === 1 ? '' : 's'} meanwhile${kills ? ` and claimed ${kills}` : ''}.`,
};

export const VERDICTS = [
  { min: 800, text: 'Your sector held, and your squadron with it. That was the battle won.' },
  { min: 650, text: 'A hard summer, well fought. The sector held when it mattered.' },
  { min: 500, text: 'The sector was battered but never broken. The squadron did its share.' },
  { min: 350, text: 'Too many raids got through, and too many pilots did not come back.' },
  { min: 0, text: 'A grim summer. The squadron was withdrawn north to rebuild.' },
];

export const CAREER_END = {
  killed: 'Your career ended in the summer of 1940.',
  pow: 'You spent the rest of the war as a prisoner.',
};
