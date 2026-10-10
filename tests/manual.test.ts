// The manual lays out on its pages: nothing runs off the bottom or the side.

import { describe, expect, it } from 'vitest';
import { MANUAL } from '../src/content/text/manual';
import { hasTinyGlyph, textWidth } from '../src/render/font';
import { paginate } from '../src/screens/manual';

describe('the manual', () => {
  it('every chapter lays out within the page, and covers the main menu', () => {
    for (const c of MANUAL) {
      const pages = paginate(c.body);
      expect(pages.length, c.title).toBeGreaterThan(0);
      for (const p of pages) {
        expect(p.length, c.title).toBeGreaterThan(0);
        expect(p[p.length - 1].kind, `${c.title}: heading alone at the foot of a page`).not.toBe('h');
        for (const l of p) {
          expect(l.y + 6, `${c.title}: ${l.text}`).toBeLessThanOrEqual(234);
          expect(l.x + textWidth(l.text, 'tiny'), `${c.title}: ${l.text}`).toBeLessThanOrEqual(304);
        }
      }
    }
    // Every character is one the small font can draw.
    const drawn = MANUAL.flatMap((c) => paginate(c.body).flat().map((l) => l.text)).join('');
    const missing = new Set([...drawn].filter((ch) => !hasTinyGlyph(ch)));
    expect([...missing]).toEqual([]);
    const start = MANUAL[0].body.join(' ');
    for (const m of ['CAMPAIGN 1940', 'SCRAMBLE!', 'QUICK COMBAT', 'THE OTHER SIDE', 'LOGBOOK', 'SETTINGS']) expect(start).toContain(m);
  });
});
