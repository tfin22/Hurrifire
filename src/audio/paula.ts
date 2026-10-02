// Paula, more or less: four channels of 8-bit samples played at varying
// rates, hard-ish stereo (channels 0 and 3 left, 1 and 2 right), and the
// Amiga's low-pass "LED" filter on the output. In flight the channels are:
//
//   0  engine (loop, pitch follows rpm)
//   1  guns (loop while firing); otherwise one-shots
//   2  one-shots: hits, cough, explosions, pump, R/T
//   3  wind or stall buffet (loop); high-priority one-shots may steal it
//
// In the menus all four play music. Sound effects go to whichever channel
// is free or playing something less important, as on the real thing.

import { buildSamples, Sample } from './synth';
import { compileSong, NoteEvent, Song } from './tracker';

const PAN = [-0.6, 0.6, 0.6, -0.6];

/** The rpm each engine loop was built at (it plays at rate 1 there). */
const ENGINE_RPM: Record<string, number> = { merlin: 2600, db601: 2400, radial: 2600 };

/** Effect priorities: a more important sound steals a channel from a lesser one. */
const PRIORITY: Record<string, number> = {
  explode: 6, clang: 5, cough: 4, cannon: 4, thud: 3, enemyFire: 3, starter: 4, rt: 2, pump: 1, click: 1, bell: 5, phone: 5, thump: 3,
};

interface Layer { src: AudioBufferSourceNode; gain: GainNode }

interface Channel {
  gain: GainNode;
  src: AudioBufferSourceNode | null;
  /** Looped samples mixed on this channel (the engine's power and overrun, wind and a bomber's drone). */
  layers: Map<string, Layer>;
  kind: 'loop' | 'shot' | 'music' | null;
  name: string;
  prio: number;
  endsAt: number;
}

export interface FlightSound {
  engine: 'merlin' | 'db601' | 'radial' | null;
  /** Crank rpm: the engine samples are pitched from it. */
  rpm: number;
  throttle: number;
  /** 0 = all overrun burble (throttle closed, or coughing) … 1 = all power. */
  power: number;
  /** A German bomber's drone nearby, 0..1. */
  drone: number;
  guns: 0 | 4 | 8;
  /** Airspeed (m/s), for the wind. */
  speed: number;
  /** Stall buffet 0..1. */
  buffet: number;
  /** Inside the cockpit (muffled) or outside. */
  inside: boolean;
}

export class Paula {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private samples: Record<string, Sample> = {};
  private ch: Channel[] = [];
  volume = 0.8;
  musicOn = true;
  private song: Song | null = null;
  private songEvents: NoteEvent[][] = [];
  private songSteps = 0;
  private songStart = 0;
  private songPass = 0;
  private nextIdx: number[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private flightState: FlightSound | null = null;

  /** Needs a user gesture on most browsers. Safe to call repeatedly. */
  start(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.samples = buildSamples();
    for (const [k, s] of Object.entries(this.samples)) {
      const b = ctx.createBuffer(1, s.data.length, s.rate);
      b.copyToChannel(s.data as Float32Array<ArrayBuffer>, 0);
      this.buffers.set(k, b);
    }
    // The LED filter.
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 4400;
    filter.Q.value = 0.5;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(filter);
    filter.connect(ctx.destination);
    for (let i = 0; i < 4; i++) {
      const gain = ctx.createGain();
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (pan) { pan.pan.value = PAN[i]; gain.connect(pan); pan.connect(this.master); } else gain.connect(this.master);
      this.ch.push({ gain, src: null, layers: new Map(), kind: null, name: '', prio: 0, endsAt: 0 });
    }
    this.timer = setInterval(() => this.pump(), 40);
    if (this.song) this.startSong(this.song);
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  private stopSrc(c: Channel, at?: number): void {
    if (c.src) { try { c.src.stop(at ?? 0); } catch { /* already stopped */ } }
    for (const l of c.layers.values()) { try { l.src.stop(at ?? 0); } catch { /* already stopped */ } }
    c.layers.clear();
    c.src = null;
    c.kind = null;
    c.prio = 0;
  }

  private srcFor(name: string, rate: number): AudioBufferSourceNode | null {
    const ctx = this.ctx;
    const b = this.buffers.get(name);
    if (!ctx || !b) return null;
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.loop = this.samples[name].loop;
    s.playbackRate.value = rate;
    return s;
  }

  // ------------------------------------------------------------ effects

  /** A one-shot effect on the best channel for it. */
  play(name: string, vol = 1, pitch = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.buffers.has(name)) return;
    const now = ctx.currentTime;
    const prio = PRIORITY[name] ?? 2;
    // Music has the channels in the menus, but the bell and the phone cut through.
    const candidates = this.song ? [3, 2] : [2, 1, 3];
    let pick = -1;
    for (const i of candidates) {
      const c = this.ch[i];
      const free = !c.src || (c.kind === 'shot' && c.endsAt <= now);
      if (free) { pick = i; break; }
    }
    if (pick < 0) {
      for (const i of candidates) {
        const c = this.ch[i];
        const p = c.kind === 'loop' ? (i === 1 ? 3 : 1) : c.kind === 'music' ? 2 : c.prio;
        if (p < prio || (c.kind === 'shot' && p === prio)) { pick = i; break; }
      }
    }
    if (pick < 0) return;
    const c = this.ch[pick];
    this.stopSrc(c);
    const s = this.srcFor(name, pitch);
    if (!s) return;
    const g = ctx.createGain();
    g.gain.value = vol;
    s.connect(g);
    g.connect(c.gain);
    c.gain.gain.setValueAtTime(1, now);
    s.start(now);
    c.src = s;
    c.kind = 'shot';
    c.name = name;
    c.prio = prio;
    c.endsAt = now + s.buffer!.duration / pitch;
  }

  /** Continuous flight sound; null outside the cockpit screens. */
  flight(st: FlightSound | null): void {
    this.flightState = st;
    if (!this.ctx) return;
    if (st && this.song) this.music(null);
    this.updateFlight();
  }

  /** Loop `name` on channel i at this rate and level, alongside the channel's other loops. */
  private loopOn(i: number, name: string, rate: number, vol: number): void {
    const ctx = this.ctx!;
    const c = this.ch[i];
    const now = ctx.currentTime;
    if (c.kind === 'shot' && c.endsAt > now) return; // a one-shot has it for now
    if (c.kind !== 'loop') { this.stopSrc(c); c.kind = 'loop'; c.gain.gain.setValueAtTime(1, now); }
    let l = c.layers.get(name);
    if (!l) {
      const src = this.srcFor(name, rate);
      if (!src) return;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      src.connect(gain);
      gain.connect(c.gain);
      src.start(now);
      c.layers.set(name, (l = { src, gain }));
      c.name = name;
    }
    l.src.playbackRate.setTargetAtTime(rate, now, 0.05);
    l.gain.gain.setTargetAtTime(vol, now, 0.04);
  }

  /** Fade out and stop channel i's loops, except those named. */
  private loopsOnly(i: number, keep: string[] = []): void {
    const c = this.ch[i];
    if (c.kind !== 'loop' || !this.ctx) return;
    const now = this.ctx.currentTime;
    for (const [name, l] of c.layers) {
      if (keep.includes(name)) continue;
      l.gain.gain.setTargetAtTime(0, now, 0.03);
      try { l.src.stop(now + 0.15); } catch { /* already stopped */ }
      c.layers.delete(name);
    }
    if (!c.layers.size) { c.kind = null; c.prio = 0; }
  }

  private updateFlight(): void {
    const st = this.flightState;
    if (!st) { for (let i = 0; i < 4; i++) this.loopsOnly(i); return; }
    const muff = st.inside ? 1 : 0.6;
    // Engine: the power loop and the overrun loop, cross-faded on the throttle,
    // both pitched from the rpm the samples were built at.
    if (st.engine && st.rpm > 120) {
      const ref = ENGINE_RPM[st.engine];
      const rate = Math.max(0.18, Math.min(1.35, st.rpm / ref));
      const vol = (0.3 + 0.4 * st.throttle + 0.15 * Math.min(1, st.rpm / ref)) * muff;
      const idle = `${st.engine}Idle`;
      const hasIdle = this.buffers.has(idle);
      this.loopOn(0, st.engine, rate, vol * (hasIdle ? st.power : 1));
      if (hasIdle) this.loopOn(0, idle, rate, vol * (1 - st.power) * 1.1);
      this.loopsOnly(0, hasIdle ? [st.engine, idle] : [st.engine]);
    } else this.loopsOnly(0);
    if (st.guns) { const g = st.guns === 8 ? 'browning8' : 'browning4'; this.loopOn(1, g, 1, 0.8); this.loopsOnly(1, [g]); }
    else this.loopsOnly(1);
    // Wind or buffet, and the drone of a bomber close by.
    const keep: string[] = [];
    if (st.buffet > 0.2) { this.loopOn(3, 'buffet', 0.8 + st.buffet * 0.4, 0.3 + st.buffet * 0.5); keep.push('buffet'); }
    else if (st.speed > 15) { this.loopOn(3, 'wind', 0.5 + Math.min(1.5, st.speed / 120), Math.min(0.5, (st.speed / 200) ** 2) * (st.inside ? 0.6 : 1)); keep.push('wind'); }
    if (st.drone > 0.02) { this.loopOn(3, 'drone', 1, st.drone * 0.7 * muff); keep.push('drone'); }
    this.loopsOnly(3, keep);
  }

  // ------------------------------------------------------------ music

  /** Play a song (or stop with null). The same song carries on. */
  music(song: Song | null): void {
    if (song === this.song) return;
    this.song = song;
    if (!this.ctx) return;
    for (const c of this.ch) if (c.kind === 'music') { c.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2); this.stopSrc(c, this.ctx.currentTime + 0.8); }
    if (song && this.musicOn) this.startSong(song);
  }

  setMusicOn(on: boolean, current: Song | null): void {
    this.musicOn = on;
    const s = this.song;
    this.song = null;
    this.music(on ? (current ?? s) : null);
    if (!on) this.song = null;
  }

  private startSong(song: Song): void {
    const c = compileSong(song);
    this.songEvents = c.channels;
    this.songSteps = c.steps;
    this.songStart = this.ctx!.currentTime + 0.1;
    this.songPass = 0;
    this.nextIdx = song.channels.map(() => 0);
    song.channels.forEach((_, i) => { this.stopSrc(this.ch[i]); this.ch[i].kind = 'music'; this.ch[i].gain.gain.setValueAtTime(1, this.ctx!.currentTime); });
  }

  /** Schedule the next fifth of a second of music (and refresh flight loops). */
  private pump(): void {
    const ctx = this.ctx;
    const song = this.song;
    if (!ctx || !song || !this.musicOn) return;
    const stepDur = 60 / song.bpm / 4;
    const horizon = ctx.currentTime + 0.25;
    for (let ch = 0; ch < this.songEvents.length; ch++) {
      const evs = this.songEvents[ch];
      for (;;) {
        if (this.nextIdx[ch] >= evs.length) {
          if (!song.loop) break;
          // All channels wrap together at the end of the order list.
          if (this.nextIdx.every((n, k) => n >= this.songEvents[k].length)) {
            this.songPass++;
            this.nextIdx.fill(0);
            continue;
          }
          break;
        }
        const e = evs[this.nextIdx[ch]];
        const t = this.songStart + (this.songPass * this.songSteps + e.step) * stepDur;
        if (t > horizon) break;
        this.nextIdx[ch]++;
        if (t < ctx.currentTime - 0.05) continue;
        this.note(ch, e, t, e.len * stepDur);
      }
    }
  }

  private note(ch: number, e: NoteEvent, t: number, dur: number): void {
    const ctx = this.ctx!;
    const c = this.ch[ch];
    if (c.kind !== 'music') return;
    const smp = this.samples[e.instr];
    if (!smp) return;
    const rate = e.hz && smp.baseHz ? e.hz / smp.baseHz : 1;
    const s = this.srcFor(e.instr, rate);
    if (!s) return;
    const g = ctx.createGain();
    const v = e.vol;
    // One voice per channel: the new note cuts the old one.
    if (c.src) { try { c.src.stop(t); } catch { /* fine */ } }
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + 0.008);
    s.connect(g);
    g.connect(c.gain);
    s.start(t);
    if (smp.loop) {
      const off = t + dur * 0.92;
      g.gain.setValueAtTime(v, Math.max(t + 0.01, off - 0.05));
      g.gain.linearRampToValueAtTime(0, off);
      s.stop(off + 0.01);
    }
    c.src = s;
  }

  stopAll(): void {
    if (this.timer) clearInterval(this.timer);
    for (const c of this.ch) this.stopSrc(c);
  }
}
