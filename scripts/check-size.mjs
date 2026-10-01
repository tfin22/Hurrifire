// Fails the build if dist/index.html exceeds the budget in the spec (~2MB).
import { statSync } from 'node:fs';
const LIMIT = 2 * 1024 * 1024;
const size = statSync('dist/index.html').size;
const kb = (size / 1024).toFixed(1);
if (size > LIMIT) {
  console.error(`dist/index.html is ${kb} KB, over the 2 MB budget`);
  process.exit(1);
}
console.log(`dist/index.html: ${kb} KB (budget 2048 KB)`);
