import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blankStyle, cleanFontName, inferFromDocx } from './style-infer';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', `${name}.docx`));

/*
 * flow-fragmented.docx is the structural twin of the one real .docx in the
 * corpus (ADR 0038's fixture), so the numbers below are that resume's own
 * typography: Arial, 11 pt body once each run is weighted by its text, a
 * 26 pt centred name, a blue accent, A4 and half-inch side margins.
 */
test('the runs decide, not the style sheet', () => {
  const style = inferFromDocx(fixture('flow-fragmented'));
  assert.equal(style.source, 'docx');
  // styles.xml on this file says Times New Roman at 12 pt. The document says:
  assert.equal(style.fontFamily, 'Arial');
  assert.equal(style.bodyPt, 11);
});

test('the name, the heading and the accent come off the biggest and the coloured runs', () => {
  const style = inferFromDocx(fixture('flow-fragmented'));
  assert.equal(style.namePt, 26);
  assert.equal(style.headingPt, 12);
  assert.equal(style.accentHex, '0070c0');
  assert.equal(style.nameCentered, true);
});

test('the page and all four margins come off the section properties', () => {
  const style = inferFromDocx(fixture('flow-fragmented'));
  assert.equal(style.page, 'A4');
  assert.deepEqual(style.margins, { top: 0.37, right: 0.49, bottom: 0.37, left: 0.5 });
});

test('a document that sets nothing reports nothing rather than guessing', () => {
  const style = inferFromDocx(fixture('flow-simple'));
  assert.equal(style.source, 'docx');
  assert.equal(style.fontFamily, null);
  assert.equal(style.bodyPt, null);
  assert.equal(style.accentHex, null);
  assert.equal(style.margins, null);
});

test('bytes that are not a .docx give the blank style', () => {
  const style = inferFromDocx(Buffer.from('not a zip at all'));
  assert.deepEqual(style, blankStyle());
  assert.equal(style.source, 'none');
});

test('cleanFontName strips the subset prefix and the PostScript suffixes', () => {
  assert.equal(cleanFontName('AAAAAU+ArialMT'), 'Arial');
  assert.equal(cleanFontName('AAAAAK+Arial-BoldMT'), 'Arial');
  // The suffixes nest — this one carries three.
  assert.equal(cleanFontName('AAAAAW+TimesNewRomanPSMT'), 'Times New Roman');
  assert.equal(cleanFontName('AAAABA+TimesNewRomanPS-BoldMT'), 'Times New Roman');
  assert.equal(cleanFontName('AAAAAC+Calibri-Light'), 'Calibri');
  assert.equal(cleanFontName('LiberationSans'), 'Liberation Sans');
  assert.equal(cleanFontName(''), null);
  assert.equal(cleanFontName('AAAAAA+'), null);
});
