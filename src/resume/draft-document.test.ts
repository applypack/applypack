import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { docxToText } from './docx-text';
import { pdfToText } from './pdf-text';
import { knobsFrom } from './render/knobs';
import { cleanDocx, contentDisposition, documentFileName, draftDocx, draftPdf, noticeFor, type DraftInput } from './draft-document';

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

test('a comparison of a draft of this version does not claim an earlier one (#582)', async () => {
  const doc = await draftDocx(input({ baseText: 'Some other resume entirely\n\nwith other lines', text: FLOW_TEXT, draft: true }));
  assert.equal(doc.basis, 'draft');
  assert.match(doc.notice ?? '', /read a draft, not the file you saved/);
  assert.doesNotMatch(doc.notice ?? '', /earlier version/);
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
  for (const basis of ['pdf', 'text', 'unsupported', 'stale', 'draft', 'refused'] as const) {
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

test('contentDisposition carries a Cyrillic name without breaking the header', () => {
  const header = contentDisposition('Назар Бойко Resume.pdf');
  assert.match(header, /^attachment; filename="[\x20-\x7e]*"; filename\*=UTF-8''/);
  assert.ok(header.includes(encodeURIComponent('Назар Бойко Resume.pdf')));
  // Every byte of the header is ASCII, or Node refuses to send it.
  assert.ok([...header].every((ch) => ch.charCodeAt(0) < 128));
  assert.match(contentDisposition("O'Brien (final).pdf"), /filename\*=UTF-8''O%27Brien%20%28final%29\.pdf$/);
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
