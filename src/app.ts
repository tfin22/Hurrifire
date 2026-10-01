// Application shell: owns the framebuffer, display, input devices, audio and
// the current screen, and drives them from the fixed-timestep loop.

import { FixedLoop } from './core/loop';
import { loadSettings, saveSettings, Settings } from './core/settings';
import { ContextButton, GamepadSource, haptics, Keyboard, TiltSource, TouchControls, TouchMode } from './input/devices';
import { InputState } from './input/input';
import { Display, noEffects, ScreenEffects } from './render/display';
import { FrameBuffer, H, W } from './render/framebuffer';

export interface Screen {
  touchMode: TouchMode;
  enter?(): void;
  exit?(): void;
  /** Once per animation frame, before ticks: handle actions/taps. */
  frame?(dt: number): void;
  /** 50 Hz simulation tick. */
  tick(): void;
  render(fb: FrameBuffer): void;
  effects?(): ScreenEffects;
  /** Time compression. */
  ticksPerStep?(): number;
  contextButtons?(): ContextButton[];
  /** Centre of the 3D view, for the G tunnel. */
  viewCentreY?(): number;
}

export class App {
  readonly fb = new FrameBuffer();
  readonly display: Display;
  readonly input = new InputState();
  readonly keyboard: Keyboard;
  readonly touch: TouchControls;
  readonly tilt: TiltSource;
  readonly pad: GamepadSource;
  readonly loop: FixedLoop;
  settings: Settings;
  screen: Screen;
  private canvas: HTMLCanvasElement;
  /** Hooks for subsystems that want a per-frame callback (audio). */
  readonly frameHooks: ((dt: number) => void)[] = [];

  constructor(canvas: HTMLCanvasElement, first: (app: App) => Screen) {
    this.canvas = canvas;
    this.settings = loadSettings();
    haptics.enabled = this.settings.haptics;
    this.display = new Display(canvas);
    this.keyboard = new Keyboard(this.input, canvas);
    this.touch = new TouchControls(this.input, canvas);
    this.tilt = new TiltSource(this.input);
    this.pad = new GamepadSource(this.input);
    this.layout();
    window.addEventListener('resize', () => this.layout());
    window.addEventListener('orientationchange', () => setTimeout(() => this.layout(), 200));
    this.screen = first(this);
    this.screen.enter?.();
    this.touch.setMode(this.screen.touchMode);

    this.loop = new FixedLoop({
      ticksPerStep: () => this.screen.ticksPerStep?.() ?? 1,
      frame: (dt) => this.frame(dt),
      tick: () => this.screen.tick(),
      render: () => this.render(),
      renderCap: () => (this.settings.retro ? 12.5 : 0),
    });
  }

  start(): void {
    this.loop.start();
  }

  setScreen(s: Screen): void {
    this.screen.exit?.();
    this.screen = s;
    this.input.actions.length = 0;
    this.input.taps.length = 0;
    this.input.fire = false;
    s.enter?.();
    this.touch.setMode(s.touchMode);
    this.touch.setContext(s.contextButtons?.() ?? []);
  }

  saveSettings(): void {
    saveSettings(this.settings);
    haptics.enabled = this.settings.haptics;
  }

  private frame(dt: number): void {
    const s = this.input;
    s.fire = false;
    s.lookBack = false;
    s.pumpHeld = false;
    s.brake = false;
    this.keyboard.update(dt);
    this.pad.update(dt);
    this.tilt.update();
    this.touch.update();
    for (const h of this.frameHooks) h(dt);
    this.screen.frame?.(dt);
    this.touch.setContext(this.screen.contextButtons?.() ?? []);
    s.endFrame();
  }

  private render(): void {
    this.fb.resetClip();
    this.screen.render(this.fb);
    this.fb.resetClip();
    this.display.setRingCentre(this.screen.viewCentreY?.() ?? H / 2);
    this.display.present(this.fb, this.screen.effects?.() ?? noEffects());
  }

  /** Fit the 5:4 image to the screen height; the margins either side hold the controls. */
  layout(): void {
    const vw = window.innerWidth, vh = window.innerHeight;
    let h = vh, w = Math.round((h * W) / H);
    if (w > vw) { w = vw; h = Math.round((w * H) / W); }
    const left = Math.round((vw - w) / 2), top = Math.round((vh - h) / 2);
    Object.assign(this.canvas.style, { left: `${left}px`, top: `${top}px`, width: `${w}px`, height: `${h}px` });
    this.touch.layout(left, w, vw, vh);
  }

  /** Try for fullscreen + landscape lock (needs a user gesture; best effort). */
  async goFullscreen(): Promise<void> {
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      }
      const so = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      await so.lock?.('landscape');
    } catch {
      /* iOS Safari etc.: not supported */
    }
  }
}
