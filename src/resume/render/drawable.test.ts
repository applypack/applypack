import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { drawable, isKept, keptCodePoints, undrawable } from './drawable';
import { planToText, planRender } from './sections';
import { JsonResumeSchema } from '../json-resume';
import { knobsFrom } from './knobs';

/** The line that found this, verbatim from resume 5 — Word formula objects. */
const MATH_LINE = 'Decreased the data logs storing algorithm (space complexity) from \u{1D442}(\u{1D441}2log2\u{1D441}) to \u{1D442}(\u{1D441}).';

test('mathematical italic letters fold to the letters they are', () => {
  assert.equal(
    drawable(MATH_LINE),
    'Decreased the data logs storing algorithm (space complexity) from O(N2log2N) to O(N).',
  );
});

test('a string with nothing to fold comes back unchanged, and is not rebuilt', () => {
  const plain = 'Led backend architecture for PHP/Laravel systems — 99.9% uptime, €1M saved.';
  assert.equal(drawable(plain), plain);
  assert.equal(drawable('Назар Бойко · Ґ Є І Ї'), 'Назар Бойко · Ґ Є І Ї');
});

test('what the face draws is kept; what it does not is folded', () => {
  // Measured, not assumed: Liberation Sans has ² and № but not the subscripts
  // or the ﬁ ligature, so only the latter two change.
  assert.equal(drawable('m²'), 'm²');
  assert.equal(drawable('№ 5'), '№ 5');
  assert.equal(drawable('H₂O'), 'H2O');
  assert.equal(drawable('ﬁle'), 'file');
  // The non-breaking hyphen has no glyph; the ordinary one it decomposes to has.
  assert.equal(drawable('re\u2011check'), 're\u2010check');
});

test('a character that folds to nothing drawable is dropped, not boxed', () => {
  assert.equal(drawable('Shipped it 🚀 fast'), 'Shipped it fast', 'the emoji goes, the spacing closes');
  assert.equal(drawable('日本語'), '');
});

test('isKept covers what a resume is actually written in', () => {
  for (const ch of ['a', 'Z', '9', '·', '•', '–', '—', '€', '£', '°', '±', '≥', '→', '²', 'é', 'ł', 'Н', 'Ї', 'Ω']) {
    assert.equal(isKept(ch), true, `${ch} should be kept`);
  }
  for (const ch of ['\u{1D442}', '₂', 'ﬁ', '\u2011', '🚀', '日']) {
    assert.equal(isKept(ch), false, `${ch} should be folded`);
  }
});

test('the separators the live corpus writes survive', () => {
  // U+2219 BULLET OPERATOR is what the resumes here put between a city and
  // "Remote"; folding it ran the two words together in the first live render.
  assert.equal(drawable('Austin, Texas, US ∙ Remote'), 'Austin, Texas, US ∙ Remote');
  assert.equal(drawable('a · b • c ∙ d'), 'a · b • c ∙ d');
});

test('undrawable names only what would be lost outright', () => {
  assert.deepEqual(undrawable(MATH_LINE), [], 'these fold, they are not lost');
  assert.deepEqual(undrawable('a 🚀 b'), ['🚀']);
});

/*
 * The point of the fold is a font's coverage, so the test asks the font
 * rather than trusting the ranges above. fontkit ships with pdfkit.
 */
test('EVERY codepoint the fold keeps has a glyph in both bundled faces', async () => {
  // The kept set is a claim about the shipped fonts, so it is checked against
  // them exhaustively rather than against a hand-picked probe — that is how
  // the holes in General Punctuation and Greek were found.
  // fontkit ships with pdfkit and carries no types of its own; only two
  // methods are used, so a local shape beats a dev dependency.
  // @ts-expect-error — no type declarations, and none are wanted for one call.
  const fontkit: { openSync(path: string): { glyphForCodePoint(cp: number): { id: number } } } = await import('fontkit');
  const dir = join(__dirname, '..', 'fonts');
  const kept = keptCodePoints();
  assert.ok(kept.length > 1_000, 'the kept set should cover Latin, Greek and Cyrillic');
  for (const face of ['LiberationSans-Regular.ttf', 'LiberationSans-Bold.ttf']) {
    assert.ok(readFileSync(join(dir, face)).length > 300_000, `${face} looks truncated`);
    const font = fontkit.openSync(join(dir, face));
    const missing = kept.filter((cp) => font.glyphForCodePoint(cp).id === 0);
    assert.deepEqual(
      missing.map((cp) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`),
      [],
      `${face} is missing glyphs the fold keeps`,
    );
    // And the folded form of the live failure draws end to end.
    const stillMissing = [...drawable(MATH_LINE)].filter((ch) => font.glyphForCodePoint(ch.codePointAt(0)!).id === 0);
    assert.deepEqual(stillMissing, [], `${face} cannot draw the folded math line`);
  }
});

test('the fold reaches every string of a plan, not only the bold ones', () => {
  const resume = JsonResumeSchema.parse({
    basics: { name: '\u{1D441}azar', summary: MATH_LINE, location: 'H₂O' },
    work: [{ name: '\u{1D442}Corp', position: 'Engineer', location: 'H₂O', highlights: [MATH_LINE] }],
    skills: [{ name: '\u{1D442}ther', keywords: ['H₂O'] }],
    extras: [{ heading: '\u{1D441}OTES', lines: ['H₂O'] }],
  });
  const text = planToText(planRender(resume, knobsFrom()));
  assert.equal(/[\u{1D400}-\u{1D7FF}₂]/u.test(text), false, `still unfolded: ${text}`);
  assert.match(text, /Nazar/);
  assert.match(text, /OCorp/);
  assert.match(text, /NOTES/);
  assert.match(text, /H2O/);
});
