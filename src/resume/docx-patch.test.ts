import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { docxToText } from './docx-text';
import { patchDocx } from './docx-patch';
import { readProps } from './docx-props';
import { buildZip } from './zip-write';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', `${name}.docx`));
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const p = (inner: string, ppr = '') => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${inner}</w:p>`;
const r = (text: string, rPr = '') => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const bullet = (inner: string) => p(inner, '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>');
/** A one-part .docx around a hand-written body. */
const docxOf = (body: string) =>
  buildZip([{ name: 'word/document.xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>`, 'utf8') }]);
const documentXml = async (docx: Buffer) => (await JSZip.loadAsync(docx)).file('word/document.xml')!.async('string');
const ok = (res: Awaited<ReturnType<typeof patchDocx>>) => {
  assert.ok(res.ok, res.ok ? '' : res.reason);
  return res as Extract<typeof res, { ok: true }>;
};

test('a fragmented bullet is rewritten in place and the file reads back as the edit', async () => {
  const original = fixture('flow-simple');
  const before = docxToText(original);
  const after = before.replace('Led migration of the monolith to services; release time fell from 2 weeks to 2 days.', 'Led the migration to services, cutting release time from two weeks to two days.');
  const res = ok(await patchDocx(original, before, after));
  assert.equal(res.text, after);
  assert.deepEqual(res.report, { changed: 1, removed: 0, added: 0, skipped: [] });
  assert.ok((await documentXml(res.docx)).includes('cutting release time from two weeks to two days'));
});

test('only the changed window of a run group is rewritten — formatting outside it survives', async () => {
  const original = docxOf(p(r('Led ', '<w:b/>') + r('backend architecture') + r(' for PHP services.')));
  const before = docxToText(original);
  const res = ok(await patchDocx(original, before, 'Led payment architecture for PHP services.'));
  const xml = await documentXml(res.docx);
  assert.match(xml, /<w:b\/><\/w:rPr><w:t xml:space="preserve">Led <\/w:t>/, 'the bold run is untouched');
  assert.match(xml, /<w:t xml:space="preserve">payment architecture<\/w:t>/);
  assert.equal(res.text, 'Led payment architecture for PHP services.');
});

test('an insertion on a run boundary lands in the run before it — the bullet whose "." is its own run', async () => {
  // Resume 1's bullets end in a run holding only the full stop. Appending a
  // clause makes an empty change window exactly on that boundary; the first
  // live save doubled the stop because neither run claimed it.
  const original = docxOf(p(r('Reduced risk by 40%+') + r('.')));
  const before = docxToText(original);
  const res = ok(await patchDocx(original, before, 'Reduced risk by 40%+, rewritten in the editor.'));
  assert.equal(res.text, 'Reduced risk by 40%+, rewritten in the editor.');
  const xml = await documentXml(res.docx);
  assert.match(xml, /Reduced risk by 40%\+, rewritten in the editor<\/w:t>/, 'appended to the run before the boundary');
  assert.match(xml, /<w:t xml:space="preserve">\.<\/w:t>/, 'the full-stop run is untouched');
});

test('when the raw text is not what the renderer showed, the first run takes it all and the rest are emptied', async () => {
  // A double space inside the run: raw ≠ rendered, so the window path is off.
  const original = docxOf(p(r('Led  the ') + r('team') + r('.')));
  const before = docxToText(original);
  assert.equal(before, 'Led the team.');
  const res = ok(await patchDocx(original, before, 'Led the squad.'));
  assert.equal(res.text, 'Led the squad.');
  const xml = await documentXml(res.docx);
  assert.equal((xml.match(/<w:t xml:space="preserve"><\/w:t>/g) ?? []).length, 2, 'two runs emptied, none left with stale text');
});

test('both halves of a tabbed header are patched within their own runs', async () => {
  const original = docxOf(p(r('Marketplace Co') + '<w:r><w:tab/></w:r>' + r('Austin, Texas')) + p(r('Body line.')));
  const before = docxToText(original);
  assert.equal(before.split('\n')[0], 'Marketplace Co | Austin, Texas');
  const res = ok(await patchDocx(original, before, 'Marketplace Company | Austin, TX\nBody line.'));
  const xml = await documentXml(res.docx);
  assert.match(xml, /Marketplace Company<\/w:t>/);
  assert.match(xml, /Austin, TX<\/w:t>/);
  assert.equal(res.text.split('\n')[0], 'Marketplace Company | Austin, TX');
});

test('an edit that changes the tab layout of a line is refused, and nothing is written', async () => {
  const original = docxOf(p(r('Marketplace Co') + '<w:r><w:tab/></w:r>' + r('Austin, Texas')));
  const before = docxToText(original);
  const res = await patchDocx(original, before, 'Marketplace Co, Austin, Texas');
  assert.equal(res.ok, false);
  assert.match(res.ok ? '' : res.reason, /tab layout/);
});

test('a deleted bullet takes its paragraph out; a header line that shares a paragraph is refused', async () => {
  const original = fixture('flow-simple');
  const before = docxToText(original);
  const res = ok(await patchDocx(original, before, before.replace('- Improved SEO rankings for marketing pages.\n', '').replace(/\n- Improved SEO rankings for marketing pages\.$/, '')));
  assert.equal(res.report.removed, 1);
  assert.equal(res.text.includes('SEO'), false);
  const two = docxOf(p(r('Company') + '<w:r><w:tab/></w:r>' + r('Austin') + '<w:r><w:br/></w:r>' + r('Title') + '<w:r><w:tab/></w:r>' + r('2022')) + p(r('After.')));
  const text = docxToText(two);
  assert.equal(text, 'Company | Austin\nTitle | 2022\nAfter.');
  const refused = await patchDocx(two, text, 'Company | Austin\nAfter.');
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? '' : refused.reason, /shares its paragraph/);
});

test('a bullet inserted after a bullet keeps the numbering; the last run’s look is copied', async () => {
  const original = fixture('flow-simple');
  const before = docxToText(original);
  const after = before.replace(
    '- Led migration of the monolith to services; release time fell from 2 weeks to 2 days.',
    '- Led migration of the monolith to services; release time fell from 2 weeks to 2 days.\n- Cut checkout failures 18% with retry queues.',
  );
  const res = ok(await patchDocx(original, before, after));
  assert.equal(res.report.added, 1);
  assert.equal(res.text, after);
  const xml = await documentXml(res.docx);
  const inserted = /<w:p><w:pPr><w:numPr>[\s\S]*?<\/w:pPr><w:r><w:t xml:space="preserve">Cut checkout failures 18% with retry queues\.<\/w:t><\/w:r><\/w:p>/;
  assert.match(xml, inserted, 'a numbered paragraph with the marker stripped from the text');
});

test('two lines inserted in a row keep their order', async () => {
  const original = docxOf(p(r('First.')) + p(r('Last.')));
  const before = docxToText(original);
  const res = ok(await patchDocx(original, before, 'First.\nSecond.\nThird.\nLast.'));
  assert.equal(res.text, 'First.\nSecond.\nThird.\nLast.');
});

test('an insert inside a table is refused, and so is a rewrite of a table row', async () => {
  const original = fixture('structural-table-layout');
  const before = docxToText(original);
  const row = before.split('\n')[0]!;
  const changed = await patchDocx(original, before, before.replace(row, row + ' and more'));
  assert.equal(changed.ok, false);
  assert.match(changed.ok ? '' : changed.reason, /table row/);
});

test('a mismatched analysed text is refused before anything is read into a plan', async () => {
  const res = await patchDocx(fixture('flow-simple'), 'some other resume entirely\nwith two lines', 'edited');
  assert.equal(res.ok, false);
  assert.match(res.ok ? '' : res.reason, /does not match this file/);
});

test('an unchanged text round-trips every fixture and leaves the document part equal', async () => {
  for (const name of ['flow-simple', 'flow-fragmented', 'structural-table-layout']) {
    const original = fixture(name);
    const text = docxToText(original);
    const res = ok(await patchDocx(original, text, text, { now: new Date('2026-09-04T12:00:00Z') }));
    assert.equal(res.text, text, name);
    assert.deepEqual(res.report, { changed: 0, removed: 0, added: 0, skipped: [] }, name);
    assert.equal(await documentXml(res.docx), await documentXml(original), `${name}: document.xml byte-identical`);
    assert.equal(readProps(res.docx).modified, '2026-09-04T12:00:00Z', `${name}: modified stamped`);
  }
});

test('the twin’s fragmented runs take a rewrite and the math objects survive', async () => {
  const original = fixture('flow-fragmented');
  const before = docxToText(original);
  // The first body line with no marker and no tab, reworded but recognisable —
  // a line that shares no words with its replacement is a delete plus an insert
  // to the diff, and that path is covered below.
  const line = before.split('\n').find((l) => l.length > 40 && !/[|#-]/.test(l))!;
  const words = line.split(' ');
  const reworded = [...words.slice(0, -3), 'reworded', 'by', 'hand'].join(' ');
  const res = ok(await patchDocx(original, before, before.replace(line, reworded)));
  assert.equal(res.report.changed, 1, JSON.stringify(res.report));
  assert.ok(res.text.includes(reworded));
  assert.equal((await documentXml(res.docx)).match(/<m:oMath[\s>]/g)?.length, 2);
});

test('a line replaced by unrelated words is a delete and an insert, and still lands in place', async () => {
  const original = fixture('flow-fragmented');
  const before = docxToText(original);
  const lines = before.split('\n');
  const i = lines.findIndex((l) => l.length > 40 && !/[|#-]/.test(l));
  lines[i] = 'A line rewritten by hand, in plain words.';
  const res = ok(await patchDocx(original, before, lines.join('\n')));
  assert.deepEqual({ changed: res.report.changed, removed: res.report.removed, added: res.report.added }, { changed: 0, removed: 1, added: 1 });
  assert.equal(res.text.split('\n')[i], 'A line rewritten by hand, in plain words.', 'same position as the line it replaced');
});

test('new text is written with plain punctuation; the original keeps its own', async () => {
  const original = docxOf(p(r('Keep “these” quotes.')) + p(r('Change me.')));
  const before = docxToText(original);
  const res = ok(await patchDocx(original, before, 'Keep “these” quotes.\nChanged — with “curly” quotes.'));
  const xml = await documentXml(res.docx);
  assert.match(xml, /Keep “these” quotes\./, 'an untouched line keeps its characters');
  assert.match(xml, /Changed - with "curly" quotes\./, 'the new text is plain');
});

test('fixProperties rewrites the properties in the same save', async () => {
  const original = fixture('flow-fragmented');
  const text = docxToText(original);
  const res = ok(await patchDocx(original, text, text, { fixProperties: { title: 'Alex Example — Résumé', author: 'Alex Example' } }));
  const props = readProps(res.docx);
  assert.equal(props.creator, 'Alex Example');
  assert.equal(props.title, 'Alex Example — Résumé');
});
