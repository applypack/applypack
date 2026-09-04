import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeStructure, docxStructure } from './docx-structure';
import { buildZip } from './zip-write';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', `${name}.docx`));

/** A one-part .docx around a hand-written body, enough for the counters. */
function docxOf(body: string): Buffer {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>`;
  return buildZip([{ name: 'word/document.xml', data: Buffer.from(document, 'utf8') }]);
}
const p = (inner: string) => `<w:p>${inner}</w:p>`;
const run = (text: string, rPr = '') => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;

test('a paragraphs-only file is flow, every line editable', () => {
  const s = docxStructure(fixture('flow-simple'));
  assert.equal(s.kind, 'flow');
  assert.equal(s.tables + s.textBoxes + s.headerChars + s.footerChars, 0);
  assert.equal(s.lines.editable, s.lines.total);
  assert.ok(s.lines.total >= 10, `${s.lines.total} lines`);
  assert.deepEqual(s.notes, []);
  assert.match(describeStructure(s), /editable in place, \d+ of \d+ lines/);
});

test('the real resume’s twin is structural because its skills live in a table — and says so', () => {
  // Resume 1 keeps its skills in a 1×2 table; every other line is a paragraph.
  const s = docxStructure(fixture('flow-fragmented'));
  assert.equal(s.kind, 'structural');
  assert.equal(s.tables, 1);
  assert.equal(s.math, 2, 'the two OMML objects survive in the twin');
  assert.equal(s.textBoxes, 0);
  assert.equal(s.lines.editable, s.lines.total, 'cell text counts as editable in v1');
  assert.ok(s.notes.some((n) => /table/.test(n)));
  assert.ok(s.notes.some((n) => /formula/.test(n)));
  assert.match(describeStructure(s), /partly editable in place/);
});

test('a table layout with a text box and a header is structural, and the notes name each', () => {
  const s = docxStructure(fixture('structural-table-layout'));
  assert.equal(s.kind, 'structural');
  assert.equal(s.tables, 1);
  assert.equal(s.textBoxes, 1);
  assert.ok(s.headerChars > 20, `${s.headerChars} header chars`);
  assert.ok(s.lines.editable < s.lines.total, 'the text-box line is not editable');
  assert.ok(s.notes.some((n) => /header/.test(n)));
  assert.ok(s.notes.some((n) => /text box/.test(n)));
  assert.ok(s.notes.some((n) => /table/.test(n)));
});

test('hidden, white and tiny runs are counted and flagged', () => {
  const s = docxStructure(
    docxOf(
      p(run('Visible')) +
        p(run('Keyword stuffing', '<w:vanish/>')) +
        p(run('more stuffing', '<w:color w:val="FFFFFF"/>')) +
        p(run('microtext', '<w:sz w:val="4"/>')),
    ),
  );
  assert.equal(s.hiddenRuns, 1);
  assert.equal(s.whiteRuns, 1);
  assert.equal(s.tinyRuns, 1);
  assert.ok(s.notes.some((n) => /hidden run/.test(n)));
  assert.ok(s.notes.some((n) => /white-text/.test(n)));
});

test('a document that is mostly text boxes is unsupported; a missing document part is too', () => {
  const box = (text: string) => p(`<w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml"><v:textbox><w:txbxContent>${p(run(text))}</w:txbxContent></v:textbox></v:shape></w:pict></w:r>`);
  const s = docxStructure(docxOf(p(run('Name')) + box('Everything of substance is in this box, every line of it.')));
  assert.equal(s.kind, 'unsupported');
  assert.match(s.notes[0]!, /text boxes/);
  assert.equal(docxStructure(buildZip([{ name: 'other.xml', data: Buffer.from('<x/>') }])).kind, 'unsupported');
  assert.match(describeStructure(s), /cannot be edited in place/);
});

test('multiple columns make a file structural', () => {
  const s = docxStructure(docxOf(p(run('Two columns')) + '<w:p><w:pPr><w:sectPr><w:cols w:num="2"/></w:sectPr></w:pPr></w:p>'));
  assert.equal(s.columns, 2);
  assert.equal(s.kind, 'structural');
});
