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

test('#581: the docx opens with the sender and the date, on the posting’s paper', () => {
  const head = { name: 'Marta Keller', contact: 'marta@example.com · Berlin, Germany', date: '19 October 2026' };
  const docx = buildLetterDocx(LETTER, { paper: 'a4', head });
  const doc = readZipEntry(docx, 'word/document.xml')!.toString('utf8');
  assert.match(doc, /<w:pgSz w:w="11906" w:h="16838"\/>/);
  assert.match(doc, /<w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">Marta Keller<\/w:t>/);
  const text = docxToText(docx);
  assert.ok(text.indexOf('Marta Keller') < text.indexOf('marta@example.com · Berlin, Germany'));
  assert.ok(text.indexOf('19 October 2026') < text.indexOf('Hi Acme team,'));
  assert.match(readZipEntry(buildLetterDocx(LETTER, { paper: 'letter', head }), 'word/document.xml')!.toString('utf8'), /<w:pgSz w:w="12240" w:h="15840"\/>/);
});
