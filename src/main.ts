import { App } from './app';
import { TestTerrain } from './content/world/testTerrain';
import { FlightScreen } from './screens/flight';
import { oneVersusOne } from './sim/scenarios';
import { registerModel } from './content/models';
import { bf109Model } from './content/models/bf109';

registerModel('bf109', bf109Model);

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const app = new App(canvas, (a) => {
  const terrain = new TestTerrain();
  const world = oneVersusOne(1940, terrain, 'spitfire', 'average', a.settings.convergenceYards * 0.9144);
  a.input.throttle = 0.85;
  return new FlightScreen(a, { world, terrain, onExit: () => location.reload() });
});
app.start();
(window as unknown as { app: App }).app = app;

// Offline support when served over http(s); harmless when opened from file://.
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
