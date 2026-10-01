import { App } from './app';
import { BenchScreen } from './screens/bench';

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const app = new App(canvas, (a) => new BenchScreen(a, () => {}));
app.start();
(window as unknown as { app: App }).app = app;

// Offline support when served over http(s); harmless when opened from file://.
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
