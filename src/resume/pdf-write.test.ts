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

test('#581: the PDF opens with the sender in bold and the date, on A4 or on Letter', () => {
  const head = { name: 'Marta Keller', contact: 'marta@example.com · Berlin, Germany', date: '19 October 2026' };
  const a4 = buildLetterPdf('Hi Acme team,\n\nBest,\nMarta', { paper: 'a4', head }).toString('latin1');
  assert.match(a4, /\/MediaBox \[0 0 595\.28 841\.89\]/);
  assert.match(a4, /\/BaseFont \/Helvetica-Bold/);
  assert.match(a4, /\/F2 11 Tf \(Marta Keller\) Tj/);
  assert.match(a4, /\/F1 11 Tf \(marta@example\.com \\267 Berlin, Germany\) Tj/);
  assert.ok(a4.indexOf('(19 October 2026)') < a4.indexOf('(Hi Acme team,)'));
  const letter = buildLetterPdf('Hi Acme team,', { paper: 'letter', head }).toString('latin1');
  assert.match(letter, /\/MediaBox \[0 0 612 792\]/);
});

test('A4 wraps a line at its narrower text width, and a head with no sender still dates the letter', () => {
  const pdf = buildLetterPdf(`${'x '.repeat(39)}xx`, { paper: 'a4', head: { name: null, contact: null, date: '1 May 2026' } }).toString('latin1');
  assert.match(pdf, /\(1 May 2026\) Tj/);
  // 80 characters are one line on Letter and two on A4, whose budget is 77.
  assert.match(pdf, /\(xx\) Tj/);
  assert.doesNotMatch(buildLetterPdf(`${'x '.repeat(39)}xx`).toString('latin1'), /\(xx\) Tj/);
});
