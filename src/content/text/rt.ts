// R/T phraseology: the sector controller and the squadron. Period vocabulary:
// vector (heading), angels (height in thousands of feet), bandits (enemy),
// buster (full speed), orbit (circle), pancake (land), tally-ho (enemy seen).
// Templates only — the logic that decides what to say is in sim/controller.ts.

import { Rng } from '../../core/rng';

const DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/** "one-two-zero" for 120°. */
export function sayHeading(deg: number): string {
  const d = ((Math.round(deg / 5) * 5) % 360 + 360) % 360;
  return String(d).padStart(3, '0').split('').map((c) => DIGITS[+c]).join('-');
}

/** "two-zero" for 20,000 ft. */
export function sayAngels(feet: number): string {
  const a = Math.max(1, Math.round(feet / 1000));
  return String(a).split('').map((c) => DIGITS[+c]).join('-');
}

export function sayStrength(n: number): string {
  if (n >= 100) return 'a hundred-plus';
  if (n >= 60) return 'sixty-plus';
  if (n >= 50) return 'fifty-plus';
  if (n >= 40) return 'forty-plus';
  if (n >= 30) return 'thirty-plus';
  if (n >= 20) return 'twenty-plus';
  if (n >= 12) return 'twelve-plus';
  if (n >= 6) return 'six-plus';
  return 'a few';
}

export function sayMiles(m: number): string {
  const mi = Math.max(1, Math.round(m / 1609 / (m > 16000 ? 5 : 1)) * (m > 16000 ? 5 : 1));
  const words: Record<number, string> = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten', 15: 'fifteen', 20: 'twenty', 25: 'twenty-five', 30: 'thirty', 35: 'thirty-five', 40: 'forty' };
  return words[mi] ?? String(mi);
}

/** Clock position of a bearing relative to a heading ("two o'clock"). */
export function clockOf(relDeg: number): string {
  const h = ((Math.round(relDeg / 30) % 12) + 12) % 12;
  const n = ['twelve', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven'][h];
  return `${n} o'clock`;
}

export const RT = {
  scramble: (sq: string, ctl: string, angels: string, where: string) =>
    `${sq} Squadron, ${ctl}. Scramble! Scramble! Patrol ${where}, angels ${angels}.`,
  vector: (sq: string, ctl: string, hdg: string, angels: string, buster: boolean, strength: string, where: string) =>
    `${sq} Leader, ${ctl}. Vector ${hdg}, angels ${angels}${buster ? ', buster' : ''}. ${cap(strength)} bandits ${where}.`,
  update: (sq: string, ctl: string, hdg: string, strength: string, where: string, angels: string) =>
    `${sq} Leader, ${ctl}. Steer ${hdg}. ${cap(strength)} bandits now ${where}, angels ${angels}.`,
  close: (sq: string, ctl: string, miles: string, clock: string, rel: string) =>
    `${sq} Leader, ${ctl}. Bandits ${miles} ${miles === 'one' ? 'mile' : 'miles'}, ${clock}, ${rel}. Keep a good look-out.`,
  orbit: (sq: string, ctl: string, where: string, angels: string) =>
    `${sq} Leader, ${ctl}. Orbit ${where}, angels ${angels}.`,
  pancake: (sq: string, ctl: string) => `${sq} Leader, ${ctl}. Pancake, pancake. Good show.`,
  pancakeFuel: (sq: string, ctl: string) => `${sq} Leader, ${ctl}. Pancake when you're ready.`,
  comeHome: (sq: string, ctl: string) => `${sq} Leader, ${ctl}. You are leaving the sector. Come home.`,
  overFrance: (sq: string, ctl: string) => `${sq} Leader, ${ctl}. You're over France. Come home, old boy.`,
  homingReq: (sq: string, ctl: string) => `Hello ${ctl}, ${sq} Leader. Request homing. Over.`,
  homing: (sq: string, ctl: string, hdg: string, field: string, miles: string, land: string) =>
    `${sq} Leader, ${ctl}. Steer ${hdg} for ${field}, ${miles} ${miles === 'one' ? 'mile' : 'miles'}. Landing ${land}. Over.`,
  tallyAck: (ctl: string) => `Good luck. ${ctl} listening out.`,
  tallyHo: (sq: string, n: string, type: string, clock: string, rel: string) =>
    `Tally-ho! ${cap(n)} ${type} at ${clock}, ${rel}. ${sq} Squadron, going in!`,
  are: (sq: string, ctl: string) => `Hello ${sq} Leader, ${ctl}. Are you receiving me?`,
  hostileNear: (clock: string, rel: string) => `Bandits! ${clock}, ${rel}!`,
  breakCall: (name: string, dir: string) => `${name}, break ${dir}! Break ${dir}!`,
  hit: (name: string) => `${name} here, I've been hit. Going down.`,
  bailing: (name: string) => `${name}, I'm getting out!`,
  kill: (name: string, type: string) => `${name}: got a ${type}! He's going down!`,
  orders: {
    order1: (sq: string) => `${sq} Squadron, attack the bombers. Going in now.`,
    order2: (sq: string) => `${sq} Squadron, take on the escort.`,
    order3: (sq: string) => `${sq} Squadron, line astern. Follow me.`,
    order4: (sq: string) => `${sq} Squadron, re-form on me.`,
  } as Record<string, (sq: string) => string>,
  wingmanAck: ['Roger, leader.', 'Understood.', 'Wilco.', 'Right with you.'],
};

/** Garble a message as the R/T fades with distance (over France). */
export function garble(text: string, amount: number, rng: Rng): string {
  if (amount <= 0) return text;
  return text.split(' ').map((w) => (rng.next() < amount ? '...' : w)).join(' ').replace(/(\.\.\. )+/g, '... ');
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Invented callsigns: squadrons and sector controllers. */
export const CALLSIGNS = {
  squadrons: ['Gannet', 'Tiger', 'Lemon', 'Rumba', 'Dysoe', 'Mandrel'],
  controllers: { 'Biggin Hill': 'Sapper', Kenley: 'Bovril', Hornchurch: 'Lumba', 'North Weald': 'Calfskin', Northolt: 'Garter', Tangmere: 'Shandy', Debden: 'Cowslip' } as Record<string, string>,
};
