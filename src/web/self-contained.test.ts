import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { hideCellsClass, hideHeaderClass } from './table-hide';

/*
 * The dashboard fetches nothing from a third party (2.7.0, audit 2026-09-10
 * PRIV-1): the Tailwind build is committed, Inter is bundled. A CDN or a
 * font host coming back into the layout or the CSP fails here.
 */
const THIRD_PARTY = /cdn\.tailwindcss\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/;

test('layout and CSP name no third-party host', () => {
  for (const f of ['layout.tsx', 'server.ts']) {
    assert.doesNotMatch(readFileSync(join(__dirname, f), 'utf8'), THIRD_PARTY, f);
  }
});

test('the committed Tailwind build carries the token classes the pages use', () => {
  const css = readFileSync(join(__dirname, 'public', 'tailwind.css'), 'utf8');
  assert.ok(statSync(join(__dirname, 'public', 'tailwind.css')).size > 20_000, 'the build looks empty — run npm run css');
  for (const cls of ['.bg-surface-raised', '.text-ink-faint', '.border-line', '.bg-accent-strong', '.text-warn', '.sr-only', '.animate-spin']) {
    assert.ok(css.includes(cls + '{') || css.includes(cls + ','), `${cls} is not in the build`);
  }
  assert.ok(css.includes("font-family:Inter") && css.includes('/static/fonts/inter-latin.woff2'), 'Inter is not bundled');
  assert.ok(statSync(join(__dirname, 'public', 'fonts', 'inter-latin.woff2')).size > 10_000);
});

test('every class table-hide.ts can assemble is in the build', () => {
  // The scanner reads literals; these are built from a breakpoint and a cell
  // index at render time, so the config lists them by hand — and this is
  // the check that the list and the generator agree.
  const css = readFileSync(join(__dirname, 'public', 'tailwind.css'), 'utf8').replace(/\\2c /g, '\\,');
  const esc = (s: string) => s.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
  const bps = ['sm', 'md', 'lg', 'xl'] as const;
  const hideBelow = Array.from({ length: 12 }, (_, i) => bps[i % bps.length]!);
  const tokens = [
    ...hideCellsClass(hideBelow).split(' '),
    ...hideBelow.flatMap((_, i) => hideHeaderClass(hideBelow, i).split(' ')),
  ].filter(Boolean);
  for (const token of tokens) assert.ok(css.includes('.' + esc(token)), `${token} is not in the build — extend the safelist in tailwind.config.js`);
});
