import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * The app frame is one window high and only <main> scrolls. An absolute child
 * of an unpositioned scroll box (every sr-only label) is placed against the
 * page instead, at its own depth: the document grew taller than the window,
 * and a #anchor (#language after a language switch) scrolled the whole frame
 * up past the menu. Layout is not unit-testable here (gotcha 2), so the class
 * that prevents it is held in the source.
 */
test('the scroll box is positioned, so nothing inside it makes the page taller than the window', () => {
  const layout = readFileSync(join(__dirname, 'layout.tsx'), 'utf8');
  const main = /<main id="main" class="([^"]*)"/.exec(layout);
  assert.ok(main, 'layout.tsx has its <main id="main">');
  const classes = main[1]!.split(/\s+/);
  assert.ok(classes.includes('overflow-y-auto'), 'main is the scroll box');
  assert.ok(classes.includes('relative'), 'main is positioned');
});
