import { App } from './app';
import { Vec3 } from './core/math';
import { TestTerrain } from './content/world/testTerrain';
import { FlightScreen } from './screens/flight';
import { World } from './sim/world';

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const app = new App(canvas, (a) => {
  const terrain = new TestTerrain();
  const world = new World(1940, terrain);
  const p = world.addPlane('spitfire', 'raf', 'Gannet Leader', 0.9);
  p.isPlayer = true;
  world.player = p;
  p.fs.setAirborne(new Vec3(0, 1500, 0), 0.4, 110);
  a.input.throttle = 0.8;
  return new FlightScreen(a, { world, terrain, onExit: () => location.reload() });
});
app.start();
(window as unknown as { app: App }).app = app;

// Offline support when served over http(s); harmless when opened from file://.
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
