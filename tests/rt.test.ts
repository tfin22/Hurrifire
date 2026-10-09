// The R/T menu: the calls you can make, the controller's answers, the calls
// your squadron makes for you, and what ends up in the action report.

import { describe, expect, it } from 'vitest';
import { Vec3 } from '../src/core/math';
import { Rng } from '../src/core/rng';
import { worldMap } from '../src/content/world/map';
import { WorldObjects } from '../src/content/world/objects';
import type { ControlFrame, SimCmd } from '../src/input/input';
import { RaidSpec } from '../src/sim/raid';
import { Sortie, SortieSpec } from '../src/sim/sortie';
import { generateWeather } from '../src/sim/weather';

const map = worldMap();
const objects = new WorldObjects(map);
const home = map.airfieldByName('Biggin Hill')!;

/** A raid on Biggin Hill from the south-east, `along` of the way in from the coast. */
function raid(name: string, dx = 0, kind: RaidSpec['kind'] = 'airfield', count = 15): RaidSpec {
  const target = home.pos.clone();
  const start = new Vec3(target.x + 60000 + dx, 0, target.z - 50000);
  return {
    name, kind, targetName: `target ${name}`, target, start, entry: start.clone().lerp(target, 0.45), alt: 4500, speed: 85, delay: 0,
    groups: kind === 'sweep'
      ? [{ type: 'bf109', count: 6, role: 'sweep', altOffset: 0, skill: 'experte' }]
      : [{ type: 'he111', count, role: 'bomber', altOffset: 0, skill: 'average' }],
  };
}

function sortie(raids: RaidSpec[], at = home.pos.clone().add(new Vec3(0, 4000, 0)), o: Partial<SortieSpec> = {}): Sortie {
  const rng = new Rng(9);
  return new Sortie({
    seed: 9, month: 8, day: 18, hour: 13, weather: { ...generateWeather(rng, 8), cover: 0 }, phase: 'airfields',
    home: home.name, playerType: 'spitfire', playerName: 'P/O Test', squadron: 'Gannet', controller: 'Sapper',
    leading: true, others: [{ name: 'Sgt A', skill: 'average', fatigue: 0 }, { name: 'Sgt B', skill: 'average', fatigue: 0 }],
    raids, start: 'air', airStart: { pos: at, heading: 2.4 }, convergenceM: 274, underAttack: false, fatigue: 0, assist: true,
    otherSquadrons: false, ...o,
  }, map, objects);
}

const level: ControlFrame = { pitch: 0, roll: 0, yaw: 0, throttle: 0.7, fire: false, boost: false, brake: false, pump: false };
const fly = (s: Sortie, secs: number, cmds?: SimCmd[]) => { for (let i = 0; i < secs * 50; i++) s.step(i === 0 && cmds ? { ...level, cmds } : level); };
const said = (s: Sortie, re: RegExp) => s.controller.log.some((m) => re.test(m.text));
const labels = (s: Sortie) => s.rtOptions().map((o) => o.label);

describe('the R/T menu offers what fits the moment', () => {
  it('in the air and sound: vector, a fix, homing; two raids up: a new raid too; nothing about trouble', () => {
    const s = sortie([raid('a'), raid('b', 40000)]);
    fly(s, 2);
    const l = labels(s);
    expect(l).toEqual(expect.arrayContaining(['VECTOR', 'NEW RAID', 'FIX', 'HOMING']));
    expect(l.some((x) => x === 'MAYDAY' || x.startsWith('RTB'))).toBe(false);
    expect(l.length).toBeLessThanOrEqual(6);
  });

  it('in trouble: Mayday and the report come first', () => {
    const s = sortie([raid('a')]);
    fly(s, 1);
    s.player.damage.fire = 10;
    const l = labels(s);
    expect(l[0]).toBe('MAYDAY');
    expect(l[1]).toBe('RTB: DAMAGED');
  });

  it('out of ammunition: the report says so', () => {
    const s = sortie([raid('a')]);
    fly(s, 1);
    for (const g of s.player.armament.guns) g.rounds = 0;
    expect(labels(s)).toContain('RTB: NO AMMO');
  });

  it('a call that no longer fits does nothing', () => {
    const s = sortie([raid('a')]);
    fly(s, 1, ['rtMayday']);
    expect(s.mayday).toBeNull();
    expect(said(s, /Mayday/)).toBe(false);
  });
});

describe('the controller answers', () => {
  it('a vector when you ask, even in the middle of a fight', () => {
    const s = sortie([raid('a')]);
    fly(s, 30);
    s.engaged = true;
    const before = s.controller.log.length;
    fly(s, 6, ['rtVector']);
    const fresh = s.controller.log.slice(before).map((m) => m.text);
    expect(fresh[0]).toMatch(/Request vector/);
    expect(fresh.some((t) => /Sapper\. Vector /.test(t))).toBe(true);
  });

  it('a new raid: the box moves, the squadron re-forms and follows the new vector', () => {
    const s = sortie([raid('a'), raid('b', 40000)]);
    fly(s, 10);
    const first = s.controller.targetRaid;
    s.engaged = true;
    fly(s, 8, ['rtNewRaid']);
    expect(said(s, /Any more trade/)).toBe(true);
    expect(said(s, /another one coming in/)).toBe(true);
    expect(s.controller.targetRaid).not.toBe(first);
    expect(s.engaged).toBe(false);
  });

  it('nothing else on the board, it says so', () => {
    const s = sortie([raid('a')]);
    fly(s, 2);
    expect(labels(s)).not.toContain('NEW RAID');
  });

  it('a fix: where you are, how high, and the way to the nearest field', () => {
    const s = sortie([raid('a')]);
    fly(s, 5, ['rtFix']);
    expect(said(s, /Request a fix/)).toBe(true);
    expect(said(s, /You are .*angels .*bears/)).toBe(true);
  });

  it('help against a big raid: another squadron is sent, and you are told who and how long', () => {
    const s = sortie([raid('a', 0, 'airfield', 24)], undefined, { otherSquadrons: true });
    fly(s, 20);
    s.engaged = true;
    expect(labels(s)).toContain('SEND HELP');
    const target = s.controller.targetRaid!;
    fly(s, 7, ['rtHelp']);
    expect(said(s, /Can you send help/)).toBe(true);
    expect(said(s, /Sending \w+ squadron to you/)).toBe(true);
    // Sent now: one already up is turned on to us, or a fresh one takes off within half a minute.
    expect(s.others.some((o) => o.raidId === target.id && o.spec.scrambleAt <= s.time + 30)).toBe(true);
    // Once per raid.
    expect(labels(s)).not.toContain('SEND HELP');
  });

  it('breaking off: the report, a pancake and a homing', () => {
    const s = sortie([raid('a')]);
    fly(s, 2);
    for (const g of s.player.armament.guns) g.rounds = 0;
    fly(s, 5, ['rtReport']);
    expect(s.reported?.kind).toBe('ammo');
    expect(said(s, /Out of ammunition\. Returning to base/)).toBe(true);
    expect(said(s, /Pancake\. Homing follows/)).toBe(true);
    expect(s.homing).not.toBeNull();
  });

  it('a Mayday over the sea brings air-sea rescue', () => {
    const sea = home.pos.clone().add(new Vec3(30000, 3000, -60000));
    expect(map.surfaceAt(sea.x, sea.z)).toBe('sea');
    const s = sortie([raid('a')], sea);
    fly(s, 1);
    s.player.fs.engine = 'dead';
    fly(s, 5, ['rtMayday']);
    expect(s.mayday?.sea).toBe(true);
    expect(said(s, /Mayday, Mayday, Mayday\. Gannet Leader\. Engine gone/)).toBe(true);
    expect(said(s, /Air-sea rescue is on its way/)).toBe(true);
  });
});

describe('calls made for you', () => {
  it('a squadron mate in the sea: the nearest wingman calls air-sea rescue', () => {
    const sea = home.pos.clone().add(new Vec3(30000, 3000, -60000));
    const s = sortie([raid('a')], sea);
    fly(s, 1);
    const mate = s.formation.find((q) => q !== s.player)!;
    mate.status = 'ditched';
    s.world.emit({ kind: 'ditched', planeId: mate.id, pos: mate.pos.clone() });
    fly(s, 4);
    expect(said(s, /is in the drink/)).toBe(true);
    expect(said(s, /Air-sea rescue informed/)).toBe(true);
  });

  it('a free hunt near you: the controller warns you to look out above', () => {
    const s = sortie([raid('a'), raid('hunt', -30000, 'sweep')]);
    const hunt = s.world.raids[1];
    s.player.fs.setAirborne(hunt.plot.clone().add(new Vec3(5000, -1000, 0)), 0, 110);
    fly(s, 2);
    expect(said(s, /Bandits in your area.*Look out above/)).toBe(true);
  });
});

describe('the action report', () => {
  it('breaking off out of ammunition after some kills: the raid line credits you, and says why you left', () => {
    const s = sortie([raid('a')]);
    fly(s, 30);
    const r = s.world.raids[0];
    r.spawn(s.world, new Rng(1));
    const down = r.bombers.slice(0, 3);
    for (const b of down) { b.damage.by[s.player.id] = 100; s.world.goDown(b); }
    for (const g of s.player.armament.guns) g.rounds = 0;
    fly(s, 4, ['rtReport']);
    const res = (s as unknown as { compile(): { raidNotes: string[]; rtNotes?: string[] } }).compile();
    expect(res.raidNotes.join(' ')).toMatch(/You broke off out of ammunition, having shot down 3 of it/);
    expect(res.raidNotes.join(' ')).not.toMatch(/still on its way when you left it/);
    expect(res.rtNotes?.join(' ')).toMatch(/Reported out of ammunition/);
  });
});

describe('replays', () => {
  it('R/T calls are recorded with the controls, so a replay says and does the same', () => {
    const run = () => {
      const s = sortie([raid('a'), raid('b', 40000)]);
      fly(s, 3, ['rtFix']);
      fly(s, 6, ['rtNewRaid']);
      fly(s, 4, ['rtVector']);
      return { log: s.controller.log.map((m) => m.text).join('|'), target: s.controller.targetRaid?.id };
    };
    expect(run()).toEqual(run());
  });

});
