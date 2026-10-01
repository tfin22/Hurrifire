// A sortie: the phone rings at dispersal and the clock starts; start-up,
// take-off, the climb under the controller's vectors, the fight, getting
// home, and the reckoning. Owns the World and everything stepped with it,
// deterministically, so the whole thing can be replayed from the seed and
// the recorded controls.

import { M_TO_FT, Vec3 } from '../core/math';
import { Rng } from '../core/rng';
import { AircraftId, AIRCRAFT } from '../content/aircraft';
import { ASSEMBLY, RAID_TEMPLATES, TARGETS } from '../content/raids';
import { CAUSE, LANDING_LINES, logClaims, logEngaged, logNoContact, LOSS_LINES, Phase } from '../content/text/briefing';
import { RT, clockOf } from '../content/text/rt';
import { describePlace, describeRaid, distanceToEnglishCoast, isFrance, placeName } from '../content/world/describe';
import { Airfield, lonLatToXZ, WorldMap } from '../content/world/map';
import { WorldObjects } from '../content/world/objects';
import type { Ship } from '../render/worldLayer';
import { ControlFrame, SimCmd } from '../input/input';
import { TUNING } from '../tuning';
import { skillFor, SkillLevel } from './ai/types';
import { Base, SquadronOrder, WingmanBrain } from './ai/wingman';
import { assessClaims, Claim, Engagement, tally } from './claims';
import { CloudField } from './clouds';
import { SectorController } from './controller';
import { damageFraction } from './damage';
import { Plane } from './plane';
import { Raid, RaidSpec } from './raid';
import { dayOfYear, sunDirection } from './sun';
import { DayWeather, windVector } from './weather';
import { World } from './world';

export interface SquadronPilot {
  /** Campaign roster id, reported back in the result. */
  id?: number;
  name: string;
  skill: SkillLevel;
  fatigue: number;
}

export interface SortieSpec {
  seed: number;
  month: number;
  day: number;
  hour: number;
  weather: DayWeather;
  phase: Phase;
  home: string;
  playerType: AircraftId;
  playerName: string;
  squadron: string;
  controller: string;
  /** Player leads the formation (Flight Lieutenant and up) or flies as a wingman. */
  leading: boolean;
  /** The rest of the formation (not including the player). */
  others: SquadronPilot[];
  raids: RaidSpec[];
  /** 'readiness' = start in the cockpit, engine off; 'air' = Quick Combat. */
  start: 'readiness' | 'air';
  convergenceM: number;
  underAttack: boolean;
  fatigue: number;
  assist: boolean;
  /** Pre-war tight vics, or the looser pairs the squadron learns to fly. */
  formation?: 'vic' | 'pairs';
  /** Spawn the player at this height and position for 'air' starts. */
  airStart?: { pos: Vec3; heading: number };
}

export type SortiePhase = 'startup' | 'takeoff' | 'climb' | 'combat' | 'rtb' | 'down' | 'parachute' | 'over';

export interface PilotOutcome {
  /** How the sortie ended for the player. */
  kind: 'landed' | 'forced' | 'belly' | 'crashLanded' | 'ditched' | 'bailLand' | 'bailSea' | 'lostSea' | 'killed' | 'pow';
  pilot: 'fine' | 'shaken' | 'wounded' | 'lost';
  aircraft: 'fine' | 'minor' | 'damaged' | 'repairable' | 'writeOff';
  place: string;
  line: string;
}

export interface SortieResult {
  date: string;
  aircraft: string;
  durationMin: number;
  takeoffDelay: number;
  claims: Claim[];
  roundsFired: number;
  damageTaken: number;
  damageNotes: string[];
  outcome: PilotOutcome;
  raidNotes: string[];
  raidsTurned: number;
  raidsBombed: number;
  bombsOnTargetKg: number;
  losses: { name: string; line: string; lost: boolean }[];
  enemyDown: number;
  logLine: string;
  rtLog: string[];
  engaged: boolean;
  /** What happened to each of the others, by roster id (campaign). */
  fates: { id: number; name: string; fate: 'ok' | 'damaged' | 'safe' | 'wounded' | 'lost' | 'pow'; kills: number }[];
  /** Enemy aircraft the rest of the formation shot down. */
  squadronKills: number;
  /** Bombs that burst on each airfield. */
  airfieldHits: Record<string, number>;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export class Sortie {
  readonly world: World;
  readonly controller: SectorController;
  readonly base: Airfield;
  readonly player: Plane;
  readonly formation: Plane[] = [];
  readonly ships: Ship[] = [];
  phase: SortiePhase;
  engaged = false;
  private rng: Rng;
  private primed = false;
  private mags = false;
  private cranking = -1;
  private startAllT = -1;
  private airborneAt = -1;
  private endT = -1;
  private seen = new Map<number, Engagement['lastSeen']>();
  private names = new Map<number, string>();
  private rosterIds = new Map<number, number>();
  private airfieldHits: Record<string, number> = {};
  /** Messages for the screen (start-up prompts etc.). */
  prompts: string[] = [];
  result: SortieResult | null = null;
  /** Shared map state as it was at the start, so a replay can begin from the same place. */
  private readonly startState: { craters: Airfield['craters'][]; damaged: number[]; balloonsDown: boolean[] };
  private readonly wrecked: { kind: string }[] = [];

  constructor(readonly spec: SortieSpec, readonly map: WorldMap, readonly objects: WorldObjects) {
    this.startState = {
      craters: map.airfields.map((a) => a.craters.map((c) => ({ ...c }))),
      damaged: map.airfields.map((a) => a.damaged),
      balloonsDown: objects.balloons.map((b) => b.down),
    };
    this.rng = new Rng(spec.seed ^ 0x5eed);
    const w = (this.world = new World(spec.seed, map));
    const wx = spec.weather;
    w.weather.wind.copy(windVector(wx));
    w.weather.haze = wx.haze;
    w.weather.cloudBase = wx.cloudBase;
    w.weather.cloudTop = wx.cloudTop;
    w.weather.cloudCover = wx.cover;
    w.cloudField = new CloudField(spec.seed & 0xffff, wx.cloudBase, wx.cloudTop, wx.cover);
    w.sun.copy(sunDirection(dayOfYear(spec.month, spec.day), spec.hour - 1));
    w.balloons = objects.balloons;
    map.season = seasonOf(spec.month, spec.day);
    this.base = map.airfieldByName(spec.home) ?? map.airfields[0];
    w.homes.raf = this.base.pos.clone().add(new Vec3(0, 600, 0));
    const [hx, hz] = lonLatToXZ(50.8, 1.95);
    w.homes.lw = new Vec3(hx, 3000, hz);
    w.onBombImpact = (b, raid) => this.bombImpact(b.pos, raid);

    // The player and the formation.
    const baseDir = (this.base.dir * Math.PI) / 180;
    const wind = w.weather.wind;
    // Take off into wind across the grass.
    const into = Math.atan2(-wind.x, -wind.z);
    const tdir = wind.lenSq() > 1 ? into : baseDir;
    const p = (this.player = w.addPlane(spec.playerType, 'raf', spec.playerName, 1, spec.convergenceM));
    p.isPlayer = true;
    p.fatigue = spec.fatigue;
    w.player = p;
    this.names.set(p.id, spec.playerName);
    const n = spec.others.length + 1;
    const leaderIndex = spec.leading ? 0 : 1;
    const slots = formationSlots(n, spec.formation ?? 'vic');
    const tx = Math.sin(tdir), tz = Math.cos(tdir), rx = Math.cos(tdir), rz = -Math.sin(tdir);
    const startBack = this.base.half - 120;
    const all: Plane[] = [];
    let k = 0;
    for (let i = 0; i < n; i++) {
      const isPlayer = i === leaderIndex;
      const plane = isPlayer ? p : w.addPlane(spec.playerType, 'raf', spec.others[k].name, 1, spec.convergenceM);
      if (!isPlayer) {
        const o = spec.others[k++];
        plane.skill = skillFor(o.skill);
        plane.fatigue = o.fatigue;
        this.names.set(plane.id, o.name);
        this.rosterIds.set(plane.id, o.id ?? -1);
      }
      all.push(plane);
    }
    // Re-order so index 0 is the formation leader.
    this.formation.push(...all);
    const leader = this.formation[0];
    const baseInfo: Base = { x: this.base.pos.x, z: this.base.pos.z, h: this.base.pos.y, dir: tdir, half: this.base.half };
    this.formation.forEach((plane, i) => {
      const s = slots[i];
      const gx = this.base.pos.x - tx * startBack + rx * s.x * 1.2 + tx * s.z * 0.6;
      const gz = this.base.pos.z - tz * startBack + rz * s.x * 1.2 + tz * s.z * 0.6;
      if (spec.start === 'readiness') {
        plane.fs.setOnGround(new Vec3(gx, map.heightAt(gx, gz) + plane.type.gearHeight, gz), tdir);
        plane.fs.engine = 'off';
        plane.fs.rpm = 0;
      } else {
        const a = spec.airStart!;
        const off = new Vec3(rx * s.x, s.y, rz * s.x).addScaled(new Vec3(Math.sin(a.heading), 0, Math.cos(a.heading)), s.z);
        plane.fs.setAirborne(a.pos.clone().add(off), a.heading, 120);
      }
      if (!plane.isPlayer) {
        const brain = new WingmanBrain(() => (this.formation[0].alive ? this.formation[0] : this.nextLeader()), new Vec3(s.x, s.y, s.z), baseInfo, i);
        brain.vic = (spec.formation ?? 'vic') === 'vic';
        if (spec.start === 'air') { brain.phase = 'air'; brain.fighter.opts.leader = leader; brain.fighter.state = 'formation'; }
        plane.brain = brain;
      }
    });
    if (leader !== p && leader.brain instanceof WingmanBrain) {
      // The AI squadron leader flies the controller's vectors.
      leader.brain.fighter.opts.leader = undefined;
    }

    // Raids.
    for (const rs of spec.raids) w.addRaid(new Raid(w.raids.length + 1, rs, this.rng.fork(rs.name)));
    // Convoys in the Channel phase.
    for (const r of spec.raids) {
      if (r.kind !== 'convoy') continue;
      for (let i = 0; i < 6; i++) {
        this.ships.push({ pos: new Vec3(r.target.x + (i % 3) * 400 - 400, 0, r.target.z + Math.floor(i / 3) * 500), heading: -Math.PI / 2 + 0.3, kind: i === 0 ? 'freighter' : 'coaster' });
      }
    }

    this.controller = new SectorController(spec.squadron, spec.controller, spec.seed);
    this.phase = spec.start === 'readiness' ? 'startup' : 'climb';
    if (spec.start === 'air') {
      this.airborneAt = 0;
      for (const plane of this.formation) { plane.fs.gear = plane.fs.gearCmd = 0; }
    }
    const angels = spec.raids.length ? Math.round((spec.raids[0].alt * M_TO_FT) / 1000) * 1000 : 15000;
    this.controller.scramble(this.view(), spec.underAttack ? 'base' : 'base', Math.max(10000, angels - 3000));
    if (spec.start === 'readiness') this.prompts.push(spec.assist ? 'PRESS START' : 'PRIMER, MAGS, STARTER');
  }

  private nextLeader(): Plane | null {
    const p = this.formation.find((x) => x.alive);
    return p ?? null;
  }

  get leader(): Plane {
    return this.formation[0].alive ? this.formation[0] : this.nextLeader() ?? this.player;
  }

  get time(): number {
    return this.world.time;
  }

  /** What the controller needs to know. */
  view() {
    const lead = this.player.alive ? this.player : this.leader;
    const fs = lead.fs;
    const p = this.player;
    return {
      time: this.world.time,
      pos: fs.pos,
      speed: Math.max(90, fs.tas),
      raids: this.world.raids,
      engaged: this.engaged,
      wantsHome: p.fs.fuel < p.type.fuelCapacity * 0.2 || p.armament.frac < 0.05 || damageFraction(p.damage) > 0.3,
      fromSector: Math.hypot(fs.pos.x - this.base.pos.x, fs.pos.z - this.base.pos.z),
      overFrance: isFrance(fs.pos.x, fs.pos.z),
      offMap: !this.map.inBounds(fs.pos.x, fs.pos.z),
      describe: (pp: Vec3, v?: Vec3) => describeRaid(this.map, pp, v),
    };
  }

  // ------------------------------------------------------------ commands

  private command(c: SimCmd): void {
    const p = this.player;
    const fs = p.fs;
    switch (c) {
      case 'primer': if (fs.engine === 'off') { this.primed = true; this.prompts.push('PRIMED'); } break;
      case 'mags': this.mags = !this.mags; this.prompts.push(this.mags ? 'MAGNETOS ON' : 'MAGNETOS OFF'); break;
      case 'starter':
        if (fs.engine === 'off' || fs.engine === 'dead') {
          this.cranking = 0;
          fs.engine = 'starting';
        }
        break;
      case 'startAll':
        if (fs.engine === 'off') { this.startAllT = 0; }
        break;
      case 'tallyHo': this.tallyHo(); break;
      case 'order1': case 'order2': case 'order3': case 'order4':
        this.order(c);
        break;
    }
  }

  private startup(dt: number): void {
    const fs = this.player.fs;
    if (this.startAllT >= 0) {
      // Assist: the same steps, done for you, in order.
      this.startAllT += dt;
      if (this.startAllT > 0.6 && !this.primed) { this.primed = true; this.prompts.push('PRIMED'); }
      if (this.startAllT > 1.4 && !this.mags) { this.mags = true; this.prompts.push('MAGNETOS ON'); }
      if (this.startAllT > 2.2 && fs.engine === 'off') { this.cranking = 0; fs.engine = 'starting'; this.startAllT = -1; }
    }
    if (fs.engine === 'starting' && this.cranking >= 0) {
      this.cranking += dt;
      fs.rpm = 300 + Math.sin(this.cranking * 18) * 80;
      if (this.cranking > TUNING.sortie.crankToCatch) {
        if (this.primed && this.mags) {
          fs.engine = 'running';
          fs.events.push('cough');
          this.prompts.push('SHE CATCHES!');
          this.world.emit({ kind: 'engineStart', planeId: this.player.id }, false);
        } else {
          fs.engine = 'off';
          fs.rpm = 0;
          this.prompts.push(!this.primed ? 'NOT PRIMED - SHE WON\'T CATCH' : 'MAGNETOS ARE OFF');
          this.world.emit({ kind: 'engineCough', planeId: this.player.id }, false);
        }
        this.cranking = -1;
      }
    }
  }

  tallyHo(): void {
    if (this.engaged) return;
    // Tally-ho needs something in sight.
    const me = this.player;
    let near: Plane | null = null, nd = Infinity;
    for (const q of this.world.planes) {
      if (q.side === 'raf' || !q.alive) continue;
      const d = q.pos.distTo(me.pos);
      if (d < nd) { nd = d; near = q; }
    }
    if (!near || nd > TUNING.sortie.tallyRange) {
      this.controller.say(this.time, `${this.spec.squadron} Leader: nothing in sight yet.`, 'player', false);
      return;
    }
    this.engaged = true;
    this.phase = 'combat';
    const rel = near.pos.clone().sub(me.pos);
    const brg = Math.atan2(rel.x, rel.z);
    const clock = clockOf(((brg - me.fs.heading) * 180) / Math.PI);
    const above = rel.y > 300 ? 'above' : rel.y < -300 ? 'below' : 'level';
    const count = this.world.planes.filter((q) => q.side === 'lw' && q.alive && q.pos.distTo(near!.pos) < 4000).length;
    this.controller.say(this.time, RT.tallyHo(this.spec.squadron, count > 20 ? 'many' : String(count), `${near.type.short}s`, clock, above), 'player', true);
    this.controller.tallyHo();
    this.giveAll(this.spec.leading ? 'bombers' : 'bombers');
  }

  private order(c: 'order1' | 'order2' | 'order3' | 'order4'): void {
    if (!this.spec.leading) return;
    const o: SquadronOrder = c === 'order1' ? 'bombers' : c === 'order2' ? 'escort' : c === 'order3' ? 'follow' : 'reform';
    this.controller.say(this.time, RT.orders[c](this.spec.squadron), 'player', false);
    this.giveAll(o);
    if (o === 'bombers' || o === 'escort') this.engaged = true;
  }

  private giveAll(o: SquadronOrder): void {
    for (const p of this.formation) if (p.brain instanceof WingmanBrain) p.brain.give(o);
  }

  // ------------------------------------------------------------ step

  step(f: ControlFrame | null): void {
    if (f?.cmds) for (const c of f.cmds) this.command(c);
    const dt = TUNING.sim.dt;
    this.startup(dt);
    const w = this.world;
    w.step(f);
    for (const s of this.ships) {
      if (s.sunk) continue;
      s.pos.x += Math.sin(s.heading) * 4 * dt;
      s.pos.z += Math.cos(s.heading) * 4 * dt;
    }
    // The AI squadron leader flies the controller's vectors.
    const L = this.leader;
    if (L !== this.player && L.brain instanceof WingmanBrain && L.brain.phase === 'air' && !this.engaged) {
      const v = this.controller.lastVector;
      const f2 = L.brain.fighter;
      if (v) f2.opts.waypoint = new Vec3(L.pos.x + Math.sin(v.heading) * 20000, Math.max(3000, this.controller.lastAngels / M_TO_FT + 300), L.pos.z + Math.cos(v.heading) * 20000);
      // He calls tally-ho when he sees them.
      if (f2.contacts.ids().length && !this.engaged) this.autoTally(L);
    }
    if (this.world.tick % 25 === 0) this.controller.step(this.view());
    this.trackSightings();
    this.updatePhase();
  }

  private autoTally(L: Plane): void {
    this.engaged = true;
    this.phase = 'combat';
    this.controller.say(this.time, `${this.names.get(L.id) ?? 'Leader'}: Tally-ho! Bandits ahead. Going in!`, 'squadron', true);
    this.giveAll('bombers');
  }

  /** Remember the last thing the player saw of each enemy they hit. */
  private trackSightings(): void {
    const me = this.player;
    for (const q of this.world.planes) {
      if (q.side === 'raf') continue;
      if (!q.damage.by[me.id]) continue;
      const d = q.pos.distTo(me.pos);
      const visible = d < 4000 && this.world.losClear(me.pos, q.pos);
      if (!visible) continue;
      let s: Engagement['lastSeen'] = 'hit';
      if (q.status !== 'flying') s = 'goingDown';
      else if (q.damage.fire > 0 || q.damage.glycol > 0.2 || q.damage.oil > 0.2) s = 'smoking';
      const prev = this.seen.get(q.id);
      if (prev !== 'goingDown') this.seen.set(q.id, s);
    }
  }

  private updatePhase(): void {
    const p = this.player;
    const fs = p.fs;
    if (this.phase === 'startup' && fs.engine === 'running') this.phase = 'takeoff';
    if (this.phase === 'takeoff' && !fs.onGround && fs.agl > 30) {
      this.phase = 'climb';
      if (this.airborneAt < 0) this.airborneAt = this.time;
    }
    if ((this.phase === 'climb' || this.phase === 'combat') && this.controller.log.some((m) => m.text.includes('Pancake'))) this.phase = 'rtb';
    const chute = this.world.parachutes.find((c) => c.fromPlane === p.id && c.name === 'pilot');
    if (chute && this.phase !== 'parachute' && this.phase !== 'over') this.phase = 'parachute';
    // Endings.
    if (this.endT < 0) {
      const ended = (p.status === 'landed' && this.airborneAt >= 0) || p.status === 'crashed' || p.status === 'destroyed' || p.status === 'ditched' || (chute && chute.landed);
      if (ended) this.endT = this.time + (p.status === 'landed' ? 3 : 5);
    } else if (this.time >= this.endT && !this.result) {
      this.phase = 'over';
      this.result = this.compile();
    }
  }

  // ------------------------------------------------------------ bombs & targets

  private bombImpact(pos: Vec3, _raid: Raid | undefined): void {
    const af = this.map.airfieldAt(pos.x, pos.z);
    if (af) {
      if (af.craters.length < 40) af.craters.push({ x: pos.x, z: pos.z, r: 6 + this.rng.next() * 4 });
      af.damaged++;
      this.airfieldHits[af.name] = (this.airfieldHits[af.name] ?? 0) + 1;
      // Hangars near the burst are wrecked.
      for (const o of this.objects.near(pos.x, pos.z, 120)) {
        if (o.kind === 'hangar' && o.pos.distTo(pos) < 60) { o.kind = 'wreckedHangar'; this.wrecked.push(o); }
      }
    }
    for (const s of this.ships) if (!s.sunk && Math.hypot(s.pos.x - pos.x, s.pos.z - pos.z) < 40) s.sunk = true;
  }

  /** Put the shared map back as it was when this sortie began (for a replay). */
  rewind(): void {
    this.map.airfields.forEach((a, i) => { a.craters = this.startState.craters[i].map((c) => ({ ...c })); a.damaged = this.startState.damaged[i]; });
    this.objects.balloons.forEach((b, i) => { b.down = this.startState.balloonsDown[i]; });
    for (const o of this.wrecked) o.kind = 'hangar';
  }

  // ------------------------------------------------------------ reckoning

  private compile(): SortieResult {
    const w = this.world;
    const p = this.player;
    const rng = this.rng.fork('debrief');
    // Claims.
    const engagements: Engagement[] = [];
    for (const q of w.planes) {
      if (q.side === 'raf') continue;
      const dmg = q.damage.by[p.id] ?? 0;
      if (!dmg) continue;
      const maxHp = Object.values(q.damage.maxHp).reduce((a, b) => a + (b ?? 0), 0);
      let downAt: Engagement['downAt'] = null;
      if (q.status === 'destroyed') downAt = 'air';
      else if (q.status === 'crashed' || q.status === 'wreck' || q.status === 'ditched') {
        const sea = this.map.surfaceAt(q.pos.x, q.pos.z) === 'sea';
        downAt = sea ? 'sea' : isFrance(q.pos.x, q.pos.z) ? 'france' : 'england';
      }
      engagements.push({
        enemyId: q.id, type: q.type.short, damageDone: Math.min(1, (dmg * 1.4) / Math.max(1, maxHp)),
        wentDown: q.status !== 'flying', downAt, seenCrash: q.seenCrash,
        crewBaledOut: w.parachutes.some((c) => c.fromPlane === q.id),
        lastSeen: this.seen.get(q.id) ?? 'hit', credited: q.killedBy === p.id,
      });
    }
    const claims = assessClaims(engagements, rng);
    // Raids.
    const raidNotes: string[] = [];
    let turned = 0, bombed = 0, kg = 0;
    for (const r of w.raids) {
      if (!r.started) continue;
      kg += r.bombsOnTarget;
      if (r.turnedBack || (r.bombsDropped === 0 && r.phase !== 'bombRun' && r.phase !== 'inbound')) { turned++; raidNotes.push(`The raid on ${r.spec.targetName} was turned back before it bombed.`); }
      else if (r.bombsDropped > 0) { bombed++; raidNotes.push(`The raid reached ${r.spec.targetName}. ${r.bombsOnTarget > 0 ? 'Bombs fell on the target.' : 'The bombing was scattered.'}`); }
      else raidNotes.push(`The raid on ${r.spec.targetName} was still on its way when you left it.`);
    }
    // The player's own fate.
    const outcome = this.outcome();
    // Losses in the formation.
    const losses: SortieResult['losses'] = [];
    for (const q of this.formation) {
      if (q === p) continue;
      const name = this.names.get(q.id) ?? q.callsign;
      const chute = w.parachutes.find((c) => c.fromPlane === q.id);
      const place = describePlace(this.map, q.pos.x, q.pos.z).replace(/^(over|near|off) /, '');
      if (q.status === 'flying' || q.status === 'landed') continue;
      if (chute) {
        if (chute.overSea && !this.rescued(chute.pos)) losses.push({ name, line: LOSS_LINES.lostSea(name, place), lost: true });
        else if (isFrance(chute.pos.x, chute.pos.z)) losses.push({ name, line: LOSS_LINES.pow(name), lost: true });
        else losses.push({ name, line: `${name} baled out ${describePlace(this.map, chute.pos.x, chute.pos.z)} and is safe.`, lost: false });
      } else if (q.status === 'crashed' || q.status === 'destroyed') {
        losses.push({ name, line: q.damage.pilot === 'killed' || q.status === 'destroyed' ? LOSS_LINES.lostAir(name, place) : LOSS_LINES.lostCrash(name, place), lost: true });
      }
    }
    // Everyone else's fate, for the campaign roster.
    const fates: SortieResult['fates'] = [];
    let squadronKills = 0;
    for (const q of this.formation) {
      if (q === p) continue;
      const kills = w.planes.filter((e) => e.side === 'lw' && e.killedBy === q.id && e.status !== 'flying').length;
      squadronKills += kills;
      const name = this.names.get(q.id) ?? q.callsign;
      const loss = losses.find((l) => l.name === name);
      const chute = w.parachutes.find((c) => c.fromPlane === q.id);
      let fate: SortieResult['fates'][number]['fate'] = 'ok';
      if (loss?.lost) fate = chute && isFrance(chute.pos.x, chute.pos.z) ? 'pow' : 'lost';
      else if (loss) fate = 'safe';
      else if (q.damage.pilot === 'wounded') fate = 'wounded';
      else if (damageFraction(q.damage) > 0.08 || q.status === 'crashed') fate = 'damaged';
      fates.push({ id: this.rosterIds.get(q.id) ?? -1, name, fate, kills });
    }
    const t = tally(claims);
    const types = [...new Set(w.planes.filter((q) => q.side === 'lw' && q.pos.distTo(p.pos) < 50000 && (q.damage.by[p.id] || this.engaged)).map((q) => q.type.short + 's'))].slice(0, 2).join(' and ');
    const placeOfFight = this.fightPlace ?? describePlace(this.map, p.pos.x, p.pos.z).replace(/^(over|near|off) /, '');
    let line = this.engaged && types ? logEngaged(rng, types, placeOfFight) : logNoContact(rng, placeOfFight);
    const cl = logClaims(t.destroyed, t.probable, t.damaged, '');
    if (cl) line += ' ' + cl;
    line += ' ' + outcome.line;
    const dmgNotes: string[] = [];
    const d = p.damage;
    if (d.glycol > 0) dmgNotes.push('glycol leak');
    if (d.oil > 0) dmgNotes.push('oil leak');
    if (d.fire > 0) dmgNotes.push('fire');
    if (d.aileron + d.elevator + d.rudder > 0.2) dmgNotes.push('control surfaces');
    if (d.gear !== 'ok') dmgNotes.push('undercarriage');
    if (!d.flaps) dmgNotes.push('flaps');
    if (d.pilot === 'wounded') dmgNotes.push('pilot wounded');
    if (d.hits > 0 && !dmgNotes.length) dmgNotes.push(`${d.hits} holes`);
    return {
      date: `${this.spec.day} ${MONTHS[this.spec.month - 1]} 1940`,
      aircraft: AIRCRAFT[this.spec.playerType].name,
      durationMin: Math.round(this.time / 60),
      takeoffDelay: this.airborneAt >= 0 ? Math.round(this.airborneAt) : -1,
      claims,
      roundsFired: p.armament.fired,
      damageTaken: damageFraction(p.damage),
      damageNotes: dmgNotes,
      outcome,
      raidNotes,
      raidsTurned: turned,
      raidsBombed: bombed,
      bombsOnTargetKg: kg,
      losses,
      enemyDown: w.planes.filter((q) => q.side === 'lw' && q.status !== 'flying').length,
      logLine: line,
      rtLog: this.controller.log.map((m) => m.text),
      engaged: this.engaged,
      fates,
      squadronKills,
      airfieldHits: { ...this.airfieldHits },
    };
  }

  /** Where the fight was (set when tally-ho is called; for the logbook). */
  private get fightPlace(): string | null {
    const r = this.controller.targetRaid;
    if (!r || !this.engaged) return null;
    return describePlace(this.map, r.plot.x, r.plot.z).replace(/^(over|near|off) /, '');
  }

  private rescued(pos: Vec3): boolean {
    const d = distanceToEnglishCoast(this.map, pos.x, pos.z);
    const p = d < 5000 ? 0.85 : d < 15000 ? 0.6 : d < 25000 ? 0.3 : 0.12;
    return new Rng(Math.floor(pos.x) ^ Math.floor(pos.z) ^ this.spec.seed).chance(p);
  }

  private outcome(): PilotOutcome {
    const p = this.player;
    const w = this.world;
    const place = (pos: Vec3) => placeName(this.map, pos.x, pos.z);
    const d = p.damage;
    const cause = d.fire > 0 ? CAUSE.fire : p.fs.engine === 'seized' ? (d.glycol > 0 ? CAUSE.glycol : CAUSE.seized) : d.oil > 0.3 ? CAUSE.oil : p.fs.fuel <= 0 ? CAUSE.fuel : d.gear !== 'ok' ? CAUSE.gear : d.aileron + d.elevator > 0.4 ? CAUSE.controls : CAUSE.none;
    const chute = w.parachutes.find((c) => c.fromPlane === p.id && c.name === 'pilot');
    if (chute) {
      const pl = place(chute.pos);
      if (chute.overSea) {
        if (this.rescued(chute.pos)) return { kind: 'bailSea', pilot: 'shaken', aircraft: 'writeOff', place: pl, line: LANDING_LINES.bailSeaRescued(pl, '', cause) };
        return { kind: 'lostSea', pilot: 'lost', aircraft: 'writeOff', place: pl, line: `Baled out over the Channel off ${pl}. Not picked up.` };
      }
      if (isFrance(chute.pos.x, chute.pos.z)) return { kind: 'pow', pilot: 'lost', aircraft: 'writeOff', place: pl, line: 'Baled out over France. Taken prisoner.' };
      return { kind: 'bailLand', pilot: 'shaken', aircraft: 'writeOff', place: pl, line: LANDING_LINES.bailLand(describePlace(this.map, chute.pos.x, chute.pos.z).replace(/^(over|near) /, ''), '', cause) };
    }
    const r = p.landing.result;
    const pl = place(p.pos);
    if (p.status === 'crashed' || p.status === 'destroyed' || r?.pilot === 'lost') {
      return { kind: 'killed', pilot: 'lost', aircraft: 'writeOff', place: pl, line: `Killed ${describePlace(this.map, p.pos.x, p.pos.z)}.` };
    }
    if (p.status === 'ditched' || r?.kind === 'ditched') {
      if (this.rescued(p.pos)) return { kind: 'ditched', pilot: r?.pilot ?? 'shaken', aircraft: 'writeOff', place: pl, line: LANDING_LINES.ditched(pl, '', cause) };
      return { kind: 'lostSea', pilot: 'lost', aircraft: 'writeOff', place: pl, line: `Ditched off ${pl}. Not picked up.` };
    }
    const surface = this.map.fieldAt(p.pos.x, p.pos.z).crop ?? this.map.surfaceAt(p.pos.x, p.pos.z);
    const surfName = surface === 'gold' || surface === 'corn' ? 'cornfield' : surface === 'stubble' ? 'stubble field' : surface === 'ploughed' ? 'ploughed field' : surface === 'pasture' ? 'meadow' : surface === 'airfield' ? 'airfield' : String(surface);
    const onAirfield = !!this.map.airfieldAt(p.pos.x, p.pos.z);
    const kind = r?.kind ?? 'roll';
    const pilot = r?.pilot ?? 'fine';
    const aircraft = r?.aircraft ?? 'fine';
    if (kind === 'belly') return { kind: 'belly', pilot, aircraft, place: pl, line: LANDING_LINES.belly(pl, surfName, cause) };
    if (kind === 'crashSurvived') return { kind: 'crashLanded', pilot, aircraft, place: pl, line: LANDING_LINES.crashSurvived(pl, surfName, cause) };
    if (kind === 'noseOver') return { kind: onAirfield ? 'landed' : 'forced', pilot, aircraft, place: pl, line: LANDING_LINES.noseOver(pl, surfName, cause) };
    if (!onAirfield) return { kind: 'forced', pilot, aircraft, place: pl, line: LANDING_LINES.forced(pl, surfName, cause) };
    const ln = LANDING_LINES[kind] ?? LANDING_LINES.roll;
    return { kind: 'landed', pilot, aircraft, place: pl, line: ln(pl, surfName, cause) };
  }
}

/** Day of the campaign as 0..1 for crop colours (early July → end of October). */
export function seasonOf(month: number, day: number): number {
  const doy = dayOfYear(month, day);
  return Math.max(0, Math.min(1, (doy - dayOfYear(7, 1)) / (dayOfYear(10, 31) - dayOfYear(7, 1))));
}

/** Vic formations: leader, then vics of three, sections behind. Body-frame offsets (m). */
export function formationSlots(n: number, style: 'vic' | 'pairs' = 'vic'): Vec3[] {
  if (style === 'pairs') {
    // Sections of four in loose line abreast, each a leader and wingman pair:
    // spread out, everyone free to search the sky.
    const out: Vec3[] = [];
    for (let i = 0; i < n; i++) {
      const section = Math.floor(i / 4), k = i % 4;
      const sx = (section % 2 ? 1 : -1) * Math.ceil(section / 2) * 300;
      const pairX = [0, 70, -180, -110][k];
      const pairZ = [0, -40, -30, -70][k];
      out.push(new Vec3(sx + pairX, (k > 1 ? 40 : 0) + section * 25, pairZ - section * 60));
    }
    return out;
  }
  const out: Vec3[] = [new Vec3(0, 0, 0)];
  const vic = [new Vec3(-30, -3, -25), new Vec3(30, -3, -25)];
  for (let i = 1; i < n; i++) {
    const section = Math.floor(i / 3);
    const inVic = i % 3;
    if (section === 0) out.push(vic[inVic - 1].clone());
    else {
      const lead = new Vec3((section % 2 ? -1 : 1) * 90 * Math.ceil(section / 2), -10 * section, -90 * section);
      out.push(inVic === 0 ? lead : lead.clone().add(vic[inVic - 1]));
    }
  }
  return out;
}

// ------------------------------------------------------------------ raid generation

export function generateRaids(rng: Rng, phase: Phase, home: Airfield, map: WorldMap, underAttack: boolean, count = 1): RaidSpec[] {
  const out: RaidSpec[] = [];
  for (let n = 0; n < count; n++) {
    const tpls = RAID_TEMPLATES[phase];
    const total = tpls.reduce((a, t) => a + t.weight, 0);
    let r = rng.next() * total, i = 0;
    while (r > tpls[i].weight) r -= tpls[i++].weight;
    const t = tpls[i];
    let targetName: string, target: Vec3;
    if (t.kind === 'airfield') {
      const names = underAttack && n === 0 ? [home.name] : TARGETS.airfield;
      const af = map.airfieldByName(rng.pick(names)) ?? home;
      targetName = af.name;
      target = af.pos.clone();
    } else {
      const list = TARGETS[t.kind];
      const pick = rng.pick(list);
      const [x, z] = lonLatToXZ(pick.lat, pick.lon);
      targetName = pick.name;
      target = new Vec3(x, 0, z);
    }
    const asm = rng.pick(ASSEMBLY);
    const [sx, sz] = lonLatToXZ(asm.lat, asm.lon);
    const start = new Vec3(sx, 0, sz);
    // Coast crossing: part-way between assembly and target, on the English coast.
    const entry = start.clone().lerp(target, 0.45);
    const alt = rng.range(t.alt[0], t.alt[1]);
    const groups = t.groups.map((g) => ({
      type: g.type, role: g.role, altOffset: g.altOffset,
      count: g.count[0] + rng.int(g.count[1] - g.count[0] + 1),
      skill: rng.pick(g.skill),
    }));
    // Scrambling under attack: the raid is already on its way in.
    let delay = 30 + n * 240 + rng.range(0, 60);
    if (underAttack && n === 0) {
      start.lerp(target, 0.6);
      entry.copy(start).lerp(target, 0.5);
      delay = 5;
    }
    out.push({ name: `raid${n + 1}`, kind: t.kind, targetName, target, start, entry, alt, speed: t.speed, groups, delay });
  }
  return out;
}
