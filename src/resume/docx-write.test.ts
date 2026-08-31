import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLetterDocx, escapeXml } from './docx-write';
import { docxToText } from './docx-text';
import { readZipEntry } from './zip';

const LETTER = 'Hi Acme team,\n\nI build PHP & Laravel systems <fast>.\n\nBest,\nNazar';

test('escapeXml covers the markup-significant characters', () => {
  assert.equal(escapeXml('a & b < c > "d"'), 'a &amp; b &lt; c &gt; &quot;d&quot;');
});

test('a built docx round-trips through our own reader and extractor', () => {
  const docx = buildLetterDocx(LETTER);
  const extracted = docxToText(docx);
  for (const line of ['Hi Acme team,', 'I build PHP & Laravel systems <fast>.', 'Best,', 'Nazar']) {
    assert.ok(extracted.includes(line), `missing line: ${line}`);
  }
});

test('the docx carries the three required parts', () => {
  const docx = buildLetterDocx(LETTER);
  assert.ok(readZipEntry(docx, '[Content_Types].xml'));
  assert.ok(readZipEntry(docx, '_rels/.rels'));
  const doc = readZipEntry(docx, 'word/document.xml')!.toString('utf8');
  assert.match(doc, /<w:p\/>/); // blank input lines become empty paragraphs
  assert.match(doc, /xml:space="preserve"/);
});
