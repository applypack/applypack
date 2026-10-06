import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
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

/*
 * The typefaces as they came from their source (public/fonts/README.md): a
 * swapped file, or an added one with no row and no licence, fails here.
 */
const FONTS: Record<string, { sha256: string; licence: string; range: string | null }> = {
  'inter-latin.woff2': { sha256: 'c940764593d0fe5d596be327ca7558855e018039fb78509aa21921fd3644c3e4', licence: 'LICENSE-Inter.txt', range: null },
  'inter-cyrillic.woff2': { sha256: '71d5ee93cc1e9f1d520a3a8b66456de18c7879d8df09d57fcd2eaff75fef0075', licence: 'LICENSE-Inter.txt', range: 'U+0400-045F' },
  'noto-sans-devanagari.woff2': { sha256: '3b3cae4d2600cb502286577fcfbc7f0caa05d9bb3c28d6699aeb56302d35e730', licence: 'LICENSE-NotoSansDevanagari.txt', range: 'U+0900-097F' },
};

test('every bundled font is the file its README row names, with its licence, and loads only where its script is', () => {
  const dir = join(__dirname, 'public', 'fonts');
  const readme = readFileSync(join(dir, 'README.md'), 'utf8');
  const css = readFileSync(join(__dirname, 'public', 'tailwind.css'), 'utf8');
  for (const [file, font] of Object.entries(FONTS)) {
    assert.equal(createHash('sha256').update(readFileSync(join(dir, file))).digest('hex'), font.sha256, `${file} changed — see fonts/README.md`);
    assert.ok(readme.includes(font.sha256), `${file}'s hash is not in fonts/README.md`);
    assert.ok(existsSync(join(dir, font.licence)), `${font.licence} is missing`);
    const face = css.split('@font-face').find((block) => block.includes(`/static/fonts/${file}`));
    assert.ok(face, `${file} has no @font-face in the build — run npm run css`);
    // A face for another script must not be fetched by an English page.
    assert.equal(face.split('}')[0]!.includes('unicode-range'), font.range !== null, `${file}: unicode-range`);
    // The minifier writes the range in lower case.
    if (font.range) assert.ok(face.toLowerCase().includes(font.range.toLowerCase()), `${file} does not cover ${font.range}`);
  }
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
