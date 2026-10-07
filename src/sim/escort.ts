// Flying for the other side: a Bf 109 close-escort sortie from the Pas de
// Calais to London and back, with the fuel gauge as the enemy. The player
// leads a Schwarm of four with the bombers; RAF squadrons are sent up
// against the raid on the way in, over the target and on the way out.
//
// Shares the World, the raid, the AI and the debrief with the RAF sortie,
// and presents the same face to the sortie screen.

import { Vec3 } from '../core/math';
import { Rng } from '../core/rng';
import { AIRCRAFT } from '../content/aircraft';
import { TARGETS } from '../content/raids';
import { LW_LOG, LW_PLACES, LW_RT } from '../content/text/escort';
import { clockOf } from '../content/text/rt';
import { WRITE_UP } from '../content/text/briefing';
import { describePlace, isFrance, placeName } from '../content/world/describe';
import { lonLatToXZ, WorldMap } from '../content/world/map';
import type { WorldObjects } from '../content/world/objects';
import type { ControlFrame, SimCmd } from '../input/input';
import type { Ship } from '../render/worldLayer';
import { TUNING } from '../tuning';
import { FighterBrain } from './ai/fighter';
import { skillFor } from './ai/types';
import { WingmanBrain } from './ai/wingman';
import { assessClaims, Engagement, tally } from './claims';
import { CloudField } from './clouds';
import type { RTMessage } from './controller';
import { damageFraction } from './damage';
import { DockingComputer } from './docking';
import type { Plane } from './plane';
import { Raid, RaidSpec } from './raid';
import type { Homing, PilotOutcome, SortieResult } from './sortie';
import { formationSlots, homingTo } from './sortie';
import { dayOfYear, sunDirection } from './sun';
import { DayWeather, windVector } from './weather';
import { World } from './world';

export interface EscortSpec {
  seed: number;
  month: number;
  day: number;
  hour: number;
  weather: DayWeather;
  /** Pilot name and the Schwarm's colour (Gelb, Rot, Weiss, Schwarz). */
  playerName: string;
  colour: string;
  convergenceM: number;
  assist: boolean;
}

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October'];

/** Distance (m) to the nearest point of the French coast we know. */
function distanceToFrenchCoast(x: number, z: number): number {
  const pts: [number, number][] = [[50.871, 1.583], [50.951, 1.858], [50.726, 1.614], [51.034, 2.377], [50.986, 2.128], [50.886, 1.663]];
  let best = Infinity;
  for (const [lat, lon] of pts) {
    const [px, pz] = lonLatToXZ(lat, lon);
    best = Math.min(best, Math.hypot(x - px, z - pz));
  }
  return best;
}

class RtLog {
  readonly log: RTMessage[] = [];
  say(t: number, text: string, from: RTMessage['from'], urgent = false): void {
    this.log.push({ t, from, text, urgent });
  }
}

export class EscortSortie {
  readonly world: World;
  readonly controller = new RtLog();
  readonly ships: Ship[] = [];
  readonly prompts: string[] = [];
  readonly player: Plane;
  readonly schwarm: Plane[] = [];
  readonly raid: Raid;
  readonly spec: EscortSpec & { start: 'air'; home: string; leading: true; playerType: 'bf109' };
  result: SortieResult | null = null;
  readonly orderButtons = [
    { action: 'order1' as const, label: 'ATTACK' }, { action: 'order3' as const, label: 'FOLLOW' }, { action: 'order4' as const, label: 'RE-FORM' },
  ];
  phase: 'combat' | 'rtb' | 'parachute' | 'over' = 'combat';
  engaged = false;
  private rng: Rng;
  private names = new Map<number, string>();
  private rafSent = 0;
  private rafLeaders: Plane[] = [];
  private spotted = new Set<number>();
  private crossed = false;
  private safeT = 0;
  private safeHome = false;
  private redLight = false;
  private bombsCalled = false;
  private lastBomberCall = -999;
  private endT = -1;
  /** The field the Gefechtsstand last gave a bearing to (shown on screen). */
  homing: Homing | null = null;
  private homingDue = -1;
  /** Jump to final approach after a homing, and land her (Assist/Arcade). */
  readonly docking = new DockingComputer();
  private seen = new Map<number, Engagement['lastSeen']>();
  private readonly targetName: string;

  constructor(spec: EscortSpec, readonly map: WorldMap, readonly objects: WorldObjects) {
    this.spec = { ...spec, start: 'air', home: LW_PLACES.base, leading: true, playerType: 'bf109' };
    this.rng = new Rng(spec.seed ^ 0x109e);
    const w = (this.world = new World(spec.seed, map));
    const wx = spec.weather;
    w.weather.wind.copy(windVector(wx));
    w.weather.haze = wx.haze;
    w.weather.cloudBase = wx.cloudBase;
    w.weather.cloudTop = wx.cloudTop;
    w.weather.cloudCover = wx.cover;
    w.cloudField = new CloudField(spec.seed & 0xffff, wx.cloudBase, wx.cloudTop, wx.cover);
    w.sun.copy(sunDirection(dayOfYear(spec.month, spec.day), spec.hour - 1));
    // A new day: the balloons are all up (and a replay starts from the same place).
    for (const b of objects.balloons) b.down = false;
    w.balloons = objects.balloons;
    const marquise = map.airfieldByName(LW_PLACES.base)!;
    w.homes.lw = marquise.pos.clone().add(new Vec3(0, 800, 0));
    const biggin = map.airfieldByName('Biggin Hill')!;
    w.homes.raf = biggin.pos.clone().add(new Vec3(0, 600, 0));
    w.raidSpawnRange = 0;

    // The raid: Dorniers or Heinkels from Gris Nez to the London docks, with other Staffeln as escort.
    const tgt = this.rng.pick(TARGETS.london);
    this.targetName = tgt.name;
    const [tx, tz] = lonLatToXZ(tgt.lat, tgt.lon);
    const [sx, sz] = lonLatToXZ(50.9, 1.62);
    const target = new Vec3(tx, 0, tz), start = new Vec3(sx, 0, sz);
    const bomber = this.rng.chance(0.5) ? 'do17' : 'he111';
    const rs: RaidSpec = {
      name: 'raid1', kind: 'london', targetName: tgt.name, target, start, entry: start.clone().lerp(target, 0.3),
      alt: 4300 + this.rng.range(0, 800), speed: bomber === 'do17' ? 92 : 88, delay: 0,
      groups: [
        { type: bomber, count: 12 + this.rng.int(7), role: 'bomber', altOffset: 0, skill: 'average' },
        { type: 'bf109', count: 6, role: 'topCover', altOffset: 2000, skill: 'average' },
      ],
    };
    this.raid = w.addRaid(new Raid(1, rs, this.rng.fork('raid')));
    this.raid.step(0, 0);
    this.raid.spawn(w, this.rng.fork('spawn'));

    // The Schwarm: above and behind the bombers.
    const lead = this.raid.leader()!;
    const hdg = lead.fs.heading;
    const fwd = new Vec3(Math.sin(hdg), 0, Math.cos(hdg)), right = new Vec3(Math.cos(hdg), 0, -Math.sin(hdg));
    const base = lead.pos.clone().addScaled(fwd, -350).add(new Vec3(0, 450, 0)).addScaled(right, 250);
    const slots = formationSlots(4, 'pairs');
    const baseInfo = { x: marquise.pos.x, z: marquise.pos.z, h: marquise.pos.y, dir: (marquise.dir * Math.PI) / 180, half: marquise.half };
    for (let i = 0; i < 4; i++) {
      const name = i === 0 ? spec.playerName : `${spec.colour} ${i + 1}`;
      const p = w.addPlane('bf109', 'lw', i === 0 ? `${spec.colour} 1` : name, TUNING.escort.startFuel, spec.convergenceM);
      const s = slots[i];
      p.fs.setAirborne(base.clone().addScaled(right, s.x).addScaled(fwd, s.z).add(new Vec3(0, s.y, 0)), hdg, 105);
      p.fs.gear = p.fs.gearCmd = 0;
      this.names.set(p.id, name);
      if (i === 0) {
        p.isPlayer = true;
        w.player = p;
        this.player = p;
      } else {
        p.skill = skillFor(i === 1 ? 'experte' : 'average');
        const b = new WingmanBrain(() => (this.player.alive ? this.player : null), s, baseInfo, i);
        b.vic = false;
        b.phase = 'air';
        b.fighter.opts.leader = this.schwarm[0];
        b.fighter.state = 'formation';
        b.give('reform');
        p.brain = b;
      }
      this.schwarm.push(p);
    }
    this.player = this.schwarm[0];
    this.controller.say(0, LW_RT.rendezvous(tgt.name), 'controller');
  }

  get time(): number {
    return this.world.time;
  }

  // ------------------------------------------------------------ commands

  private command(c: SimCmd): void {
    switch (c) {
      case 'tallyHo': case 'order1': this.attack(); break;
      case 'order2': this.attack(); break;
      case 'order3': this.giveAll('follow'); this.controller.say(this.time, LW_RT.follow(this.spec.colour + ' 1'), 'player'); break;
      case 'jumpHome': {
        const why = DockingComputer.refuse(this.world, this.player, this.homing);
        if (why) { this.prompts.push(why); break; }
        this.docking.engage(this.player, this.homing!);
        this.controller.say(this.time, `${this.spec.colour} 1: Going home.`, 'player');
        this.prompts.push('ON FINALS - STICK TO TAKE OVER');
        break;
      }
      case 'homing':
        if (this.homingDue >= 0 || this.player.fs.onGround) break;
        this.controller.say(this.time, LW_RT.homingReq(this.spec.colour + ' 1'), 'player');
        this.homingDue = this.time + TUNING.sortie.homingDelay;
        break;
      case 'order4': this.giveAll('reform'); this.controller.say(this.time, LW_RT.reform(this.spec.colour + ' 1'), 'player'); break;
    }
  }

  private attack(): void {
    this.engaged = true;
    this.giveAll('bombers');
    this.controller.say(this.time, LW_RT.pauke(this.spec.colour + ' 1'), 'player', true);
  }

  private giveAll(o: 'bombers' | 'follow' | 'reform'): void {
    for (const p of this.schwarm) if (p.brain instanceof WingmanBrain) p.brain.give(o);
  }

  // ------------------------------------------------------------ step

  step(f: ControlFrame | null): void {
    if (f?.cmds) for (const c of f.cmds) this.command(c);
    const w = this.world;
    const dt = TUNING.sim.dt;
    w.step(this.docking.control(this.player, f));
    this.sendRaf();
    if (w.tick % 250 === 0) this.vectorRaf();
    this.radio();
    if (this.homingDue >= 0 && this.time >= this.homingDue) {
      this.homingDue = -1;
      const me = this.player.pos;
      const h = (this.homing = homingTo(this.map, me, false, w.weather.wind, LW_PLACES.fields));
      const brg = (Math.atan2(h.field.pos.x - me.x, h.field.pos.z - me.z) * 180) / Math.PI;
      const km = Math.max(1, Math.round(Math.hypot(h.field.pos.x - me.x, h.field.pos.z - me.z) / 1000));
      this.controller.say(this.time, LW_RT.homing(Math.round((brg + 360) % 360), h.field.name, km), 'controller', true);
    }
    this.trackSightings();
    this.checkEnd(dt);
  }

  /** Fighter Command sends squadrons up as the raid comes in. */
  private sendRaf(): void {
    const plan = TUNING.escort.raf;
    while (this.rafSent < plan.length && this.time >= plan[this.rafSent].at) {
      const sq = plan[this.rafSent++];
      const r = this.raid;
      const dir = r.vel.lenSq() > 1 ? r.vel.clone().normalize() : new Vec3(0, 0, 1);
      const side = new Vec3(dir.z, 0, -dir.x).scale(this.rng.signed() * 3000);
      const at = r.plot.clone().addScaled(dir, sq.ahead).add(side);
      at.y = Math.max(1500, r.alt + sq.alt);
      const hdg = Math.atan2(r.plot.x - at.x, r.plot.z - at.z);
      const slots = formationSlots(sq.n, 'vic');
      const fwd = new Vec3(Math.sin(hdg), 0, Math.cos(hdg)), right = new Vec3(Math.cos(hdg), 0, -Math.sin(hdg));
      let leader: Plane | null = null;
      for (let i = 0; i < sq.n; i++) {
        const p = this.world.addPlane(sq.type, 'raf', `${sq.type}-${this.rafSent}-${i}`, 0.7);
        p.skill = skillFor(i === 0 ? 'experte' : sq.skill);
        const s = slots[i];
        p.fs.setAirborne(at.clone().addScaled(right, s.x).addScaled(fwd, s.z).add(new Vec3(0, s.y, 0)), hdg, 110);
        p.fs.gear = p.fs.gearCmd = 0;
        // Hurricanes for the bombers, Spitfires for the escort, as Park wanted.
        const prefer = sq.type === 'hurricane';
        if (!leader) {
          leader = p;
          p.brain = new FighterBrain({ waypoint: r.plot.clone(), preferBombers: prefer });
          this.rafLeaders.push(p);
        } else {
          p.brain = new FighterBrain({ leader, slot: s, preferBombers: prefer });
        }
      }
    }
  }

  /** The RAF leaders are steered onto the raid by their controllers. */
  private vectorRaf(): void {
    for (const L of this.rafLeaders) {
      const b = L.brain;
      if (!(b instanceof FighterBrain) || !L.alive) continue;
      b.opts.waypoint = this.raid.plot.clone().add(new Vec3(0, 300, 0));
    }
  }

  private radio(): void {
    const w = this.world;
    const me = this.player;
    const t = this.time;
    // Calls on this tick's events.
    for (const e of w.events) {
      if (e.t !== w.time) continue;
      if (e.kind === 'shotDown' && e.otherId === me.id) this.controller.say(t, LW_RT.horrido(this.spec.colour + ' 1'), 'player');
      if (e.kind === 'shotDown' && this.schwarm.some((p) => p.id === e.planeId && p !== me)) this.controller.say(t, LW_RT.hit(this.names.get(e.planeId)!), 'squadron', true);
      if (e.kind === 'bail' && this.schwarm.some((p) => p.id === e.planeId && p !== me)) this.controller.say(t, LW_RT.baled(this.names.get(e.planeId)!), 'squadron');
    }
    // Indianer: an RAF formation sighted.
    for (const L of this.rafLeaders) {
      if (this.spotted.has(L.id) || !L.alive) continue;
      const d = L.pos.distTo(me.pos);
      if (d > 7000) continue;
      this.spotted.add(L.id);
      const rel = L.pos.clone().sub(me.pos);
      const clock = clockOf(((Math.atan2(rel.x, rel.z) - me.fs.heading) * 180) / Math.PI);
      const above = rel.y > 300 ? 'above' : rel.y < -300 ? 'below' : 'level';
      this.controller.say(t, LW_RT.indianer(`${L.type.short}s`, clock, above), 'squadron', true);
    }
    if (t - this.raid.lastAttacked < 1 && t - this.lastBomberCall > 150) { this.lastBomberCall = t; this.controller.say(t, LW_RT.bombersCall, 'controller', true); }
    if (!this.bombsCalled && this.raid.bombsDropped > 0) { this.bombsCalled = true; this.controller.say(t, LW_RT.bombsGone, 'controller'); }
    if (!this.redLight && me.fs.fuel < me.type.fuelCapacity * TUNING.escort.redLight) {
      this.redLight = true;
      this.prompts.push('RED LIGHT: FUEL LOW');
      this.controller.say(t, LW_RT.redLight, 'squadron', true);
      this.phase = 'rtb';
    }
    if (me.fs.fuel <= 0 && me.status === 'flying' && !this.prompts.includes('OUT OF FUEL')) { this.prompts.push('OUT OF FUEL'); this.controller.say(t, LW_RT.noFuel, 'player'); }
  }

  private trackSightings(): void {
    const me = this.player;
    for (const q of this.world.planes) {
      if (q.side === 'lw' || !q.damage.by[me.id]) continue;
      if (q.pos.distTo(me.pos) > 4000 || !this.world.losClear(me.pos, q.pos)) continue;
      const s: Engagement['lastSeen'] = q.status !== 'flying' ? 'goingDown' : q.damage.fire > 0 || q.damage.glycol > 0.2 || q.damage.oil > 0.2 ? 'smoking' : 'hit';
      if (this.seen.get(q.id) !== 'goingDown') this.seen.set(q.id, s);
    }
  }

  private checkEnd(dt: number): void {
    const p = this.player;
    const chute = this.world.parachutes.find((c) => c.fromPlane === p.id && c.name === 'pilot');
    if (chute && this.phase !== 'over') this.phase = 'parachute';
    // Out over the Channel counts: a raid broken up before the English coast still means a trip home.
    if (!isFrance(p.pos.x, p.pos.z)) this.crossed = true;
    if (this.endT < 0) {
      // Back over France with nobody about: home.
      if (this.crossed && p.status === 'flying' && !p.fs.onGround && isFrance(p.pos.x, p.pos.z) && !chute) {
        const near = this.world.planes.some((q) => q.side === 'raf' && q.status === 'flying' && q.pos.distTo(p.pos) < TUNING.escort.clearRange);
        this.safeT = near ? 0 : this.safeT + dt;
        if (this.safeT > TUNING.escort.safeAfter) { this.safeHome = true; this.endT = this.time; this.controller.say(this.time, LW_RT.overFrance, 'player'); }
      }
      const ended = p.status === 'landed' || p.status === 'crashed' || p.status === 'destroyed' || p.status === 'ditched' || (chute && chute.landed);
      if (ended) this.endT = this.time + (p.status === 'landed' ? 3 : 5);
    } else if (this.time >= this.endT && !this.result) {
      this.phase = 'over';
      this.result = this.compile();
    }
  }

  /** Put the shared map back as it was (for a replay). */
  rewind(): void {
    for (const b of this.objects.balloons) b.down = false;
  }

  // ------------------------------------------------------------ reckoning

  private rescued(pos: Vec3): boolean {
    const d = distanceToFrenchCoast(pos.x, pos.z);
    const p = d < 8000 ? 0.8 : d < 20000 ? 0.5 : d < 35000 ? 0.25 : 0.1;
    return new Rng(Math.floor(pos.x) ^ Math.floor(pos.z) ^ this.spec.seed).chance(p);
  }

  private outcome(): PilotOutcome {
    const p = this.player;
    const w = this.world;
    const chute = w.parachutes.find((c) => c.fromPlane === p.id && c.name === 'pilot');
    const field = LW_PLACES.fields.map((n) => this.map.airfieldByName(n)!).sort((a, b) => a.pos.distTo(p.pos) - b.pos.distTo(p.pos))[0];
    const where = (pos: Vec3) => describePlace(this.map, pos.x, pos.z);
    if (chute) {
      const pl = placeName(this.map, chute.pos.x, chute.pos.z);
      if (chute.overSea) return this.rescued(chute.pos)
        ? { kind: 'bailSea', pilot: 'shaken', aircraft: 'writeOff', place: pl, line: LW_LOG.bailSeaRescued(pl) }
        : { kind: 'lostSea', pilot: 'lost', aircraft: 'writeOff', place: pl, line: LW_LOG.bailSeaLost(pl) };
      if (!isFrance(chute.pos.x, chute.pos.z)) return { kind: 'pow', pilot: 'lost', aircraft: 'writeOff', place: pl, line: LW_LOG.pow(where(chute.pos)) };
      return { kind: 'bailLand', pilot: 'shaken', aircraft: 'writeOff', place: pl, line: `Baled out ${where(chute.pos)}.` };
    }
    const pl = placeName(this.map, p.pos.x, p.pos.z);
    if (p.status === 'crashed' || p.status === 'destroyed' || p.landing.result?.pilot === 'lost') return { kind: 'killed', pilot: 'lost', aircraft: 'writeOff', place: pl, line: LW_LOG.killed(where(p.pos)) };
    if (p.status === 'ditched') return this.rescued(p.pos)
      ? { kind: 'ditched', pilot: 'shaken', aircraft: 'writeOff', place: pl, line: LW_LOG.ditchedRescued(pl) }
      : { kind: 'lostSea', pilot: 'lost', aircraft: 'writeOff', place: pl, line: LW_LOG.ditchedLost(pl) };
    const dmg = damageFraction(p.damage);
    const aircraft: PilotOutcome['aircraft'] = dmg > 0.3 ? 'repairable' : dmg > 0.08 ? 'damaged' : dmg > 0 ? 'minor' : 'fine';
    if (this.safeHome) return { kind: 'landed', pilot: p.damage.pilot === 'wounded' ? 'wounded' : 'fine', aircraft, place: field.name, line: this.redLight ? LW_LOG.homeRed(field.name) : LW_LOG.home(field.name) };
    const r = p.landing.result;
    if (!isFrance(p.pos.x, p.pos.z)) return { kind: 'pow', pilot: 'lost', aircraft: 'writeOff', place: pl, line: LW_LOG.pow(where(p.pos)) };
    const onField = !!this.map.airfieldAt(p.pos.x, p.pos.z);
    if (onField) return { kind: 'landed', pilot: r?.pilot ?? 'fine', aircraft: r?.aircraft ?? aircraft, place: pl, line: this.redLight ? LW_LOG.homeRed(pl) : LW_LOG.home(pl) };
    const out: PilotOutcome = { kind: r?.kind === 'belly' ? 'belly' : 'forced', pilot: r?.pilot ?? 'fine', aircraft: r?.aircraft ?? 'damaged', place: pl, line: LW_LOG.forcedFrance(where(p.pos)) };
    const sound = (!r || r.aircraft === 'fine') && dmg < 0.05 && p.damage.pilot !== 'wounded' && p.fs.engine !== 'dead' && p.fs.engine !== 'seized' && p.fs.fuel > p.type.fuelCapacity * TUNING.sortie.writeUpFuel;
    if (sound) out.writtenUp = WRITE_UP.lw;
    return out;
  }

  private compile(): SortieResult {
    const w = this.world;
    const p = this.player;
    const rng = this.rng.fork('debrief');
    const engagements: Engagement[] = [];
    for (const q of w.planes) {
      if (q.side === 'lw') continue;
      const dmg = q.damage.by[p.id] ?? 0;
      if (!dmg) continue;
      const maxHp = Object.values(q.damage.maxHp).reduce((a, b) => a + (b ?? 0), 0);
      let downAt: Engagement['downAt'] = null;
      if (q.status === 'destroyed') downAt = 'air';
      else if (q.status === 'crashed' || q.status === 'wreck' || q.status === 'ditched') {
        // Our side can only inspect wrecks in France; over England it needs a witness.
        downAt = isFrance(q.pos.x, q.pos.z) ? 'england' : 'sea';
      }
      engagements.push({
        enemyId: q.id, type: q.type.short, damageDone: Math.min(1, (dmg * 1.4) / Math.max(1, maxHp)),
        wentDown: q.status !== 'flying', downAt, seenCrash: q.seenCrash,
        crewBaledOut: w.parachutes.some((c) => c.fromPlane === q.id),
        lastSeen: this.seen.get(q.id) ?? 'hit', credited: q.killedBy === p.id,
      });
    }
    const claims = assessClaims(engagements, rng);
    const r = this.raid;
    const lost = r.bombers.filter((b) => b.status !== 'flying' && b.status !== 'landed').length;
    const raidNotes = [
      r.bombsDropped > 0 ? `The bombers reached ${this.targetName}.` : `The bombers did not reach ${this.targetName}.`,
      `They lost ${lost} of ${r.bombers.length}.`,
    ];
    const outcome = this.outcome();
    const losses: SortieResult['losses'] = [];
    const fates: SortieResult['fates'] = [];
    for (const q of this.schwarm) {
      if (q === p) continue;
      const name = this.names.get(q.id)!;
      const chute = w.parachutes.find((c) => c.fromPlane === q.id);
      let fate: SortieResult['fates'][number]['fate'] = 'ok';
      if (q.status === 'crashed' || q.status === 'destroyed' || q.status === 'ditched') {
        if (chute && isFrance(chute.pos.x, chute.pos.z)) { fate = 'safe'; losses.push({ name, line: `${name} baled out over France and is safe.`, lost: false }); }
        else if (chute && !chute.overSea) { fate = 'pow'; losses.push({ name, line: `${name} came down in England. Taken prisoner.`, lost: true }); }
        else if (chute && this.rescued(chute.pos)) { fate = 'safe'; losses.push({ name, line: `${name} came down in the Channel and was picked up.`, lost: false }); }
        else { fate = 'lost'; losses.push({ name, line: `${name} did not come back.`, lost: true }); }
      } else if (damageFraction(q.damage) > 0.08) fate = 'damaged';
      fates.push({ id: -1, name, fate, kills: w.planes.filter((e) => e.side === 'raf' && e.killedBy === q.id && e.status !== 'flying').length });
    }
    const t = tally(claims);
    const types = `${r.bombers[0]?.type.short ?? 'bomber'}s`;
    let line = this.engaged || claims.length ? LW_LOG.escorted(types, this.targetName) : LW_LOG.noContact(this.targetName);
    const cl = LW_LOG.claims(t.destroyed);
    if (cl) line += ' ' + cl;
    line += ' ' + outcome.line;
    const d = p.damage;
    const notes: string[] = [];
    if (d.glycol > 0) notes.push('glycol leak');
    if (d.oil > 0) notes.push('oil leak');
    if (d.fire > 0) notes.push('fire');
    if (d.pilot === 'wounded') notes.push('pilot wounded');
    if (d.hits > 0 && !notes.length) notes.push(`${d.hits} holes`);
    return {
      date: `${this.spec.day} ${MONTHS[this.spec.month]} 1940`, aircraft: AIRCRAFT.bf109.name, durationMin: Math.round(this.time / 60), takeoffDelay: -1,
      claims, roundsFired: p.armament.fired, damageTaken: damageFraction(d), damageNotes: notes, outcome, raidNotes,
      raidsTurned: r.turnedBack ? 1 : 0, raidsBombed: r.bombsDropped > 0 ? 1 : 0, bombsOnTargetKg: r.bombsOnTarget, losses,
      enemyDown: w.planes.filter((q) => q.side === 'raf' && q.status !== 'flying').length,
      logLine: line, rtLog: this.controller.log.map((m) => m.text), engaged: this.engaged, fates,
      squadronKills: fates.reduce((a, f) => a + f.kills, 0), airfieldHits: {},
    };
  }
}
