// A sortie: the phone rings at dispersal and the clock starts; start-up,
// take-off, the climb under the controller's vectors, the fight, getting
// home, and the reckoning. Owns the World and everything stepped with it,
// deterministically, so the whole thing can be replayed from the seed and
// the recorded controls.

import { M_TO_FT, Vec3 } from '../core/math';
import { Rng } from '../core/rng';
import { AircraftId, AIRCRAFT } from '../content/aircraft';
import { ASSEMBLY, RAID_TEMPLATES, TARGETS } from '../content/raids';
import { CAUSE, WRITE_UP, LANDING_LINES, logClaims, logEngaged, logNoContact, LOSS_LINES, Phase } from '../content/text/briefing';
import { CALLSIGNS, RT, clockOf, sayAngels, sayHeading, sayMiles, sayStrength } from '../content/text/rt';
import { describePlace, describeRaid, distanceToEnglishCoast, isFrance, placeName } from '../content/world/describe';
import { Airfield, lonLatToXZ, WorldMap } from '../content/world/map';
import { WorldObjects } from '../content/world/objects';
import type { Ship } from '../render/worldLayer';
import { ControlFrame, SimCmd } from '../input/input';
import { TUNING } from '../tuning';
import { threatGeometry } from './ai/spotting';
import { skillFor, SkillLevel } from './ai/types';
import { Base, SquadronOrder, WingmanBrain } from './ai/wingman';
import { assessClaims, Claim, Engagement, tally } from './claims';
import { CloudField } from './clouds';
import { SectorController } from './controller';
import { damageFraction } from './damage';
import { DockingComputer } from './docking';
import { Plane } from './plane';
import { Raid, RaidSpec } from './raid';
import { OtherEvent, OtherSquadron, OtherSquadronSpec } from './squadrons';
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
  /** Campaign: the player's experience on the type, 0 (green) to 1 (skilled). */
  typeSkill?: number;
  /** Spawn the player at this height and position for 'air' starts. */
  airStart?: { pos: Vec3; heading: number };
  /** Other squadrons up as well (default on). */
  otherSquadrons?: boolean;
}

/** Why you broke off, as you reported it. */
export type ReportKind = 'ammo' | 'damaged' | 'wounded' | 'fuel';

const REPORT_WORDS: Record<ReportKind, string> = { ammo: 'out of ammunition', damaged: 'damaged', wounded: 'wounded', fuel: 'short of fuel' };

/** One call on the R/T menu: the command it sends and its button label. */
export interface RTOption { cmd: SimCmd; label: string }

export type SortiePhase = 'startup' | 'takeoff' | 'climb' | 'combat' | 'rtb' | 'down' | 'parachute' | 'over';

export interface PilotOutcome {
  /** How the sortie ended for the player. */
  kind: 'landed' | 'forced' | 'belly' | 'crashLanded' | 'ditched' | 'bailLand' | 'bailSea' | 'lostSea' | 'killed' | 'pow';
  pilot: 'fine' | 'shaken' | 'wounded' | 'lost';
  aircraft: 'fine' | 'minor' | 'damaged' | 'repairable' | 'writeOff';
  place: string;
  line: string;
  /** Landed a sound aircraft away from an airfield without cause: the reprimand. */
  writtenUp?: string;
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
  /** Your R/T reports that bear on the sortie (breaking off, Mayday). */
  rtNotes?: string[];
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

/** A homing given over the R/T: the field, and which way to land on it. */
export interface Homing {
  field: Airfield;
  /** Landing direction, into the wind (rad). */
  landDir: number;
}

/** The nearest friendly field (or of a list), and its landing direction into the wind. */
export function homingTo(map: WorldMap, pos: Vec3, raf: boolean, wind: Vec3, only?: string[]): Homing {
  const list = map.airfields.filter((a) => (only ? only.includes(a.name) : raf === (a.kind !== 'luftwaffe')));
  let field = list[0], bd = Infinity;
  for (const a of list) {
    const d = Math.hypot(a.pos.x - pos.x, a.pos.z - pos.z);
    if (d < bd) { bd = d; field = a; }
  }
  const d = (field.dir * Math.PI) / 180;
  // Land into the wind (the wind vector is where the air is going).
  const landDir = Math.sin(d) * wind.x + Math.cos(d) * wind.z > 0 ? d + Math.PI : d;
  return { field, landDir: ((landDir % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) };
}

const EASIER: Record<SkillLevel, SkillLevel> = { experte: 'average', average: 'green', green: 'green' };

/**
 * Arcade mode: skip the scramble and the long climb. The squadron starts in
 * the air above and to one side of the raid's track, the raid already
 * crossing the coast, and the enemy a grade less skilled.
 */
export function arcadeSpec(spec: SortieSpec, takeoff = false): SortieSpec {
  const A = TUNING.arcade;
  const raids = spec.raids.map((r) => ({ ...r, groups: r.groups.map((g) => ({ ...g, skill: EASIER[g.skill] })) }));
  if (spec.start === 'air' || !raids.length) return { ...spec, raids };
  // Take-off kept: the scramble as it was, with the raid already on its way
  // (JUMP TO RAID takes the squadron to it once airborne).
  if (takeoff) { raids[0] = { ...raids[0], delay: 0 }; return { ...spec, raids }; }
  const r = raids[0] = { ...raids[0], delay: 0, start: raids[0].entry.clone().lerp(raids[0].start, 0.05) };
  // Ahead of the raid on its track and off to one side, turned in towards it.
  const tx = r.target.x - r.start.x, tz = r.target.z - r.start.z, l = Math.hypot(tx, tz) || 1;
  const px = r.start.x + (tx / l) * A.startAhead - (tz / l) * A.startAside;
  const pz = r.start.z + (tz / l) * A.startAhead + (tx / l) * A.startAside;
  return {
    ...spec, raids, start: 'air', underAttack: false,
    airStart: { pos: new Vec3(px, r.alt + A.startAbove, pz), heading: Math.atan2(r.start.x - px, r.start.z - pz) },
  };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export class Sortie {
  readonly world: World;
  readonly controller: SectorController;
  readonly base: Airfield;
  readonly player: Plane;
  readonly formation: Plane[] = [];
  /** Other squadrons up at the same time. */
  readonly others: OtherSquadron[] = [];
  /** Each formation member's slot (body-frame offset from the leader). */
  private slots: Vec3[] = [];
  /** Arcade: the squadron has jumped to the raid (once a sortie). */
  jumpedToRaid = false;
  readonly ships: Ship[] = [];
  phase: SortiePhase;
  engaged = false;
  private rng: Rng;
  /** Starting up: primer strokes given and wanted, magnetos, the turn on the starter. */
  private strokes = 0;
  readonly primeNeed: number;
  private mags = false;
  private cranking = -1;
  /** This turn on the starter catches at this many seconds (Infinity: it won't). */
  private catchAt = Infinity;
  private startAllT = -1;
  private engineRng: Rng;
  /** How the last turn on the starter went. */
  lastStart: 'none' | 'caught' | 'mags' | 'unprimed' | 'short' | 'unlucky' | 'flooded' | 'gone' = 'none';
  private airborneAt = -1;
  private endT = -1;
  private seen = new Map<number, Engagement['lastSeen']>();
  private names = new Map<number, string>();
  private rosterIds = new Map<number, number>();
  private airfieldHits: Record<string, number> = {};
  /** Messages for the screen (start-up prompts etc.). */
  prompts: string[] = [];
  result: SortieResult | null = null;
  /** The airfield the controller last gave a homing to (shown on screen). */
  homing: Homing | null = null;
  private homingDue = -1;
  /** Squadron R/T: when the last "break!" and "bandits!" calls went out (s). */
  private lastBreakCall = -100;
  private lastSightingCall = -100;
  /** What you reported on the R/T: breaking off, and why (for the debrief). */
  reported: { kind: ReportKind; t: number } | null = null;
  /** A Mayday you sent: when, and whether over the sea. */
  mayday: { t: number; sea: boolean } | null = null;
  /** Aircraft (ids) whose ditching or bale-out over the sea was called in to air-sea rescue. */
  private asrAlerted = new Set<number>();
  /** Raids we asked for help against, and free hunts the controller warned us of. */
  private helpAsked = new Set<number>();
  private huntWarned = new Set<number>();
  /** Answers on their way: the controller takes a few seconds to come back. */
  private replies: { t: number; say: () => void }[] = [];
  /** Events the squadron R/T has already answered. */
  private heard = new WeakSet<object>();
  /** Jump to final approach after a homing, and land her (Assist/Arcade). */
  readonly docking = new DockingComputer();
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
    // Starting up has its own dice, so it doesn't shift anything else in the sortie.
    this.engineRng = new Rng(spec.seed ^ 0xe791);
    const T = TUNING.sortie;
    this.primeNeed = T.primeBase + (spec.hour < 9 || spec.month >= 10 ? 1 : 0) + (this.engineRng.chance(0.3) ? 1 : 0);
    const w = (this.world = new World(spec.seed, map));
    w.playerTypeSkill = spec.typeSkill ?? 0.5;
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
    const slots = (this.slots = formationSlots(n, spec.formation ?? 'vic'));
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
    // And the other squadrons sent after them.
    if (spec.otherSquadrons !== false) this.planOthers(spec, map);
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
    if (spec.start === 'readiness') this.prompts.push(`FITTER: ${this.primeNeed} STROKES SHOULD DO HER, SIR`);
  }

  /** Other squadrons against each raid, and in September, perhaps 12 Group's wing. */
  private planOthers(spec: SortieSpec, map: WorldMap): void {
    const S = TUNING.sky;
    const rng = this.rng.fork('others');
    const calls = CALLSIGNS.others.filter((c) => c !== spec.squadron);
    const bases = TARGETS.airfield.filter((n) => n !== spec.home).map((n) => map.airfieldByName(n)).filter((a): a is Airfield => !!a);
    const formation = spec.formation ?? 'vic';
    const add = (o: OtherSquadronSpec) => {
      const sq = new OtherSquadron(o, rng.fork(o.callsign));
      sq.onEvent = (e, s, raid) => this.otherEvent(e, s, raid);
      this.others.push(sq);
    };
    for (const r of this.world.raids) {
      if (!r.bombing) continue;
      const wts = S.othersPerRaid;
      let x = rng.next() * wts.reduce((a, b) => a + b, 0), n = 0;
      while (n < wts.length - 1 && x > wts[n]) x -= wts[n++];
      for (let i = 0; i < n && calls.length && bases.length; i++) {
        const callsign = calls.splice(rng.int(calls.length), 1)[0];
        const base = rng.pick(bases);
        add({
          callsign, type: rng.chance(0.6) ? 'hurricane' : 'spitfire', count: 10 + rng.int(3),
          base: base.pos.clone(), baseName: base.name, raidId: r.id, scrambleAt: r.spec.delay + rng.range(20, 180), formation,
        });
      }
    }
    // 12 Group's big wing: three squadrons from Duxford, slow to form up, after the biggest raid.
    const big = this.world.raids.filter((r) => r.bombing).sort((a, b) => b.total - a.total)[0];
    if (spec.phase === 'london' && big && rng.chance(S.bigWingChance)) {
      const [dx, dz] = lonLatToXZ(52.09, 0.13);
      for (let i = 0; i < S.bigWingSquadrons; i++) {
        add({
          callsign: CALLSIGNS.bigWing[i % CALLSIGNS.bigWing.length], type: i === S.bigWingSquadrons - 1 ? 'spitfire' : 'hurricane', count: 12,
          base: new Vec3(dx, 30, dz), baseName: 'Duxford', raidId: big.id, scrambleAt: Math.max(0, big.spec.delay - 120), bigWing: true,
          offset: new Vec3((i - 1) * 700, i * 150, -i * 400), formation: 'vic',
        });
      }
    }
  }

  /** What the player hears of the other squadrons. */
  private otherEvent(e: OtherEvent, sq: OtherSquadron, raid: Raid | null): void {
    const t = this.time, C = this.controller, sqn = this.spec.squadron;
    const mine = !!raid && raid === C.targetRaid;
    if (e === 'airborne' && sq.spec.bigWing && sq === this.others.find((o) => o.spec.bigWing)) {
      const n = this.others.filter((o) => o.spec.bigWing).reduce((a, o) => a + o.spec.count, 0);
      C.say(t, RT.bigWing(sqn, C.callsign, sayStrength(n), sayAngels(((raid?.alt ?? 5000) + 1500) * M_TO_FT)), 'controller', false);
    } else if (e === 'airborne' && mine && !sq.spec.bigWing) C.say(t, RT.otherUp(sqn, C.callsign, sq.spec.callsign), 'controller', false);
    else if (e === 'engaging' && mine) C.say(t, RT.otherEngaging(sqn, C.callsign, sq.spec.callsign, describeRaid(this.map, raid!.plot, raid!.vel)), 'controller', false);
    else if (e === 'engaging') C.say(t, RT.otherTally(sq.spec.callsign), 'other', false, 0.55);
    else if (e === 'tallyHo') C.say(t, RT.otherTally(sq.spec.callsign), 'other', true);
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
      wantsHome: !!this.reported || p.fs.fuel < p.type.fuelCapacity * 0.2 || p.armament.frac < 0.05 || damageFraction(p.damage) > 0.3,
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
      case 'primer':
        if (fs.engine === 'off') { this.strokes++; this.prompts.push(`PRIMER: ${this.strokes} STROKE${this.strokes > 1 ? 'S' : ''}`); }
        break;
      case 'mags': this.mags = !this.mags; this.prompts.push(this.mags ? 'MAGNETOS ON' : 'MAGNETOS OFF'); break;
      case 'starter': this.crank(); break;
      case 'startAll':
        if (fs.engine === 'off' && this.startAllT < 0) { this.startAllT = 0; }
        break;
      case 'tallyHo': this.tallyHo(); break;
      case 'jumpHome': this.jumpHome(); break;
      case 'jumpRaid': this.jumpToRaid(); break;
      case 'homing':
        if (this.homingDue >= 0 || fs.onGround) break;
        this.controller.say(this.time, RT.homingReq(this.spec.squadron, this.controller.callsign), 'player', false);
        this.homingDue = this.time + TUNING.sortie.homingDelay;
        break;
      case 'order1': case 'order2': case 'order3': case 'order4':
        this.order(c);
        break;
      case 'rtVector': case 'rtNewRaid': case 'rtFix': case 'rtHelp': case 'rtReport': case 'rtMayday':
        if (this.rtOptions().some((o) => o.cmd === c)) this.radioCall(c);
        break;
    }
  }

  /** Where starting up has got to, for the screen. */
  get engineStart() {
    return { strokes: this.strokes, need: this.primeNeed, flood: this.primeNeed + TUNING.sortie.primeFlood, mags: this.mags, cranking: this.cranking >= 0, last: this.lastStart };
  }

  /** The next step of starting up: what the single START key does, and assist does for you. */
  nextStartStep(): 'primer' | 'mags' | 'starter' {
    if (this.player.fs.engine === 'off' && this.strokes < this.primeNeed) return 'primer';
    return this.mags ? 'starter' : 'mags';
  }

  /** A turn on the starter. Whether she catches is decided now, from the priming and a little luck. */
  private crank(): void {
    const fs = this.player.fs;
    if (fs.engine !== 'off' && fs.engine !== 'dead') return;
    const T = TUNING.sortie;
    this.cranking = 0;
    fs.engine = 'starting';
    this.catchAt = Infinity;
    if (!this.mags) { this.lastStart = 'mags'; return; }
    // Shot through or out of fuel, nothing will start it.
    if (fs.fuel <= 0 || this.player.damage.engines.every((e) => e <= 0)) { this.lastStart = 'gone'; return; }
    // In the air a dead engine is warm and windmilling: magnetos are all it needs.
    if (!fs.onGround) { this.catchAt = T.catchAfter[0]; return; }
    const r = this.engineRng;
    const roll = r.next(), when = T.catchAfter[0] + r.next() * (T.catchAfter[1] - T.catchAfter[0]);
    if (this.strokes > this.primeNeed + T.primeFlood) this.lastStart = 'flooded';
    else if (this.strokes === 0 || this.strokes < this.primeNeed - 1) this.lastStart = 'unprimed';
    else if (this.strokes < this.primeNeed) { this.lastStart = 'short'; if (roll < T.catchChanceShort) this.catchAt = when; }
    else { this.lastStart = 'unlucky'; if (roll < T.catchChance) this.catchAt = when; }
  }

  private startup(dt: number): void {
    const fs = this.player.fs;
    const T = TUNING.sortie;
    if (this.startAllT >= 0 && fs.engine !== 'starting') {
      // Assist: the same steps, done for you, one at a time; another turn if she doesn't catch.
      this.startAllT += dt;
      if (fs.engine !== 'off') this.startAllT = -1;
      else if (this.startAllT >= T.assistStep) { this.startAllT = 0; this.command(this.nextStartStep()); }
    }
    if (fs.engine === 'starting' && this.cranking >= 0) {
      this.cranking += dt;
      fs.rpm = 300 + Math.sin(this.cranking * 18) * 80;
      if (this.cranking >= this.catchAt) {
        fs.engine = 'running';
        fs.events.push('cough');
        this.lastStart = 'caught';
        this.prompts.push('SHE CATCHES!');
        this.world.emit({ kind: 'engineStart', planeId: this.player.id }, false);
        this.cranking = -1;
      } else if (this.cranking > T.crankToCatch) {
        fs.engine = fs.onGround ? 'off' : 'dead';
        fs.rpm = 0;
        this.prompts.push({
          mags: 'MAGNETOS ARE OFF', unprimed: this.strokes ? 'NOT ENOUGH PRIME - SHE WON\'T FIRE' : 'NOT PRIMED - SHE WON\'T FIRE', short: 'SHE COUGHS AND DIES - ANOTHER STROKE',
          unlucky: 'SHE WON\'T CATCH - TRY AGAIN', flooded: 'FLOODED - KEEP CRANKING TO CLEAR HER', gone: 'NOTHING - SHE\'S HAD IT', none: '', caught: '',
        }[this.lastStart]);
        // Turning her over on the starter blows out the extra fuel.
        if (this.lastStart === 'flooded') this.strokes = Math.max(this.primeNeed, this.strokes - 2);
        if (this.lastStart !== 'mags' && this.lastStart !== 'unlucky') this.world.emit({ kind: 'engineCough', planeId: this.player.id }, false);
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
    w.step(this.docking.control(this.player, f));
    for (const o of this.others) o.step(dt, w, this.player, this.time);
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
    this.goInWhenObvious();
    this.radio();
    for (let i = 0; i < this.replies.length; i++) if (this.replies[i].t <= this.time) { this.replies[i].say(); this.replies.splice(i--, 1); }
    if (this.world.tick % 25 === 0) this.controller.step(this.view());
    if (this.homingDue >= 0 && this.time >= this.homingDue) this.giveHoming();
    this.trackSightings();
    this.updatePhase();
  }

  /** The raid to jump to: the controller's, or the first still coming in. */
  private joinable(r: Raid): boolean {
    return r.started && (!r.spawned || r.planes.some((q) => q.alive)) && (r.phase === 'inbound' || r.phase === 'bombRun');
  }

  private raidToJoin(): Raid | null {
    const t = this.controller.targetRaid;
    return t && this.joinable(t) ? t : this.world.raids.find((r) => this.joinable(r)) ?? null;
  }

  /** Why the squadron can't jump to the raid now, or null if it can. */
  raidJumpRefusal(): string | null {
    const p = this.player;
    if (this.jumpedToRaid || this.engaged) return 'ALREADY IN THE FIGHT';
    if (p.status !== 'flying' || p.fs.onGround || p.fs.agl < TUNING.arcade.jumpMinAgl) return 'GET AIRBORNE FIRST';
    if (!this.raidToJoin()) return 'NO RAID TO JOIN';
    for (const q of this.world.planes) if (q.side !== p.side && q.alive && q.pos.distTo(p.pos) < TUNING.docking.clearOfEnemy) return 'THE ENEMY IS ALREADY IN SIGHT';
    return null;
  }

  /**
   * Arcade's picture of a raid: ahead of it on its track, off to one side and
   * above, turned in towards it. Once it's on its way home, behind it instead,
   * on our side, chasing it.
   */
  private static jumpPlace(at: Vec3, dir: Vec3, alt: number, homeward: boolean): { pos: Vec3; hdg: number } {
    const A = TUNING.arcade;
    const k = homeward ? -1 : 1;
    const pos = new Vec3(at.x + k * dir.x * A.startAhead - dir.z * A.startAside, alt + A.startAbove, at.z + k * dir.z * A.startAhead + dir.x * A.startAside);
    return { pos, hdg: Math.atan2(at.x - pos.x, at.z - pos.z) };
  }

  /**
   * Seconds until the squadron, climbing and flying from where it is, could
   * be in arcade's place by the raid, the raid flying on along its route;
   * never over France (the sea off it is fair game). Can't be caught this side of the coast: the last
   * moment before it gets there, and how far short we'd be (s).
   */
  /** Over French soil (the sea off it doesn't count). */
  private overFrance(v: Vec3): boolean {
    return isFrance(v.x, v.z) && this.map.surfaceAt(v.x, v.z) !== 'sea';
  }

  private meetingTime(r: Raid): { t: number; late: number } | null {
    const A = TUNING.arcade, S = TUNING.sky, me = this.player.pos;
    const climb = Math.max(0, r.alt + A.startAbove - me.y) / S.climbRate;
    let best: { t: number; late: number } | null = null;
    for (let t = 0; t <= A.jumpMaxAhead; t += 5) {
      const at = r.predict(t);
      const { pos } = Sortie.jumpPlace(at.pos, at.dir, r.alt, at.homeward);
      if (this.overFrance(pos) || this.overFrance(at.pos)) continue;
      const late = Math.max(climb, Math.hypot(pos.x - me.x, pos.z - me.z) / S.cruise) - t;
      if (late <= 0) return { t, late: 0 };
      // Late, caught just before it gets home: leave it a minute short of the coast.
      const then = r.predict(t + 60).pos;
      if (!this.overFrance(then) && (!best || late <= best.late)) best = { t, late };
    }
    return best;
  }

  /**
   * Arcade, after a real take-off: the whole squadron jumps to where it
   * would meet the raid, both flying on. The raid moves on that long along
   * its route, the squadron uses that much fuel, and it arrives in arcade's
   * place by the raid. The controller's raid if it can be caught short of
   * France, else the next one that can.
   */
  private jumpToRaid(): void {
    const why = this.raidJumpRefusal();
    if (why) { this.prompts.push(why); return; }
    const A = TUNING.arcade;
    // The controller's raid if we can meet it this side of France, else the next one we can;
    // failing that, whichever we'd be least late for, caught just before it gets home.
    const first = this.raidToJoin()!;
    let r: Raid | null = null, t = 0, late = Infinity;
    for (const c of [first, ...this.world.raids.filter((x) => x !== first && this.joinable(x))]) {
      const m = c.spawned ? { t: 0, late: 0 } : this.meetingTime(c);
      if (m && m.late < late) { r = c; t = m.t; late = m.late; }
      if (late === 0) break;
    }
    if (!r) { this.prompts.push('NO RAID THIS SIDE OF FRANCE'); return; }
    r.fastForward(t, this.time);
    for (const q of this.formation) {
      if (q.status === 'flying') q.fs.fuel = Math.max(q.type.fuelCapacity * 0.1, q.fs.fuel - q.type.fuelBurn * A.jumpFuelRate * t);
    }
    const plot = r.plot;
    let dir = new Vec3(r.vel.x, 0, r.vel.z);
    if (dir.len() < 1) dir = new Vec3(r.spec.target.x - plot.x, 0, r.spec.target.z - plot.z);
    dir.scale(1 / (dir.len() || 1));
    const { pos, hdg } = Sortie.jumpPlace(plot, dir, r.alt, r.phase === 'outbound');
    const fx = Math.sin(hdg), fz = Math.cos(hdg), rx = Math.cos(hdg), rz = -Math.sin(hdg);
    const leader = this.leader;
    this.formation.forEach((q, i) => {
      if (q.status !== 'flying') return;
      const s = this.slots[i] ?? new Vec3();
      q.fs.setAirborne(new Vec3(pos.x + rx * s.x + fx * s.z, pos.y + s.y, pos.z + rz * s.x + fz * s.z), hdg, 120);
      q.prevPos.copy(q.pos);
      const b = q.brain;
      if (b instanceof WingmanBrain && b.phase !== 'air') { b.phase = 'air'; b.fighter.opts.leader = leader; b.fighter.state = 'formation'; }
    });
    this.jumpedToRaid = true;
    this.controller.say(this.time, `${this.spec.squadron} Leader: Bandits ahead. Going in.`, 'player', false);
    this.prompts.push(late > 0 ? 'CAUGHT IT ON ITS WAY HOME' : t >= 60 ? `RAID AHEAD - ${Math.round(t / 60)} MIN LATER` : 'RAID AHEAD');
  }

  /** The docking computer: straight onto finals for the homing field. */
  private jumpHome(): void {
    const why = DockingComputer.refuse(this.world, this.player, this.homing);
    if (why) { this.prompts.push(why); return; }
    this.docking.engage(this.player, this.homing!);
    this.controller.say(this.time, `${this.spec.squadron} Leader: Coming home.`, 'player', false);
    this.prompts.push('ON FINALS - STICK TO TAKE OVER');
  }

  /** The controller's answer to a homing request: course, distance, landing direction. */
  private giveHoming(): void {
    this.homingDue = -1;
    const me = this.player.pos;
    const h = (this.homing = homingTo(this.map, me, true, this.world.weather.wind));
    const f = h.field.pos;
    const brg = Math.atan2(f.x - me.x, f.z - me.z);
    const d = Math.hypot(f.x - me.x, f.z - me.z);
    const deg = (r: number) => (r * 180) / Math.PI;
    this.controller.say(this.time, RT.homing(this.spec.squadron, this.controller.callsign, sayHeading(deg(brg)), h.field.name, sayMiles(d), sayHeading(deg(h.landDir))), 'controller', true);
  }

  private autoTally(L: Plane): void {
    this.engaged = true;
    this.phase = 'combat';
    this.controller.say(this.time, `${this.names.get(L.id) ?? 'Leader'}: Tally-ho! Bandits ahead. Going in!`, 'squadron', true);
    this.giveAll('bombers');
  }

  // ------------------------------------------------------------ the R/T menu

  /** Why we'd break off now, if there's a reason. */
  reportKind(): ReportKind | null {
    const p = this.player, d = p.damage;
    if (d.pilot === 'wounded') return 'wounded';
    if (damageFraction(d) > 0.15 || d.fire > 0 || d.glycol > 0.2 || d.oil > 0.3 || p.fs.engine !== 'running') return 'damaged';
    if (p.armament.frac < 0.05) return 'ammo';
    if (p.fs.fuel < p.type.fuelCapacity * 0.25) return 'fuel';
    return null;
  }

  /** In real trouble: worth a Mayday. */
  private trouble(): string | null {
    const p = this.player, d = p.damage;
    if (p.status === 'wreck') return 'Going down';
    if (d.fire > 0) return 'On fire';
    if (p.fs.engine === 'dead' || p.fs.engine === 'seized') return 'Engine gone';
    if (d.glycol > 0.3) return 'Glycol leak, engine overheating';
    if (d.pilot === 'wounded') return 'Wounded';
    if (damageFraction(d) > 0.35) return 'Badly hit';
    return null;
  }

  /** Live raids the controller could put us on. */
  private liveRaids(): Raid[] {
    return this.world.raids.filter((r) => r.started && !r.turnedBack && r.phase !== 'outbound' && r.phase !== 'scattered' && r.estimatedStrength > 0);
  }

  /** What makes sense to say right now, most pressing first (at most six). */
  rtOptions(): RTOption[] {
    const p = this.player, fs = p.fs, out: RTOption[] = [];
    if ((p.status !== 'flying' && p.status !== 'wreck') || fs.onGround) return out;
    const C = this.controller, target = C.targetRaid;
    if (this.trouble() && !this.mayday) out.push({ cmd: 'rtMayday', label: 'MAYDAY' });
    const rk = this.reportKind();
    if (rk && !this.reported) out.push({ cmd: 'rtReport', label: { ammo: 'RTB: NO AMMO', damaged: 'RTB: DAMAGED', wounded: 'RTB: WOUNDED', fuel: 'RTB: FUEL' }[rk] });
    if (p.status === 'wreck') return out;
    const near = this.world.planes.some((q) => q.side !== p.side && q.alive && q.pos.distTo(p.pos) < TUNING.sortie.tallyRange);
    if (!this.engaged && near) out.push({ cmd: 'tallyHo', label: 'TALLY-HO' });
    if (!this.reported) {
      out.push({ cmd: 'rtVector', label: 'VECTOR' });
      if (this.liveRaids().some((r) => r !== target)) out.push({ cmd: 'rtNewRaid', label: 'NEW RAID' });
      if (target && !this.helpAsked.has(target.id) && target.estimatedStrength >= TUNING.sortie.helpMinStrength && (this.engaged || target.plot.distTo(p.pos) < 15000)) out.push({ cmd: 'rtHelp', label: 'SEND HELP' });
    }
    out.push({ cmd: 'rtFix', label: 'FIX' });
    if (this.homingDue < 0) out.push({ cmd: 'homing', label: 'HOMING' });
    return out.slice(0, 6);
  }

  /** Make a call on the R/T; the controller answers a few seconds later. */
  private radioCall(c: SimCmd): void {
    const p = this.player, C = this.controller, sq = this.spec.squadron, t = this.time;
    const later = (secs: number, say: () => void) => this.replies.push({ t: t + secs, say });
    const angels = sayAngels(p.pos.y * M_TO_FT);
    switch (c) {
      case 'rtVector':
        C.say(t, RT.askVector(sq, C.callsign), 'player', false);
        C.askVector(t);
        break;
      case 'rtNewRaid': {
        C.say(t, RT.askNewRaid(sq, C.callsign, angels, describePlace(this.map, p.pos.x, p.pos.z)), 'player', false);
        later(4, () => {
          const others = this.liveRaids().filter((r) => r !== C.targetRaid);
          const pool = others.some((r) => r.bombing) ? others.filter((r) => r.bombing) : others;
          const next = pool.sort((a, b) => a.plot.distTo(p.pos) - b.plot.distTo(p.pos))[0];
          if (!next) { C.say(this.time, RT.noNewRaid(sq, C.callsign), 'controller', true); return; }
          C.say(this.time, RT.newRaid(sq, C.callsign), 'controller', true);
          C.assign(next, this.time);
          // Off the old raid: re-form and follow the new vector.
          if (this.engaged) { this.engaged = false; this.giveAll('reform'); }
        });
        break;
      }
      case 'rtFix': {
        C.say(t, RT.askFix(sq, C.callsign), 'player', false);
        later(3, () => {
          const h = homingTo(this.map, p.pos, true, this.world.weather.wind);
          const f = h.field.pos, brg = (Math.atan2(f.x - p.pos.x, f.z - p.pos.z) * 180) / Math.PI;
          C.say(this.time, RT.fix(sq, C.callsign, describePlace(this.map, p.pos.x, p.pos.z), sayAngels(p.pos.y * M_TO_FT), sayHeading(brg), h.field.name, sayMiles(Math.hypot(f.x - p.pos.x, f.z - p.pos.z))), 'controller', true);
        });
        break;
      }
      case 'rtHelp': {
        const raid = C.targetRaid;
        if (!raid) break;
        this.helpAsked.add(raid.id);
        C.say(t, RT.askHelp(sq, C.callsign, sayStrength(raid.estimatedStrength)), 'player', false);
        later(5, () => this.sendHelp(raid));
        break;
      }
      case 'rtReport': {
        const kind = this.reportKind();
        if (!kind) break;
        this.reported = { kind, t };
        C.say(t, RT.report[kind](sq, C.callsign), 'player', false);
        later(3, () => { C.say(this.time, RT.reportAck(sq, C.callsign), 'controller', true); this.giveHoming(); });
        break;
      }
      case 'rtMayday': {
        const why = this.trouble();
        if (!why) break;
        const sea = this.map.surfaceAt(p.pos.x, p.pos.z) === 'sea';
        this.mayday = { t, sea };
        C.say(t, RT.mayday(sq, why, describePlace(this.map, p.pos.x, p.pos.z)), 'player', true);
        later(3, () => C.say(this.time, RT.maydayAck(sq, C.callsign, sea), 'controller', true));
        break;
      }
    }
  }

  /** Help asked for: the nearest squadron not yet in a fight is sent to our raid, or a fresh one scrambled. */
  private sendHelp(raid: Raid): void {
    const C = this.controller, sq = this.spec.squadron, S = TUNING.sky;
    const free = this.others.filter((o) => !o.real && (o.state === 'waiting' || o.state === 'forming' || o.state === 'intercept') && o.raidId !== raid.id);
    let o = free.sort((a, b) => a.plot.distTo(raid.plot) - b.plot.distTo(raid.plot))[0];
    if (o) {
      o.raidId = raid.id;
      o.spec.scrambleAt = Math.min(o.spec.scrambleAt, this.time);
    } else {
      const used = new Set(this.others.map((x) => x.spec.callsign));
      const callsign = CALLSIGNS.others.find((c) => !used.has(c) && c !== sq);
      const base = TARGETS.airfield.filter((n) => n !== this.spec.home).map((n) => this.map.airfieldByName(n)).filter((a): a is Airfield => !!a)
        .sort((a, b) => a.pos.distTo(raid.plot) - b.pos.distTo(raid.plot))[0];
      if (!callsign || !base) { C.say(this.time, RT.noHelp(sq, C.callsign), 'controller', true); return; }
      o = new OtherSquadron({ callsign, type: 'hurricane', count: 10, base: base.pos.clone(), baseName: base.name, raidId: raid.id, scrambleAt: this.time + 20, formation: this.spec.formation ?? 'vic' }, this.rng.fork(`help${callsign}`));
      o.onEvent = (e, s, r) => this.otherEvent(e, s, r);
      this.others.push(o);
    }
    const climb = Math.max(0, raid.alt - o.plot.y) / S.climbRate;
    const mins = Math.max(2, Math.round((Math.max(climb, o.plot.distTo(raid.plot) / S.cruise) + 30) / 60));
    C.say(this.time, RT.help(sq, C.callsign, o.spec.callsign, mins > 12 ? 'Bear up, it will be a while' : `About ${sayMinutes(mins)}`), 'controller', true);
  }

  /** Section callsign by place in the formation: Red 1 leads; Red, Yellow, Blue, Green sections. */
  callOf(q: Plane): string {
    const i = this.formation.indexOf(q);
    if (i <= 0) return `${this.spec.squadron} Leader`;
    const per = (this.spec.formation ?? 'vic') === 'pairs' ? 4 : 3;
    const colour = ['Red', 'Yellow', 'Blue', 'Green'][Math.floor(i / per) % 4];
    return `${colour} ${['One', 'Two', 'Three', 'Four'][i % per]}`;
  }

  /**
   * The squadron goes in without waiting for the word when it's obvious:
   * the player opens fire with the enemy about, an enemy comes close, or
   * one of the formation is hit. Leading, it's the player's tally-ho; flying
   * as a wingman, the leader's.
   */
  private goInWhenObvious(): void {
    if (this.engaged || this.airborneAt < 0) return;
    const w = this.world, me = this.player, S = TUNING.sortie;
    let near = Infinity;
    for (const q of w.planes) if (q.side !== me.side && q.alive) near = Math.min(near, q.pos.distTo(me.pos));
    const shotAt = w.events.some((e) => e.t === w.time && (e.kind === 'hit' || e.kind === 'playerHit') && this.formation.some((q) => q.id === e.planeId) && w.planes.some((q) => q.id === e.otherId && q.side !== me.side));
    const obvious = (me.firing && near < S.tallyRange) || near < S.autoTallyRange || shotAt;
    if (!obvious) return;
    const L = this.leader;
    if (this.spec.leading || L === me || !L.alive) this.tallyHo();
    else this.autoTally(L);
  }

  /** The squadron's R/T: sightings, break calls, kills and losses. */
  private radio(): void {
    const w = this.world, me = this.player, t = this.time, S = TUNING.sortie;
    const mine = (id: number | undefined) => this.formation.find((q) => q.id === id && q !== me);
    for (const e of w.events) {
      if (this.heard.has(e)) continue;
      this.heard.add(e);
      if (e.kind === 'shotDown') {
        const victim = w.planes.find((q) => q.id === e.planeId);
        const killer = mine(e.otherId);
        if (killer && victim && victim.side !== me.side) this.controller.say(t, RT.kill(this.callOf(killer), victim.type.short), 'squadron', false);
        const lost = mine(e.planeId);
        if (lost) this.controller.say(t, RT.hit(this.callOf(lost)), 'squadron', true);
      }
      if (e.kind === 'bail') {
        const q = mine(e.planeId);
        if (q) this.controller.say(t, RT.bailing(this.callOf(q)), 'squadron', true);
      }
      // One of us in the sea: whoever is nearest calls air-sea rescue.
      const inSea = e.kind === 'ditched' || (e.kind === 'chuteLanded' && w.parachutes.some((c) => c.fromPlane === e.planeId && c.landed && c.overSea));
      const victim = this.formation.find((q) => q.id === e.planeId);
      if (inSea && victim && e.pos && !this.asrAlerted.has(victim.id) && !(victim === me && this.mayday)) {
        const caller = this.formation.filter((q) => q !== victim && q.alive && !q.fs.onGround && q.pos.distTo(e.pos!) < 15000)
          .sort((a, b) => a.pos.distTo(e.pos!) - b.pos.distTo(e.pos!))[0];
        if (caller) {
          this.asrAlerted.add(victim.id);
          this.controller.say(t, RT.asr(this.callOf(caller), this.callOf(victim), describePlace(this.map, e.pos.x, e.pos.z)), 'squadron', true);
          this.replies.push({ t: t + 3, say: () => this.controller.say(this.time, RT.asrAck(this.controller.callsign), 'controller', false) });
        }
      }
    }
    if (w.tick % 25 !== 0 || me.status !== 'flying') return;
    // A free hunt near us that nobody has seen: the controller has it on the plot.
    for (const r of w.raids) {
      if (r.bombing || !r.started || this.huntWarned.has(r.id) || r === this.controller.targetRaid) continue;
      if (r.plot.distTo(me.pos) > S.huntWarnRange) continue;
      this.huntWarned.add(r.id);
      this.controller.say(t, RT.huntWarning(this.spec.squadron, this.controller.callsign, describePlace(this.map, r.plot.x, r.plot.z), sayAngels((r.alt + r.heightError) * M_TO_FT)), 'controller', true);
    }
    const others = this.formation.filter((q) => q !== me && q.alive && q.status === 'flying');
    const clockOn = (q: Plane) => {
      const rel = q.pos.clone().sub(me.pos);
      return { clock: clockOf(((Math.atan2(rel.x, rel.z) - me.fs.heading) * 180) / Math.PI), rel: rel.y > 300 ? 'above' : rel.y < -300 ? 'below' : 'level', local: me.fs.q.unrotate(rel) };
    };
    // Someone on the player's tail: the nearest wingman shouts.
    if (t - this.lastBreakCall > S.breakCallEvery && others.length) {
      for (const q of w.planes) {
        if (q.side === me.side || !q.alive || q.type.role === 'bomber' || q.type.role === 'diveBomber') continue;
        const g = threatGeometry(q, me);
        if (g.range > S.breakCallRange || g.offTail > 0.7 || g.aimErr > 0.35) continue;
        const caller = others.reduce((a, b) => (a.pos.distTo(me.pos) < b.pos.distTo(me.pos) ? a : b));
        if (caller.pos.distTo(me.pos) > 4000) break;
        this.lastBreakCall = t;
        this.controller.say(t, `${this.callOf(caller)}: ${RT.breakCall(this.spec.leading ? `${this.spec.squadron} Leader` : this.callOf(me), clockOn(q).local.x >= 0 ? 'right' : 'left')}`, 'squadron', true);
        break;
      }
    }
    // Before the fight: a wingman sees them first.
    if (!this.engaged && t - this.lastSightingCall > 60) {
      for (const q of others) {
        const b = q.brain;
        if (!(b instanceof WingmanBrain)) continue;
        const id = b.fighter.contacts.ids().find((id) => w.planes.some((p) => p.id === id && p.alive && p.pos.distTo(me.pos) < S.tallyRange));
        if (id === undefined) continue;
        const e = w.planes.find((p) => p.id === id)!;
        const c = clockOn(e);
        this.lastSightingCall = t;
        this.controller.say(t, `${this.callOf(q)}: ${RT.hostileNear(c.clock, c.rel)}`, 'squadron', true);
        break;
      }
    }
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
      // Free hunts and sweeps carry no bombs: just say they were about.
      if (!r.bombing) {
        const met = r.planes.some((q) => q.status !== 'flying' || this.formation.some((f) => q.damage.by[f.id]));
        raidNotes.push(`109s were hunting over ${r.spec.targetName}${met ? ', and the squadron tangled with them' : ''}.`);
        continue;
      }
      kg += r.bombsOnTarget;
      const helped = this.others.filter((o) => o.fought.has(r.id)).map((o) => o.spec.callsign);
      const lost = r.lostUnseen + r.bombers.filter((b) => b.status !== 'flying' && b.status !== 'landed').length;
      if (helped.length) raidNotes.push(`${helped.join(' and ')} squadron${helped.length > 1 ? 's' : ''} also engaged the raid on ${r.spec.targetName}${lost ? `; ${lost} of its bombers were lost` : ''}.`);
      // Your part in it: what you shot down, and why you broke off if you said.
      const mineDown = r.planes.filter((q) => q.killedBy === p.id && q.status !== 'flying').length;
      const yours = r.planes.some((q) => q.damage.by[p.id]) || (!w.raids.some((x) => x.planes.some((q) => q.damage.by[p.id])) && r === this.controller.targetRaid);
      const tally = mineDown ? `having shot down ${mineDown} of it` : '';
      const why = this.reported && yours ? `You broke off ${REPORT_WORDS[this.reported.kind]}${tally ? `, ${tally}` : ''}` : tally ? `You were in at it, ${tally}` : '';
      if (r.turnedBack || (r.bombsDropped === 0 && r.phase !== 'bombRun' && r.phase !== 'inbound')) { turned++; raidNotes.push(`The raid on ${r.spec.targetName} was turned back before it bombed.${tally ? ` You accounted for ${mineDown} of it.` : ''}`); }
      else if (r.bombsDropped > 0) { bombed++; raidNotes.push(`${why ? `${why}; the raid went on to ${r.spec.targetName}. ` : `The raid reached ${r.spec.targetName}. `}${r.bombsOnTarget > 0 ? 'Bombs fell on the target.' : 'The bombing was scattered.'}`); }
      else raidNotes.push(why ? `${why}; the raid was still heading for ${r.spec.targetName}.` : `The raid on ${r.spec.targetName} was still on its way when you left it.`);
    }
    // What you said on the R/T that mattered.
    const rtNotes: string[] = [];
    const at = (t: number) => `${Math.max(1, Math.round((t - Math.max(0, this.airborneAt)) / 60))} minutes up`;
    if (this.reported) rtNotes.push(`Reported ${REPORT_WORDS[this.reported.kind]} at ${at(this.reported.t)} and came home.`);
    if (this.mayday) rtNotes.push(`Sent a Mayday${this.mayday.sea ? '; air-sea rescue was alerted' : ''}.`);
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
        if (chute.overSea && !this.rescued(chute.pos, this.asrAlerted.has(q.id))) losses.push({ name, line: LOSS_LINES.lostSea(name, place), lost: true });
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
      takeoffDelay: this.spec.start === 'readiness' && this.airborneAt >= 0 ? Math.round(this.airborneAt) : -1,
      claims,
      roundsFired: p.armament.fired,
      damageTaken: damageFraction(p.damage),
      damageNotes: dmgNotes,
      outcome,
      raidNotes,
      rtNotes,
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

  /** Down in a field with nothing wrong: sound aircraft, fuel in the tank, pilot unhurt. */
  private needlessLanding(): boolean {
    const p = this.player;
    const r = p.landing.result;
    return (!r || r.aircraft === 'fine') && (r?.pilot ?? 'fine') === 'fine' && damageFraction(p.damage) < 0.05
      && p.damage.pilot !== 'wounded' && p.damage.fire <= 0 && p.damage.glycol <= 0 && p.damage.oil <= 0.3
      && p.fs.engine !== 'seized' && p.fs.engine !== 'dead' && p.fs.fuel > p.type.fuelCapacity * TUNING.sortie.writeUpFuel;
  }

  private rescued(pos: Vec3, alerted = false): boolean {
    const d = distanceToEnglishCoast(this.map, pos.x, pos.z);
    let p = d < 5000 ? 0.85 : d < 15000 ? 0.6 : d < 25000 ? 0.3 : 0.12;
    // Called in on the R/T: the launches know where to look.
    if (alerted) p = Math.min(0.95, p + TUNING.sortie.asrBonus);
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
        if (this.rescued(chute.pos, !!this.mayday || this.asrAlerted.has(p.id))) return { kind: 'bailSea', pilot: 'shaken', aircraft: 'writeOff', place: pl, line: LANDING_LINES.bailSeaRescued(pl, '', cause) };
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
      if (this.rescued(p.pos, !!this.mayday || this.asrAlerted.has(p.id))) return { kind: 'ditched', pilot: r?.pilot ?? 'shaken', aircraft: 'writeOff', place: pl, line: LANDING_LINES.ditched(pl, '', cause) };
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
    if (isFrance(p.pos.x, p.pos.z)) return { kind: 'pow', pilot: 'lost', aircraft: 'writeOff', place: pl, line: 'Came down in France. Taken prisoner.' };
    if (!onAirfield) {
      const out: PilotOutcome = { kind: 'forced', pilot, aircraft, place: pl, line: LANDING_LINES.forced(pl, surfName, cause) };
      if (this.needlessLanding()) out.writtenUp = WRITE_UP.raf(p.type.name);
      return out;
    }
    const ln = LANDING_LINES[kind] ?? LANDING_LINES.roll;
    return { kind: 'landed', pilot, aircraft, place: pl, line: ln(pl, surfName, cause) };
  }
}

/** Day of the campaign as 0..1 for crop colours (early July → end of October). */
/** "five minutes" */
export function sayMinutes(n: number): string {
  const w = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  return `${w[n] ?? String(n)} minute${n === 1 ? '' : 's'}`;
}

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
  // Each raid has its own target, where there's a choice.
  const used = new Set<string>();
  const fresh = <T>(list: T[], name: (t: T) => string): T => rng.pick(list.filter((t) => !used.has(name(t))).length ? list.filter((t) => !used.has(name(t))) : list);
  for (let n = 0; n < count; n++) {
    const tpls = RAID_TEMPLATES[phase];
    const total = tpls.reduce((a, t) => a + t.weight, 0);
    let r = rng.next() * total, i = 0;
    while (r > tpls[i].weight) r -= tpls[i++].weight;
    const t = tpls[i];
    let targetName: string, target: Vec3;
    if (t.kind === 'airfield') {
      const names = underAttack && n === 0 ? [home.name] : TARGETS.airfield;
      const af = map.airfieldByName(fresh(names, (s) => s)) ?? home;
      targetName = af.name;
      target = af.pos.clone();
    } else {
      const list = TARGETS[t.kind];
      const pick = fresh(list, (x) => x.name);
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
    used.add(targetName);
    out.push({ name: `raid${n + 1}`, kind: t.kind, targetName, target, start, entry, alt, speed: t.speed, groups, delay });
  }
  return out;
}

/**
 * The day's trade for one sortie: one to three raids, later ones starting a
 * few minutes apart and going for different targets, and now and then a
 * free hunt of 109s roving over Kent on their own. `atLeast` raises the
 * count (15 September).
 */
export function planRaids(rng: Rng, phase: Phase, home: Airfield, map: WorldMap, underAttack: boolean, atLeast = 1): RaidSpec[] {
  const S = TUNING.sky;
  const w = S.raidCount[phase];
  let r = rng.next() * w.reduce((a, b) => a + b, 0), count = 1;
  while (count < w.length && r > w[count - 1]) r -= w[count++ - 1];
  const raids = generateRaids(rng, phase, home, map, underAttack, Math.max(count, atLeast));
  // Staggered: each later raid a few minutes after the one before.
  for (let i = 1; i < raids.length; i++) raids[i].delay = raids[i - 1].delay + rng.range(S.raidGap[0], S.raidGap[1]);
  if (rng.chance(S.freeHuntChance[phase])) {
    const pick = rng.pick(TARGETS.sweep);
    const [x, z] = lonLatToXZ(pick.lat, pick.lon);
    const asm = rng.pick(ASSEMBLY);
    const [sx, sz] = lonLatToXZ(asm.lat, asm.lon);
    const start = new Vec3(sx, 0, sz), target = new Vec3(x, 0, z);
    raids.push({
      name: 'freehunt', kind: 'sweep', targetName: pick.name, target, start, entry: start.clone().lerp(target, 0.45),
      alt: rng.range(6500, 8000), speed: 120, delay: rng.range(60, 600),
      groups: [{ type: 'bf109', count: 4 + rng.int(5), role: 'sweep', altOffset: 0, skill: rng.chance(0.6) ? 'experte' : 'average' }],
    });
  }
  return raids;
}
