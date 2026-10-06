import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Stamp the service worker's cache name with a fingerprint of the built
 * game, so every new build gets a fresh offline cache (no hand-bumping).
 */
function stampServiceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'stamp-service-worker',
    apply: 'build',
    configResolved(c) { outDir = resolve(c.root, c.build.outDir); },
    closeBundle() {
      const build = createHash('sha256').update(readFileSync(resolve(outDir, 'index.html'))).digest('hex').slice(0, 12);
      const sw = resolve(outDir, 'sw.js');
      writeFileSync(sw, readFileSync(sw, 'utf8').replace('__BUILD__', build));
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [viteSingleFile(), stampServiceWorker()],
  server: { host: true },
  build: {
    target: 'es2022',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 4000,
  },
});
