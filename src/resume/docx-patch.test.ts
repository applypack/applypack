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

test('a rewrite of a table row whose cells hold several paragraphs is refused', async () => {
  const original = fixture('structural-table-layout');
  const before = docxToText(original);
  const row = before.split('\n')[0]!;
  const changed = await patchDocx(original, before, before.replace(row, row + ' and more'));
  assert.equal(changed.ok, false);
  assert.match(changed.ok ? '' : changed.reason, /table cell with several paragraphs/);
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
    // Word writes no directory entries; neither do we (jszip would add word/ and docProps/ otherwise).
    assert.deepEqual(Object.keys((await JSZip.loadAsync(res.docx)).files), Object.keys((await JSZip.loadAsync(original)).files), `${name}: same entries, in order`);
    // Only a package that has a properties part gets its timestamp; none is ever added.
    if (readProps(original).modified !== null) assert.equal(readProps(res.docx).modified, '2026-09-04T12:00:00Z', `${name}: modified stamped`);
    else assert.equal(readProps(res.docx).modified, null, `${name}: no properties part invented`);
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

test('a line replaced by unrelated words is a delete and an insert to the diff, and a change in the file', async () => {
  const original = fixture('flow-fragmented');
  const before = docxToText(original);
  const lines = before.split('\n');
  const i = lines.findIndex((l) => l.length > 40 && !/[|#-]/.test(l));
  lines[i] = 'A line rewritten by hand, in plain words.';
  const res = ok(await patchDocx(original, before, lines.join('\n')));
  assert.deepEqual({ changed: res.report.changed, removed: res.report.removed, added: res.report.added }, { changed: 1, removed: 0, added: 0 });
  assert.equal(res.text.split('\n')[i], 'A line rewritten by hand, in plain words.', 'same position as the line it replaced');
});

test('a rewritten line keeps its own look, not the look of the paragraph above it (#631)', async () => {
  const name = p(r('Dana Ruiz', '<w:b/><w:sz w:val="40"/>'), '<w:jc w:val="center"/>');
  const title = p(r('Senior Full-Stack Developer', '<w:color w:val="404040"/><w:sz w:val="24"/>'), '<w:jc w:val="center"/>');
  const heading = p(r('SUMMARY', '<w:b/><w:sz w:val="24"/>'), '<w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="404040"/></w:pBdr>');
  const summary = p(r('Full-stack engineer, six years building TypeScript products end to end.', '<w:sz w:val="21"/>'));
  const original = docxOf(name + title + heading + summary);
  const before = docxToText(original);
  const after = before
    .replace('Senior Full-Stack Developer', 'Software Engineer, Backend')
    .replace('Full-stack engineer, six years building TypeScript products end to end.', 'Ships reliable payment services for millions of users.\nOwns them on call.');
  const res = ok(await patchDocx(original, before, after));
  assert.equal(res.text, after);
  assert.deepEqual({ changed: res.report.changed, removed: res.report.removed, added: res.report.added }, { changed: 2, removed: 0, added: 1 });
  const paragraphs = (await documentXml(res.docx)).match(/<w:p>[\s\S]*?<\/w:p>/g)!;
  assert.equal(paragraphs.length, 5);
  assert.equal(paragraphs[1], p(r('Software Engineer, Backend', '<w:color w:val="404040"/><w:sz w:val="24"/>'), '<w:jc w:val="center"/>'), 'the title keeps the title’s look, not the name’s');
  assert.equal(paragraphs[3], p(r('Ships reliable payment services for millions of users.', '<w:sz w:val="21"/>')), 'the summary keeps body text, not the heading’s bold and rule');
  assert.equal(paragraphs[4], p(r('Owns them on call.', '<w:sz w:val="21"/>')), 'a line added after the rewrite follows it, in the same look');
});

test('the first line rewritten outright has its own paragraph to stand in, where an insert alone had no anchor', async () => {
  const original = docxOf(p(r('Dana Ruiz', '<w:b/>')) + p(r('Body line.')));
  const res = ok(await patchDocx(original, docxToText(original), 'Jordan Smith\nBody line.'));
  assert.equal(res.text, 'Jordan Smith\nBody line.');
  assert.match(await documentXml(res.docx), /<w:body><w:p><w:r><w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">Jordan Smith<\/w:t>/);
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

test('a body line cut down to capitals reads back as the heading the reader calls it, and the gate expects that', async () => {
  const original = fixture('flow-simple');
  const before = docxToText(original);
  const after = before.replace('PHP 8, Laravel, Docker, MySQL, Redis', 'PHP 8, AWS, SQL');
  const res = ok(await patchDocx(original, before, after));
  assert.match(res.text, /^## PHP 8, AWS, SQL$/m, 'the reader marks it a heading, and the patch still lands');
  assert.equal(docxToText(res.docx), res.text);
});

test('a table row is rewritten cell by cell when the edit keeps its cells', async () => {
  const original = docxOf(
    `<w:tbl><w:tr><w:tc>${p(r('Programming:'))}</w:tc><w:tc>${p(r('PHP, Go, JavaScript'))}</w:tc></w:tr>` +
      `<w:tr><w:tc>${p(r('Data:'))}</w:tc><w:tc>${p(r('MySQL, Redis'))}</w:tc></w:tr></w:tbl>${p(r('After the table.'))}`,
  );
  const before = docxToText(original);
  assert.match(before, /^Programming: \| PHP, Go, JavaScript$/m);
  const after = before.replace('PHP, Go, JavaScript', 'PHP, Go, JavaScript, Kafka');
  const res = ok(await patchDocx(original, before, after));
  assert.equal(res.text, after);
  assert.match(await documentXml(res.docx), /PHP, Go, JavaScript, Kafka/);
  // A row that loses a cell, or a cell emptied, says why instead of guessing.
  const merged = await patchDocx(original, before, before.replace('Programming: | PHP, Go, JavaScript', 'Programming: PHP, Go'));
  assert.equal(merged.ok, false);
  assert.match(merged.ok ? '' : merged.reason, /how many cells/);
});

test('a "- " the paragraph’s own text carries is words, not the reader’s marker, and survives an edit', async () => {
  const original = docxOf(p(r('- Did the first thing well')) + bullet(r('A real list item')));
  const before = docxToText(original);
  assert.equal(before, '- Did the first thing well\n- A real list item');
  const after = before.replace('first thing well', 'first thing very well').replace('A real list item', 'A real list item, edited');
  const res = ok(await patchDocx(original, before, after));
  assert.equal(res.text, after);
  assert.match(await documentXml(res.docx), />- Did the first thing very well</, 'the typed dash stays in the file');
  assert.doesNotMatch(await documentXml(res.docx), />- A real list item/, 'the list marker is the list’s, not text');
});
