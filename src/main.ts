import { App } from './app';
import { BenchScreen } from './screens/bench';
import { allModels } from './content/models';
import { Vec3 } from './core/math';
import { Rng } from './core/rng';
import { lonLatToXZ, worldMap } from './content/world/map';
import { WorldObjects } from './content/world/objects';
import { makeWorldLayer } from './render/worldLayer';
import { FlightScreen } from './screens/flight';
import { CloudField } from './sim/clouds';
import { freeFlight } from './sim/scenarios';
import { dayOfYear, sunDirection } from './sim/sun';
import { generateWeather, windVector } from './sim/weather';


const canvas = document.getElementById('screen') as HTMLCanvasElement;
const app = new App(canvas, (a) => {
  if (new URLSearchParams(location.search).has('models')) return new BenchScreen(a, () => {}, allModels());
  const map = worldMap();
  const objs = new WorldObjects(map);
  const q = new URLSearchParams(location.search);
  const lat = +(q.get('lat') ?? 51.33), lon = +(q.get('lon') ?? 0.03);
  const [x, z] = lonLatToXZ(lat, lon);
  const alt = +(q.get('alt') ?? 1500);
  const world = freeFlight(1940, map, new Vec3(x, alt, z), (+(q.get('hdg') ?? 60) * Math.PI) / 180);
  const wx = generateWeather(new Rng(+(q.get('wx') ?? 3)), 8);
  world.weather.wind.copy(windVector(wx));
  world.weather.haze = wx.haze;
  world.cloudField = new CloudField(7, wx.cloudBase, wx.cloudTop, wx.cover);
  world.balloons = objs.balloons;
  world.sun.copy(sunDirection(dayOfYear(8, 15), +(q.get('hour') ?? 14)));
  a.input.throttle = 0.8;
  const fsScreen = new FlightScreen(a, { world, terrain: map, onExit: () => location.reload() });
  fsScreen.scene.layers.push(makeWorldLayer(objs, world, () => []));
  return fsScreen;
});
app.start();
(window as unknown as { app: App }).app = app;

// Offline support when served over http(s); harmless when opened from file://.
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
