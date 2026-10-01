// The in-flight screen: cockpit and external views, controls → simulation,
// G and buffet effects, time compression, the HUD and debug readouts.

import type { App, Screen } from '../app';
import { clamp, DEG, MPS_TO_MPH, M_TO_FT, Quat, Vec3 } from '../core/math';
import { Rng } from '../core/rng';
import { ContextButton } from '../input/devices';
import { ControlFrame, quantiseControls } from '../input/input';
import { Camera } from '../render/camera';
import { cockpitLayout, CockpitLayout, drawCanopyFrame, drawGunsight, drawOilScreen, drawPanel, drawRearFrame, viewMessage } from '../render/cockpit';
import { noEffects, ScreenEffects } from '../render/display';
import { drawText } from '../render/font';
import { FrameBuffer } from '../render/framebuffer';
import { C } from '../render/palette';
import { fillRect, rasterStats } from '../render/raster';
import { SceneRenderer } from '../render/scene';
import { TerrainSource } from '../render/terrain';
import { Plane } from '../sim/plane';
import { World } from '../sim/world';
import { TUNING } from '../tuning';

export type ViewMode = 'cockpit' | 'padlock' | 'chase' | 'flyby';

export interface FlightScreenOpts {
  world: World;
  terrain: TerrainSource;
  onExit: () => void;
}

const GALLON_KG = 3.27;

export class FlightScreen implements Screen {
  touchMode: 'flight' | 'menu' = 'flight';
  readonly world: World;
  readonly scene: SceneRenderer;
  view: ViewMode = 'cockpit';
  timeIdx = 0;
  paused = false;
  debug = false;
  /** Recorded controls, one per tick, for replays. */
  readonly recording: ControlFrame[] = [];
  protected cam = new Camera();
  protected mirrorCam = new Camera();
  protected L: CockpitLayout;
  protected fxRng = new Rng(99); // render-only randomness (shake), not part of the sim
  protected lookSide: -1 | 1 = -1;
  protected padlockId = -1;
  protected flybyPos = new Vec3();
  protected chaseQ = new Quat();
  protected boostToggle = false;
  protected message = '';
  protected messageT = 0;
  protected frameMs = 0;
  protected pauseSel = 0;

  constructor(protected app: App, protected opts: FlightScreenOpts) {
    this.world = opts.world;
    this.scene = new SceneRenderer(opts.terrain);
    this.L = cockpitLayout(app.settings.slimPanel);
  }

  get player(): Plane {
    return this.world.player!;
  }

  // ------------------------------------------------------------ input

  frame(): void {
    const s = this.app.input;
    if (s.consume('debug')) this.debug = !this.debug;
    if (s.consume('pause')) { this.paused = !this.paused; this.touchMode = this.paused ? 'menu' : 'flight'; this.app.touch.setMode(this.touchMode); }
    if (this.paused) {
      this.pauseMenu();
      return;
    }
    if (s.consume('view1')) this.cycleView();
    if (s.consume('view2')) this.view = 'padlock';
    if (s.consume('view3')) this.view = 'chase';
    if (s.consume('view4')) { this.view = 'flyby'; this.placeFlyby(); }
    if (s.consume('padlock')) this.togglePadlock();
    if (s.consume('timeUp')) this.timeIdx = Math.min(TUNING.sim.timeCompression.length - 1, this.timeIdx + 1);
    if (s.consume('timeDown')) this.timeIdx = Math.max(0, this.timeIdx - 1);
    if (s.consume('panel')) { this.app.settings.slimPanel = !this.app.settings.slimPanel; this.L = cockpitLayout(this.app.settings.slimPanel); this.app.saveSettings(); }
    if (s.consume('boost')) this.boostToggle = !this.boostToggle;
    const p = this.player;
    if (s.consume('flaps')) p.fs.flapsCmd = p.fs.flapsCmd > 0.5 ? 0 : 1;
    if (s.consume('gear')) this.gearAction();
    if (s.lookBack && this.app.input.roll !== 0) this.lookSide = this.app.input.roll > 0 ? 1 : -1;
  }

  protected gearAction(): void {
    const fs = this.player.fs;
    if (fs.type.gear === 'fixed' || fs.onGround) return;
    fs.gearCmd = fs.gearCmd > 0.5 ? 0 : 1;
  }

  protected cycleView(): void {
    const order: ViewMode[] = ['cockpit', 'padlock', 'chase', 'flyby'];
    this.view = order[(order.indexOf(this.view) + 1) % order.length];
    if (this.view === 'flyby') this.placeFlyby();
  }

  protected togglePadlock(): void {
    if (this.view === 'padlock') { this.view = 'cockpit'; return; }
    const t = this.nearestEnemy();
    if (t) { this.padlockId = t.id; this.view = 'padlock'; }
    else this.flashMessage('NOTHING TO PADLOCK');
  }

  protected nearestEnemy(): Plane | null {
    const p = this.player;
    let best: Plane | null = null, bd = Infinity;
    for (const q of this.world.planes) {
      if (q === p || !q.alive || q.side === p.side) continue;
      const d = q.pos.distTo(p.pos);
      if (d < bd && d < 12000) { bd = d; best = q; }
    }
    return best;
  }

  flashMessage(m: string, secs = 2.5): void {
    this.message = m;
    this.messageT = secs;
  }

  protected pauseMenu(): void {
    const s = this.app.input;
    const items = this.pauseItems();
    if (s.consume('up')) this.pauseSel = (this.pauseSel + items.length - 1) % items.length;
    if (s.consume('down')) this.pauseSel = (this.pauseSel + 1) % items.length;
    let pick = -1;
    if (s.consume('ok')) pick = this.pauseSel;
    for (const t of s.taps) {
      const i = Math.floor((t.y - 80) / 14);
      if (i >= 0 && i < items.length && t.x > 80 && t.x < 240) pick = i;
    }
    if (pick >= 0) items[pick].act();
  }

  protected pauseItems(): { label: string; act: () => void }[] {
    const st = this.app.settings;
    return [
      { label: 'RESUME', act: () => { this.paused = false; this.touchMode = 'flight'; this.app.touch.setMode('flight'); } },
      { label: `AUTO-RUDDER ${st.autoRudder ? 'ON' : 'OFF'}`, act: () => { st.autoRudder = !st.autoRudder; this.world.autoRudder = st.autoRudder; this.app.saveSettings(); } },
      { label: `TILT ${st.tilt ? 'ON' : 'OFF'}`, act: () => { void this.toggleTilt(); } },
      { label: 'CALIBRATE TILT', act: () => this.app.tilt.calibrate() },
      { label: `PANEL ${st.slimPanel ? 'SLIM' : 'FULL'}`, act: () => { st.slimPanel = !st.slimPanel; this.L = cockpitLayout(st.slimPanel); this.app.saveSettings(); } },
      { label: 'QUIT FLIGHT', act: () => this.opts.onExit() },
    ];
  }

  protected async toggleTilt(): Promise<void> {
    const st = this.app.settings;
    if (st.tilt) { this.app.tilt.disable(); st.tilt = false; }
    else st.tilt = await this.app.tilt.enable();
    this.app.saveSettings();
  }

  ticksPerStep(): number {
    return this.paused ? 0 : TUNING.sim.timeCompression[this.timeIdx];
  }

  /** Controls for this tick, from the live input. */
  protected controlFrame(): ControlFrame {
    const s = this.app.input;
    const f = quantiseControls(s);
    f.boost = this.boostToggle;
    return f;
  }

  tick(): void {
    if (this.paused) return;
    const f = this.controlFrame();
    this.recording.push(f);
    this.world.step(f);
    this.afterTick();
    if (this.messageT > 0) this.messageT -= TUNING.sim.dt;
  }

  /** Hook for subclasses / later systems. */
  protected afterTick(): void {
    const fs = this.player.fs;
    if (fs.events.length) {
      for (const e of fs.events) this.onFlightEvent(e);
      fs.events.length = 0;
    }
  }

  protected onFlightEvent(e: string): void {
    if (e === 'stall') this.flashMessage('STALL', 1.2);
    if (e === 'spin') this.flashMessage('SPINNING!', 2);
    if (e === 'cutout') this.flashMessage('ENGINE CUT-OUT', 1.2);
    if (e === 'fuelOut') this.flashMessage('OUT OF FUEL', 3);
    if (e === 'seize') this.flashMessage('ENGINE SEIZED', 3);
  }

  // ------------------------------------------------------------ cameras

  protected placeFlyby(): void {
    const p = this.player.fs;
    const f = p.forward();
    this.flybyPos.copy(p.pos).addScaled(f, 220).addScaled(p.right(), 25);
    this.flybyPos.y += 8;
  }

  protected setupCamera(): { headTurned: boolean } {
    const p = this.player;
    const fs = p.fs;
    const cam = this.cam;
    const L = this.L;
    const s = this.app.input;
    let headTurned = false;
    if (this.view === 'cockpit' || this.view === 'padlock') {
      cam.setViewport(0, 0, 320, s.lookBack || this.view === 'padlock' ? 256 : L.panelTop, TUNING.render.fovDeg, s.lookBack || this.view === 'padlock' ? 128 : L.viewCy);
      const eye = fs.q.rotate(new Vec3(0, 0.75, -0.3));
      cam.pos.copy(fs.pos).add(eye);
      let q = fs.q;
      if (s.lookBack) {
        q = fs.q.mul(Quat.fromEuler(this.lookSide * 155 * DEG, 8 * DEG, 0));
        headTurned = true;
      } else if (this.view === 'padlock') {
        const t = this.world.planes.find((x) => x.id === this.padlockId && x.alive);
        if (!t) { this.view = 'cockpit'; }
        else {
          const local = fs.q.unrotate(t.pos.clone().sub(cam.pos));
          let yaw = Math.atan2(local.x, local.z);
          let pitch = Math.atan2(local.y, Math.hypot(local.x, local.z));
          yaw = clamp(yaw, -170 * DEG, 170 * DEG);
          pitch = clamp(pitch, -25 * DEG, 88 * DEG);
          q = fs.q.mul(Quat.fromEuler(yaw, pitch, 0));
          headTurned = Math.abs(yaw) > 25 * DEG || Math.abs(pitch) > 20 * DEG;
        }
      }
      cam.setOrientation(q);
      // Stall buffet: shake the view.
      if (fs.buffet > 0.1 && !fs.onGround) {
        const k = TUNING.effects.stallBuffetShakePx * fs.buffet;
        cam.cx += Math.round(this.fxRng.signed() * k);
        cam.cy += Math.round(this.fxRng.signed() * k);
      }
    } else if (this.view === 'chase') {
      cam.setViewport(0, 0, 320, 256, TUNING.render.fovDeg);
      this.chaseQ = Quat.slerp(this.chaseQ, fs.q, 0.12);
      const back = this.chaseQ.rotate(new Vec3(0, 3.5, -22));
      cam.pos.copy(fs.pos).add(back);
      cam.setOrientation(Quat.lookRotation(fs.pos.clone().sub(cam.pos), this.chaseQ.rotate(new Vec3(0, 1, 0))));
    } else {
      cam.setViewport(0, 0, 320, 256, 40);
      if (this.flybyPos.distTo(fs.pos) > 600) this.placeFlyby();
      cam.pos.copy(this.flybyPos);
      cam.setOrientation(Quat.lookRotation(fs.pos.clone().sub(cam.pos)));
    }
    return { headTurned };
  }

  // ------------------------------------------------------------ render

  render(fb: FrameBuffer): void {
    const t0 = performance.now();
    rasterStats.polys = 0;
    this.scene.lodBias = this.app.settings.retro ? 1 : 0;
    const { headTurned } = this.setupCamera();
    const p = this.player;
    const inside = this.view === 'cockpit' || this.view === 'padlock';
    this.scene.draw(fb, this.cam, this.world, { skipPlaneId: inside ? p.id : undefined, copper: this.app.display.copper });
    const s = this.app.input;
    if (inside && !headTurned && !s.lookBack) {
      this.drawMirror(fb);
      drawOilScreen(fb, this.L, this.oilAmount(), this.world.tick >> 2);
      drawCanopyFrame(fb, this.L, p.type.id);
      this.drawSight(fb);
      drawPanel(fb, this.L, this.panelData(), this.app.settings.slimPanel);
    } else if (inside && s.lookBack) {
      drawRearFrame(fb, this.lookSide);
    } else if (this.view === 'padlock') {
      this.drawPadlockIndicator(fb);
    }
    this.drawHud(fb);
    if (this.messageT > 0) viewMessage(fb, this.message, 40, C.WHITE);
    if (this.timeIdx > 0) drawText(fb, `TIME x${TUNING.sim.timeCompression[this.timeIdx]}`, 250, 22, C.SIGHT, 'tiny');
    if (this.paused) this.drawPause(fb);
    this.frameMs = this.frameMs * 0.9 + (performance.now() - t0) * 0.1;
    if (this.debug) this.drawDebug(fb);
  }

  protected oilAmount(): number {
    return 0;
  }

  protected drawSight(fb: FrameBuffer): void {
    const st = this.app.settings;
    drawGunsight(fb, this.cam.cx, this.cam.cy, this.cam.f, st.sightSpanFt * 0.3048, st.convergenceYards * 0.9144);
  }

  protected drawMirror(fb: FrameBuffer): void {
    const m = this.L.mirror;
    const fs = this.player.fs;
    const mc = this.mirrorCam;
    mc.setViewport(m.x0, m.y0, m.x1, m.y1, 34);
    mc.mirror = true;
    mc.pos.copy(fs.pos).add(fs.q.rotate(new Vec3(0, 1.1, 0.4)));
    mc.setOrientation(fs.q.mul(Quat.fromEuler(Math.PI, 4 * DEG, 0)));
    this.scene.draw(fb, mc, this.world, { skipPlaneId: this.player.id, lowDetail: true, sun: false });
  }

  protected drawPadlockIndicator(fb: FrameBuffer): void {
    // Where is the nose? A small arrow at the screen edge plus an attitude glyph.
    const fs = this.player.fs;
    const nose = fs.pos.clone().addScaled(fs.forward(), 1000);
    const t = [0, 0, 0];
    this.cam.toCam(nose.x, nose.y, nose.z, t);
    let x = 160, y = 128;
    if (t[2] > 1) { x = this.cam.projX(t[0], t[2]); y = this.cam.projY(t[1], t[2]); }
    else { x = 160 + t[0] * 1000; y = 128 - t[1] * 1000; }
    const dx = x - 160, dy = y - 128;
    const k = Math.min(1, 110 / Math.max(1, Math.abs(dx)), 100 / Math.max(1, Math.abs(dy)));
    const ex = 160 + dx * k, ey = 128 + dy * k;
    fillRect(fb, ex - 2, ey - 2, 5, 5, C.SIGHT);
    drawText(fb, 'NOSE', ex - 7, ey + 4, C.SIGHT, 'tiny');
    // Mini attitude: horizon bar.
    const r = fs.roll;
    for (let i = -8; i <= 8; i++) {
      const px = 296 + Math.cos(r) * i, py = 236 + Math.sin(r) * i + clamp(fs.pitch * 20, -10, 10);
      fillRect(fb, px, py, 1, 1, C.WHITE);
    }
    drawText(fb, `${Math.round(fs.ias * MPS_TO_MPH)}`, 4, 244, C.WHITE, 'tiny');
    drawText(fb, `${Math.round((fs.pos.y * M_TO_FT) / 100) * 100}FT`, 30, 244, C.WHITE, 'tiny');
  }

  protected panelData() {
    const fs = this.player.fs;
    return {
      fs,
      turnRate: (fs.r * Math.cos(fs.roll) + fs.qr * Math.sin(fs.roll)) * 57.3,
      gearDownLegs: fs.gearLegsDown,
      gearMoving: fs.gear > 0.02 && fs.gear < 0.98,
      flaps: fs.flaps,
      boostOn: fs.boostOn,
      fuelGallons: fs.fuel / GALLON_KG,
      fuelCapGallons: fs.type.fuelCapacity / GALLON_KG,
    };
  }

  protected drawHud(fb: FrameBuffer): void {
    if (this.view === 'chase' || this.view === 'flyby') {
      const fs = this.player.fs;
      drawText(fb, `${Math.round(fs.ias * MPS_TO_MPH)} MPH  ${Math.round(fs.pos.y * M_TO_FT)} FT`, 4, 4, C.WHITE, 'tiny');
    }
  }

  protected drawPause(fb: FrameBuffer): void {
    fillRect(fb, 70, 50, 180, 20 + this.pauseItems().length * 14, C.BLACK);
    drawText(fb, 'PAUSED', 139, 56, C.SIGHT);
    this.pauseItems().forEach((it, i) => {
      drawText(fb, (i === this.pauseSel ? '> ' : '  ') + it.label, 84, 80 + i * 14, i === this.pauseSel ? C.WHITE : C.GREY_L);
    });
  }

  protected drawDebug(fb: FrameBuffer): void {
    const fs = this.player.fs;
    const lines = [
      `FPS ${this.app.loop.fps.toFixed(1)} ${this.frameMs.toFixed(1)}MS POLY ${rasterStats.polys} OBJ ${this.scene.r3d.stats.objects} CELLS ${this.scene.terrain.stats.cells}`,
      `IAS ${(fs.ias * MPS_TO_MPH).toFixed(0)} TAS ${(fs.tas * MPS_TO_MPH).toFixed(0)} ALT ${(fs.pos.y * M_TO_FT).toFixed(0)} AGL ${(fs.agl * M_TO_FT).toFixed(0)}`,
      `G ${fs.nz.toFixed(2)} AOA ${(fs.alpha / DEG).toFixed(1)} BETA ${(fs.beta / DEG).toFixed(1)} E ${((fs.tas * fs.tas) / 2 / 9.81 + fs.pos.y).toFixed(0)}M`,
      `THR ${fs.throttle.toFixed(2)} RPM ${fs.rpm.toFixed(0)} RAD ${fs.radTemp.toFixed(0)} FUEL ${fs.fuel.toFixed(0)}KG ${fs.engine.toUpperCase()}`,
      `GREY ${this.player.pilot.grey.toFixed(2)} BLK ${this.player.pilot.black.toFixed(2)} SPIN ${fs.spin.toFixed(2)} TICK ${this.world.tick}`,
    ];
    lines.forEach((l, i) => {
      fillRect(fb, 0, 24 + i * 7, l.length * 4 + 2, 7, C.BLACK);
      drawText(fb, l, 1, 25 + i * 7, C.WHITE, 'tiny');
    });
  }

  effects(): ScreenEffects {
    const fx = noEffects();
    const pil = this.player.pilot;
    fx.grey = pil.grey;
    fx.black = pil.black;
    fx.red = pil.red * 0.8;
    return fx;
  }

  viewCentreY(): number {
    return this.cam.cy;
  }

  contextButtons(): ContextButton[] {
    if (this.paused) return [];
    const fs = this.player.fs;
    const b: ContextButton[] = [];
    if (fs.type.gear !== 'fixed' && !fs.onGround) b.push({ action: 'gear', label: fs.gearCmd > 0.5 ? 'GEAR UP' : 'GEAR DN', hold: 'pump' });
    if (fs.ias < 75) b.push({ action: 'flaps', label: fs.flapsCmd > 0.5 ? 'FLAPS UP' : 'FLAPS DN' });
    b.push({ action: 'boost', label: 'BOOST', lit: this.boostToggle });
    b.push({ action: 'timeUp', label: `TIME x${TUNING.sim.timeCompression[this.timeIdx]}`, lit: this.timeIdx > 0 });
    if (this.timeIdx > 0) b.push({ action: 'timeDown', label: 'TIME -' });
    return b;
  }
}
