import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documentXmlToText } from './docx-text';

const p = (inner: string, props = '') =>
  `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${inner}</w:p>`;
const t = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const doc = (body: string) => `<w:document><w:body>${body}<w:sectPr/></w:body></w:document>`;

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
