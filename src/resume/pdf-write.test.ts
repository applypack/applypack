import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLetterPdf, pdfEscape, wrapLine } from './pdf-write';

test('wrapLine wraps by words and hard-breaks overlong tokens', () => {
  assert.deepEqual(wrapLine('short line', 20), ['short line']);
  assert.deepEqual(wrapLine('one two three four', 9), ['one two', 'three', 'four']);
  assert.deepEqual(wrapLine('a'.repeat(25), 10), ['a'.repeat(10), 'a'.repeat(10), 'a'.repeat(5)]);
});

test('pdfEscape escapes delimiters and encodes Latin-1', () => {
  assert.equal(pdfEscape('plain (text) \\ done'), 'plain \\(text\\) \\\\ done');
  assert.equal(pdfEscape('Zoë'), 'Zo\\353');
  assert.equal(pdfEscape('嗨'), '?');
});

test('buildLetterPdf produces a structurally sound one-page PDF', () => {
  const pdf = buildLetterPdf('Hi Acme team,\n\nA (short) letter.\n\nBest,\nNazar').toString('latin1');
  assert.ok(pdf.startsWith('%PDF-1.4'));
  assert.match(pdf, /\/BaseFont \/Helvetica/);
  assert.match(pdf, /\(Hi Acme team,\) Tj/);
  assert.match(pdf, /\(A \\\(short\\\) letter\.\) Tj/);
  assert.match(pdf, /\/Count 1/);
  assert.match(pdf, /%%EOF\n$/);
});

test('a very long letter spills onto a second page', () => {
  const long = Array.from({ length: 60 }, (_, i) => `Line ${i + 1} of the letter.`).join('\n');
  const pdf = buildLetterPdf(long).toString('latin1');
  assert.match(pdf, /\/Count 2/);
  assert.match(pdf, /\(Line 60 of the letter\.\) Tj/);
});
