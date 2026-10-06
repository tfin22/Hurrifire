// Fails the build if dist/index.html exceeds the budget in the spec (~2MB),
// or if the service worker didn't get its build fingerprint.
import { readFileSync, statSync } from 'node:fs';
const LIMIT = 2 * 1024 * 1024;
const size = statSync('dist/index.html').size;
const kb = (size / 1024).toFixed(1);
if (size > LIMIT) {
  console.error(`dist/index.html is ${kb} KB, over the 2 MB budget`);
  process.exit(1);
}
const cache = /const CACHE = '([^']+)'/.exec(readFileSync('dist/sw.js', 'utf8'))?.[1];
if (!cache || cache.includes('__BUILD__')) {
  console.error('dist/sw.js was not stamped with a build fingerprint');
  process.exit(1);
}
console.log(`dist/index.html: ${kb} KB (budget 2048 KB); offline cache ${cache}`);
