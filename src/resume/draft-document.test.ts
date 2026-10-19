import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { docxToText } from './docx-text';
import { pdfToText } from './pdf-text';
import { knobsFrom } from './render/knobs';
import { planRender } from './render/sections';
import { structureFromText } from './structure-from-text';
import { cleanDocx, contentDisposition, documentFileName, draftDocx, draftPdf, noticeFor, packFileName, type DraftInput } from './draft-document';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name));
const FLOW = fixture('flow-simple.docx');
const TABLE = fixture('structural-table-layout.docx');
const FLOW_TEXT = docxToText(FLOW);
const knobs = knobsFrom();

const input = (over: Partial<DraftInput>): DraftInput => ({
  sourceFilename: 'resume.docx',
  original: FLOW,
  baseText: FLOW_TEXT,
  text: FLOW_TEXT,
  knobs,
  ...over,
});

test('a .docx the patcher takes comes back as the user’s own file with the edit in it', async () => {
  const edited = FLOW_TEXT.replace('Improved SEO rankings for marketing pages.', 'Cut p95 latency of the search API by 40%.');
  const doc = await draftDocx(input({ text: edited }));
  assert.equal(doc.kind, 'own');
  assert.equal(doc.notice, null);
  assert.equal(docxToText(doc.docx), edited);
});

test('an edit the file cannot hold falls back to the clean version, and says which edit', async () => {
  const text = docxToText(TABLE);
  const edited = text.replace('PHP 8, Laravel, Docker', 'PHP 8, Laravel, Docker, Kafka');
  const doc = await draftDocx(input({ original: TABLE, baseText: text, text: edited }));
  assert.equal(doc.kind, 'clean');
  assert.equal(doc.basis, 'refused');
  assert.match(doc.notice ?? '', /cannot take one of these edits \(.+\)/);
  assert.match(docxToText(doc.docx), /Kafka/, 'the clean version carries the edit');
});

test('a comparison of an older version is named as such, not as a refusal', async () => {
  const doc = await draftDocx(input({ baseText: 'Some other resume entirely\n\nwith other lines', text: FLOW_TEXT }));
  assert.equal(doc.basis, 'stale');
  assert.match(doc.notice ?? '', /earlier version/);
});

test('a PDF resume is drawn as the clean version of the draft, and its PDF is ours', async () => {
  const text = [
    'Alex Example',
    'Senior Backend Engineer',
    'Austin, Texas · alex@example.com · +1 (512) 555 0100',
    '',
    'PROFESSIONAL SUMMARY',
    'Senior backend engineer with ten years of PHP and Laravel.',
    '',
    'EXPERIENCE',
    'Marketplace Co',
    'Senior Backend Engineer Jan 2022 – Present',
    '• Designed Laravel payment workflows processing $4M/month.',
  ].join('\n');
  const pdfInput = input({ sourceFilename: 'resume.pdf', original: Buffer.from('%PDF-1.3 not parsed here'), baseText: text, text });
  const doc = await draftDocx(pdfInput);
  assert.equal(doc.kind, 'clean');
  assert.equal(doc.basis, 'pdf');
  assert.match(docxToText(doc.docx), /Designed Laravel payment workflows processing \$4M\/month\./);
  const pdf = await draftPdf(pdfInput);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.match(await pdfToText(pdf), /Designed Laravel payment workflows/);
});

test('every clean basis has its own sentence', () => {
  for (const basis of ['pdf', 'text', 'unsupported', 'stale', 'refused'] as const) {
    assert.ok(noticeFor(basis).length > 40, basis);
  }
  assert.match(noticeFor('refused', 'a table row cannot be rewritten as one line'), /a table row cannot be rewritten/);
});

test('documentFileName keeps the resume’s own name and nothing a file system refuses', () => {
  assert.equal(documentFileName('Nazar Boyko Resume', 'pdf'), 'Nazar Boyko Resume.pdf');
  assert.equal(documentFileName('cv: final/v2 "real".docx', 'docx'), 'cv final v2 real.docx');
  assert.equal(documentFileName('   ', 'docx'), 'Resume.docx');
  assert.equal(documentFileName('x'.repeat(200), 'pdf').length, 84);
  // An emoji astride the cut is kept whole or left out, never halved: half of one broke the download.
  const name = documentFileName(`${'x'.repeat(79)}🚀 resume`, 'pdf');
  assert.equal(name, `${'x'.repeat(79)}🚀.pdf`);
  assert.doesNotThrow(() => contentDisposition(name));
});

test('#589: a pack’s file names the company, so two packs never collide in Downloads', () => {
  assert.equal(packFileName('marta keller resume.docx', 'Acme', 'docx'), 'marta keller resume — Acme.docx');
  assert.equal(packFileName('marta keller resume.docx', 'Acme', 'pdf'), 'marta keller resume — Acme.pdf');
  assert.equal(packFileName('marta keller resume.docx', null, 'docx'), 'marta keller resume.docx');
  assert.equal(packFileName('marta keller resume.docx', 'Acme/EU: GmbH', 'docx'), 'marta keller resume — Acme EU GmbH.docx');
  // A long resume name gives way; the company stays whole.
  const long = packFileName(`${'x'.repeat(100)}.docx`, 'Acme', 'docx');
  assert.ok(long.endsWith(' — Acme.docx'));
  assert.equal(long.length, 85);
});

test('contentDisposition carries a Cyrillic name without breaking the header', () => {
  const header = contentDisposition('Назар Бойко Resume.pdf');
  assert.match(header, /^attachment; filename="[\x20-\x7e]*"; filename\*=UTF-8''/);
  assert.ok(header.includes(encodeURIComponent('Назар Бойко Resume.pdf')));
  // Every byte of the header is ASCII, or Node refuses to send it.
  assert.ok([...header].every((ch) => ch.charCodeAt(0) < 128));
  assert.match(contentDisposition("O'Brien (final).pdf"), /filename\*=UTF-8''O%27Brien%20%28final%29\.pdf$/);
});

test('the clean version of a Markdown resume opens with the name and prints no Markdown (#574)', async () => {
  for (const name of ['markdown-headed-roles.md', 'markdown-bold-roles.md']) {
    const text = fixture(name).toString('utf8').trim();
    const plan = planRender(structureFromText(text), knobs);
    assert.ok(plan.header.name && plan.header.contact, name);
    assert.deepEqual(
      plan.blocks.filter((b) => b.kind === 'heading').map((b) => b.text),
      name === 'markdown-headed-roles.md' ? ['Summary', 'Skills', 'Experience', 'Education', 'Languages'] : ['Summary', 'Skills', 'Experience', 'Education'],
      'every role sits under Experience, none is a section of its own',
    );
    // What Save as vN stores, and what the Tailor page's downloads hand out.
    const saved = await cleanDocx(text, knobs);
    assert.deepEqual(saved.missing, [], name);
    const pdf = await pdfToText(await draftPdf(input({ sourceFilename: name, original: null, baseText: text, text })));
    for (const read of [saved.text, pdf]) {
      assert.equal(read.split('\n')[0], plan.header.name, 'the name is the first line');
      assert.doesNotMatch(read, /\*|`|(^|\s)_\w/m, 'no emphasis mark is printed');
      // The plainer line-by-line version draws a `### role` as a heading, in capitals: the reordered contact line must not send it there.
      assert.doesNotMatch(read, /ENGINEER —/, 'no role is drawn as a heading');
      assert.match(read, /March 2021 – Present/);
    }
  }
});

test('a save keeps the symbols the PDF face cannot draw — the .docx names the user’s font', async () => {
  const text = [
    'Alex Example',
    'Senior Backend Engineer',
    '',
    'EXPERIENCE',
    'Marketplace Co',
    'Senior Backend Engineer Jan 2022 – Present',
    '• Cut payment losses by ₴2.4M a year ✓',
    '• Rated ★★★★★ by the on-call team.',
  ].join('\n');
  const clean = await cleanDocx(text, knobs);
  assert.deepEqual(clean.missing, []);
  assert.match(clean.text, /₴2\.4M a year ✓/);
  assert.match(clean.text, /★★★★★/);
});
