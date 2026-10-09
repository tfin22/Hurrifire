// Other squadrons. Yours is never the only one up: the controllers send a
// squadron or two from other sectors against each raid, and in September
// 12 Group's big wing comes down from Duxford. Out of sight, a squadron is
// a plot like a raid: it scrambles, climbs, flies an intercept, and fights
// the raid in rounds (a bomber down here, the raid broken up there, one of
// ours lost). Near you, or near a raid that's in sight, it becomes real
// aircraft that fly and fight like everyone else. Its job done, it goes
// home, and once well out of sight it's put down at its base.

import { Vec3 } from '../core/math';
import { Rng } from '../core/rng';
import type { AircraftId } from '../content/aircraft';
import { TUNING } from '../tuning';
import { FighterBrain } from './ai/fighter';
import { skillFor, SkillLevel } from './ai/types';
import { interceptVector } from './controller';
import type { Plane } from './plane';
import type { Raid } from './raid';
import type { World } from './world';

export interface OtherSquadronSpec {
  /** R/T callsign ("Tiger"). */
  callsign: string;
  type: AircraftId;
  count: number;
  /** Where it takes off from, and its name. */
  base: Vec3;
  baseName: string;
  /** The raid it's sent after (raid id). */
  raidId: number;
  /** Seconds into the sortie it takes off. */
  scrambleAt: number;
  /** 12 Group: circles to form up as a wing before setting off, and comes in higher. */
  bigWing?: boolean;
  /** Offset within a big wing, so its squadrons don't fly through each other (m). */
  offset?: Vec3;
  formation: 'vic' | 'pairs';
}

export type OtherState = 'waiting' | 'forming' | 'intercept' | 'fighting' | 'home' | 'down';

export type OtherEvent = 'airborne' | 'engaging' | 'tallyHo' | 'home';

export class OtherSquadron {
  readonly plot = new Vec3();
  readonly vel = new Vec3();
  state: OtherState = 'waiting';
  /** Real aircraft, once it's been in sight. */
  planes: Plane[] = [];
  /** Bombers it shot down out of sight, and aircraft it lost out of sight. */
  unseenKills = 0;
  unseenLosses = 0;
  /** Raids it fought (ids). */
  readonly fought = new Set<number>();
  raidId: number;
  private rounds = 0;
  private nextRound = 0;
  private talliedHo = false;
  onEvent: ((e: OtherEvent, sq: OtherSquadron, raid: Raid | null) => void) | null = null;

  constructor(readonly spec: OtherSquadronSpec, private rng: Rng) {
    this.plot.copy(spec.base);
    this.raidId = spec.raidId;
  }

  get real(): boolean {
    return this.planes.length > 0;
  }

  /** How many it has in the air. */
  get strength(): number {
    return this.real ? this.planes.filter((p) => p.alive).length : this.spec.count - this.unseenLosses;
  }

  /** Bombers it shot down, seen and unseen. */
  kills(w: World): number {
    const ids = new Set(this.planes.map((p) => p.id));
    return this.unseenKills + w.planes.filter((q) => q.side === 'lw' && q.status !== 'flying' && ids.has(q.killedBy)).length;
  }

  private raid(w: World): Raid | null {
    return w.raids.find((r) => r.id === this.raidId) ?? null;
  }

  private static live(r: Raid | null): r is Raid {
    return !!r && r.started && !r.turnedBack && r.phase !== 'outbound' && r.phase !== 'scattered' && (r.spawned ? r.planes.some((p) => p.alive) : r.bombersLeft > 0 || !r.bombing);
  }

  step(dt: number, w: World, player: Plane, time: number): void {
    const S = TUNING.sky;
    if (this.state === 'down') return;
    if (this.real) { this.stepReal(w, player); return; }
    let raid = this.raid(w);
    if (!OtherSquadron.live(raid) && this.state !== 'waiting' && this.state !== 'home') {
      // Their raid is over: the controller sends them after another, or home.
      const next = w.raids.filter((r) => OtherSquadron.live(r) && r.bombing).sort((a, b) => a.plot.distTo(this.plot) - b.plot.distTo(this.plot))[0];
      if (next && this.rounds < S.fightRounds / 2) { this.raidId = next.id; raid = next; this.state = 'intercept'; }
      else { this.state = 'home'; this.onEvent?.('home', this, raid); }
    }
    switch (this.state) {
      case 'waiting':
        if (time < this.spec.scrambleAt) return;
        this.state = this.spec.bigWing ? 'forming' : 'intercept';
        this.nextRound = time + (this.spec.bigWing ? 360 : 0);
        this.onEvent?.('airborne', this, raid);
        break;
      case 'forming':
        // The wing circles over Duxford, climbing, until it's together.
        this.climb(dt, raid);
        if (time >= this.nextRound) this.state = 'intercept';
        break;
      case 'intercept': {
        this.climb(dt, raid);
        if (!raid) break;
        const v = interceptVector(this.plot, S.cruise, raid.plot, raid.vel);
        this.move(dt, v.point, S.cruise);
        const close = Math.hypot(raid.plot.x - this.plot.x, raid.plot.z - this.plot.z) < 3000;
        if (close && this.plot.y > raid.alt - 1500 && !raid.spawned) {
          this.state = 'fighting';
          this.nextRound = time + S.fightRound;
          this.fought.add(raid.id);
          this.onEvent?.('engaging', this, raid);
        }
        break;
      }
      case 'fighting': {
        if (!raid) break;
        this.plot.copy(raid.plot).add(this.spec.offset ?? new Vec3());
        this.plot.y = raid.alt + 300;
        if (time < this.nextRound) break;
        this.nextRound = time + S.fightRound;
        this.rounds++;
        // A round of the fight nobody saw.
        if (this.rng.chance(S.roundKill) && raid.loseUnseen()) this.unseenKills++;
        if (this.rng.chance(S.roundLoss) && this.strength > 1) this.unseenLosses++;
        if (raid.bombing && (this.rng.chance(S.roundTurnBack) || raid.bombersLeft <= raid.bombersAtStart * 0.4)) raid.turnBack();
        if (this.rounds >= S.fightRounds) { this.state = 'home'; this.onEvent?.('home', this, raid); }
        break;
      }
      case 'home': {
        const b = this.spec.base;
        this.move(dt, new Vec3(b.x, this.plot.y, b.z), S.cruise);
        this.plot.y = Math.max(b.y, this.plot.y - S.climbRate * dt);
        if (Math.hypot(b.x - this.plot.x, b.z - this.plot.z) < 2000) this.state = 'down';
        break;
      }
    }
    // In sight of you, or of a raid that's real: it becomes real too.
    if (this.state === 'down' || this.state === 'forming') return;
    const nearYou = this.plot.distTo(player.pos) < S.friendSpawnRange;
    const nearRaid = w.raids.some((r) => r.spawned && r.plot.distTo(this.plot) < 8000);
    if (nearYou || nearRaid) this.spawn(w, raid);
  }

  private climb(dt: number, raid: Raid | null): void {
    const want = (raid?.alt ?? 5000) + (this.spec.bigWing ? 1500 : 300);
    this.plot.y = Math.min(want, this.plot.y + TUNING.sky.climbRate * dt);
  }

  private move(dt: number, to: Vec3, speed: number): void {
    const dx = to.x - this.plot.x, dz = to.z - this.plot.z, l = Math.hypot(dx, dz);
    if (l < 1) return;
    this.vel.set((dx / l) * speed, 0, (dz / l) * speed);
    this.plot.x += this.vel.x * dt;
    this.plot.z += this.vel.z * dt;
  }

  /** Real aircraft, in formation round the plot, flying where the plot was going. */
  private spawn(w: World, raid: Raid | null): void {
    const n = this.strength;
    const hdg = Math.atan2(this.vel.x || 0.0001, this.vel.z || 1);
    const fx = Math.sin(hdg), fz = Math.cos(hdg), rx = Math.cos(hdg), rz = -Math.sin(hdg);
    const slots = squadronSlots(n, this.spec.formation);
    const skills: SkillLevel[] = ['green', 'average', 'average', 'average', 'experte'];
    let leader: Plane | null = null;
    for (let i = 0; i < n; i++) {
      const s = slots[i];
      const p = w.addPlane(this.spec.type, 'raf', `${this.spec.callsign} ${i + 1}`, this.state === 'home' ? 0.35 : 0.7);
      p.skill = skillFor(i === 0 ? 'experte' : this.rng.pick(skills));
      p.unit = this.spec.callsign;
      p.home = this.spec.base.clone().add(new Vec3(0, 800, 0));
      const x = this.plot.x + rx * s.x + fx * s.z, z = this.plot.z + rz * s.x + fz * s.z;
      // Seen just after take-off, they're climbing out: never in the ground.
      p.fs.setAirborne(new Vec3(x, Math.max(this.plot.y + s.y, w.aiContext.groundAt(x, z) + 300), z), hdg, 110);
      const goal = this.state === 'home' ? p.home.clone() : this.goal(raid);
      p.brain = i === 0 || !leader
        ? new FighterBrain({ waypoint: goal, preferBombers: true })
        : new FighterBrain({ leader, slot: s, preferBombers: true, waypoint: goal });
      if (i === 0) leader = p;
      this.planes.push(p);
    }
  }

  private goal(raid: Raid | null): Vec3 {
    return raid ? raid.plot.clone().add(new Vec3(0, 300, 0)) : this.spec.base.clone().add(new Vec3(0, 800, 0));
  }

  /** Real: steer the leader at the raid, call tally-ho, and put them down at base once they've gone home out of sight. */
  private stepReal(w: World, player: Plane): void {
    if (w.tick % 25 !== 0) return;
    const raid = this.raid(w);
    const live = OtherSquadron.live(raid);
    for (const p of this.planes) {
      const b = p.brain;
      if (!(b instanceof FighterBrain) || !p.alive) continue;
      b.opts.waypoint = live ? this.goal(raid) : p.home!.clone();
      if (!live && (b.state === 'patrol' || b.state === 'formation')) { b.state = 'rtb'; b.opts.leader = undefined; }
      if (!this.talliedHo && b.state === 'attack') {
        this.talliedHo = true;
        if (raid) this.fought.add(raid.id);
        this.onEvent?.('tallyHo', this, raid);
      }
      // Gone home, and nobody can see: down at base.
      if ((b.state === 'rtb' || !live) && p.pos.distTo(player.pos) > TUNING.sky.retireRange) {
        p.fs.setOnGround(this.spec.base.clone().add(new Vec3(0, p.type.gearHeight, 0)), 0);
        p.status = 'landed';
      }
    }
    if (this.planes.every((p) => !p.alive)) this.state = 'down';
  }
}

/** Formation slots for another squadron: vics, or pairs in sections of four. Body-frame offsets (m). */
export function squadronSlots(n: number, style: 'vic' | 'pairs'): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const per = style === 'pairs' ? 4 : 3;
    const section = Math.floor(i / per), k = i % per;
    const side = section % 2 ? 1 : -1;
    const sx = side * Math.ceil(section / 2) * (style === 'pairs' ? 250 : 100);
    const kx = [0, -35, 35, 70][k], kz = [0, -30, -30, -60][k];
    out.push(new Vec3(sx + kx, -8 * section, -70 * section + kz));
  }
  return out;
}
