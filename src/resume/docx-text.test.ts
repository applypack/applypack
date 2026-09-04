import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documentXmlToText } from './docx-text';

const p = (inner: string, props = '') =>
  `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${inner}</w:p>`;
const t = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
// Namespaces declared, or xmldom refuses the prefix and every shape silently takes the regex fallback.
const doc = (body: string) =>
  `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>${body}<w:sectPr/></w:body></w:document>`;

test('joins fragmented runs and decodes entities', () => {
  const xml = doc(p(t('Led back') + t('end for ') + t('PHP &amp; Laravel &#x2F; Vue')));
  assert.equal(documentXmlToText(xml), 'Led backend for PHP & Laravel / Vue');
});

test('marks list items, styled headings and ALL-CAPS section titles', () => {
  const xml = doc(
    p(t('Alex Doe'), '<w:pStyle w:val="Title"/>') +
      p(t('PROFESSIONAL EXPERIENCE')) +
      p(t('Skills'), '<w:pStyle w:val="Heading1"/>') +
      p(t('Cut infra cost 30%'), '<w:numPr><w:ilvl w:val="0"/></w:numPr>') +
      p(t('A PLAIN SENTENCE THAT IS FAR TOO LONG TO BE A SECTION HEADING OF A RESUME')),
  );
  assert.equal(
    documentXmlToText(xml),
    [
      '# Alex Doe',
      '## PROFESSIONAL EXPERIENCE',
      '## Skills',
      '- Cut infra cost 30%',
      'A PLAIN SENTENCE THAT IS FAR TOO LONG TO BE A SECTION HEADING OF A RESUME',
    ].join('\n'),
  );
});

test('renders tabs as separators and breaks as lines', () => {
  const xml = doc(
    p(t('Acme Corp') + '<w:r><w:tab/><w:tab/></w:r>' + t('Austin, TX') + '<w:r><w:br/></w:r>' + t('Senior Engineer') + '<w:r><w:tab/></w:r>' + t('Dec 2024 - Present')),
  );
  assert.equal(documentXmlToText(xml), 'Acme Corp | Austin, TX\nSenior Engineer | Dec 2024 - Present');
});

test('flattens tables row by row and keeps nested paragraphs', () => {
  const cell = (inner: string) => `<w:tc><w:tcPr/>${inner}</w:tc>`;
  const xml = doc(
    p(t('KEY SKILLS')) +
      `<w:tbl><w:tblPr/><w:tr>${cell(p(t('Programming:')))}${cell(p(t('PHP 8, Go')))}</w:tr>` +
      `<w:tr>${cell(p(t('Databases:')))}${cell(p(t('MySQL')) + p(t('Redis')))}</w:tr></w:tbl>` +
      p(t('After table')),
  );
  assert.equal(
    documentXmlToText(xml),
    '## KEY SKILLS\nProgramming: | PHP 8, Go\nDatabases: | MySQL Redis\n\nAfter table',
  );
});

test('drops empty paragraphs but keeps a single blank line, and reads math text', () => {
  const xml = doc(
    p(t('One')) + '<w:p/>' + '<w:p w:rsidR="x"/>' + p('<w:r><w:t/></w:r>') + p(t('O(') + '<m:oMath><m:r><m:t>N</m:t></m:r></m:oMath>' + t(')')),
  );
  assert.equal(documentXmlToText(xml), 'One\n\nO(N)');
});

test('normalises non-breaking spaces', () => {
  const xml = doc(p(t('+1 (555) 123')));
  assert.equal(documentXmlToText(xml), '+1 (555) 123');
});

/* ---------- DOM walk vs the regex reader (ADR 0038) ---------- */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readZipEntry } from './zip';
import { parseDocumentXml, regexDocumentXmlToText, walkDocument, blocksToText } from './docx-text';

const FIXTURES = ['flow-fragmented', 'flow-simple', 'structural-table-layout'] as const;
const fixtureXml = (name: string) =>
  readZipEntry(readFileSync(join(__dirname, 'fixtures', `${name}.docx`)), 'word/document.xml')!.toString('utf8');

test('the DOM walk renders every fixture file exactly as the regex reader did', () => {
  for (const name of FIXTURES) {
    const xml = fixtureXml(name);
    assert.equal(documentXmlToText(xml), regexDocumentXmlToText(xml), name);
    assert.ok(documentXmlToText(xml).length > 100, `${name} reads as text`);
  }
});

test('the DOM walk and the regex reader agree on the hand-written shapes too', () => {
  const shapes = [
    doc(p(t('Led back') + t('end for ') + t('PHP &amp; Laravel &#x2F; Vue'))),
    doc(p(t('Skills'), '<w:pStyle w:val="Heading1"/>') + p(t('PHP'), '<w:numPr><w:ilvl w:val="0"/></w:numPr>') + '<w:p/>' + p(t('Body'))),
    doc(p(t('Company') + '<w:r><w:tab/></w:r>' + t('Austin') + '<w:r><w:br/></w:r>' + t('Title') + '<w:r><w:tab/></w:r>' + t('2022'))),
    doc('<w:tbl><w:tr><w:tc><w:tcPr/>' + p(t('Programming:')) + p(t('Frameworks:')) + '</w:tc><w:tc><w:tcPr/>' + p(t('PHP, Go')) + '</w:tc></w:tr></w:tbl>' + p(t('After'))),
    doc(p(t('PROFESSIONAL EXPERIENCE')) + p(t('a') + '<w:r><w:t xml:space="preserve"> b</w:t></w:r>')),
  ];
  for (const xml of shapes) assert.equal(documentXmlToText(xml), regexDocumentXmlToText(xml), xml.slice(0, 80));
});

test('walkDocument names the block kinds the patcher needs and keeps the nodes', () => {
  const blocks = walkDocument(parseDocumentXml(fixtureXml('flow-simple')));
  const kinds = blocks.map((b) => b.kind);
  assert.ok(kinds.includes('heading'), 'ALL-CAPS section markers are headings');
  assert.ok(kinds.includes('bullet'), 'numPr paragraphs are bullets');
  assert.ok(kinds.includes('body'));
  assert.ok(blocks.every((b) => b.node.localName === 'p' || b.node.localName === 'tbl'), 'every block points at its paragraph (or the table it closes)');
  assert.equal(blocksToText(blocks), documentXmlToText(fixtureXml('flow-simple')));
});

test('walkDocument flattens a table into cell blocks with row and cell indexes', () => {
  const blocks = walkDocument(parseDocumentXml(fixtureXml('structural-table-layout')));
  const cells = blocks.filter((b) => b.kind === 'cell');
  assert.ok(cells.length >= 6, `${cells.length} cell paragraphs`);
  assert.deepEqual([...new Set(cells.map((b) => b.table!.cell))], [0, 1], 'two cells in the row');
  assert.ok(cells.every((b) => b.table!.row === 0));
});

test('a tabbed paragraph is one block with one line per soft break', () => {
  const xml = doc(p(t('Company') + '<w:r><w:tab/></w:r>' + t('Austin') + '<w:r><w:br/></w:r>' + t('Title') + '<w:r><w:tab/></w:r>' + t('2022')));
  const [block] = walkDocument(parseDocumentXml(xml));
  assert.equal(block!.kind, 'tabbed');
  assert.deepEqual(block!.lines, ['Company | Austin', 'Title | 2022']);
});

test('a file xmldom refuses still reads through the regex fallback', () => {
  const broken = doc(p(t('Still readable'))).replace('</w:body>', '<w:unclosed></w:body>');
  assert.equal(documentXmlToText(broken), 'Still readable');
});
