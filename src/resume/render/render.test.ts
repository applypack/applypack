import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JsonResumeSchema, emptyResume } from '../json-resume';
import { docxToText } from '../docx-text';
import { pdfToText } from '../pdf-text';
import { parseWarnings } from '../parse-warnings';
import { docxStructure } from '../docx-structure';
import { readProps } from '../docx-props';
import { inferFromPdf } from '../style-infer';
import { renderDocx } from './clean-docx';
import { renderPdf, typefaceNote } from './clean-pdf';
import { knobsFrom, readKnobs, readOrder, isMetricTwin, normaliseHex, LIMITS, type RenderKnobs } from './knobs';
import { planRender, planToText } from './sections';

const RESUME = JsonResumeSchema.parse({
  basics: {
    name: 'Назар Бойко',
    label: 'Senior Software Engineer',
    email: 'boyko.nazar@gmail.com',
    phone: '+1 (612) 267-5544',
    location: 'Austin, Texas',
    url: 'linkedin.com/in/nazar-boyko',
    summary: 'Senior full-stack engineer shipping production systems end-to-end.',
  },
  work: [
    {
      name: 'V Shred',
      position: 'Senior Software Engineer',
      location: 'Austin, Texas, US · Remote',
      startDate: 'Dec. 2024',
      endDate: 'Present',
      highlights: [
        'Led backend architecture for PHP/Laravel systems processing high-volume financial transactions.',
        'Built and deployed a cross-platform notification system.',
      ],
    },
  ],
  skills: [{ name: 'Programming', keywords: ['PHP', 'Go', 'JavaScript'] }],
  education: [{ institution: 'Lviv Polytechnic National University', area: 'Computer Science', studyType: 'M.Sc.' }],
  languages: [{ language: 'Ukrainian', fluency: 'Native' }],
});

const KNOBS = knobsFrom({
  fontFamily: 'Arial', bodyPt: 10.5, namePt: 20, headingPt: 11.5, accentHex: '0070c0',
  margins: { top: 0.5, right: 0.6, bottom: 0.5, left: 0.6 }, page: 'LETTER', nameCentered: true, source: 'docx',
});

/* ---------- knobs ---------- */

test('knobsFrom takes the file’s typography and our defaults where it is silent', () => {
  const k = knobsFrom({
    fontFamily: 'Calibri', bodyPt: 11, namePt: 26, headingPt: null, accentHex: '#0070C0',
    margins: null, page: 'A4', nameCentered: null, source: 'docx',
  });
  assert.equal(k.fontFamily, 'Calibri');
  assert.equal(k.bodyPt, 11);
  assert.equal(k.namePt, 26);
  assert.equal(k.headingPt, 12, 'a body size plus one, when the file has no heading size');
  assert.equal(k.accentHex, '0070c0', 'the hash goes, the case flattens');
  assert.equal(k.page, 'A4');
  assert.deepEqual(k.margins, { top: 0.5, right: 0.6, bottom: 0.5, left: 0.6 }, 'our defaults');
});

test('knobsFrom clamps a size a file can carry but a page cannot use', () => {
  const k = knobsFrom({
    fontFamily: null, bodyPt: 72, namePt: 200, headingPt: 0.5, accentHex: 'not a colour',
    margins: { top: 9, right: 0, bottom: 0.5, left: 0.5 }, page: null, nameCentered: false, source: 'docx',
  });
  assert.equal(k.bodyPt, LIMITS.bodyPt.max);
  assert.equal(k.namePt, LIMITS.namePt.max);
  assert.equal(k.headingPt, LIMITS.headingPt.min);
  assert.equal(k.accentHex, null);
  assert.equal(k.margins.top, LIMITS.marginIn.max);
  assert.equal(k.margins.right, LIMITS.marginIn.min);
});

test('readKnobs validates the form rather than trusting it', () => {
  const k = readKnobs({ bodyPt: '99', namePt: 'abc', accentHex: '#ABCDEF', page: 'A4', marginLeft: '0.75' }, KNOBS);
  assert.equal(k.bodyPt, LIMITS.bodyPt.max);
  assert.equal(k.namePt, LIMITS.namePt.min, 'a number that is not one clamps rather than becoming NaN');
  assert.equal(k.accentHex, 'abcdef');
  assert.equal(k.page, 'A4');
  assert.equal(k.margins.left, 0.75);
  assert.equal(k.margins.right, KNOBS.margins.right, 'a field the form did not send is unchanged');
});

test('an accent field the user cleared means no accent, not "unchanged"', () => {
  assert.equal(readKnobs({ accentHex: '' }, KNOBS).accentHex, null);
  assert.equal(readKnobs({}, KNOBS).accentHex, KNOBS.accentHex);
});

test('an unchecked checkbox sends nothing, and that is false', () => {
  assert.equal(readKnobs({ nameCentered: 'on' }, KNOBS).nameCentered, true);
  assert.equal(readKnobs({}, KNOBS).nameCentered, false);
});

test('readOrder keeps every section, whatever the form left out', () => {
  const order = readOrder('work,skills');
  assert.deepEqual(order?.slice(0, 2), ['work', 'skills']);
  assert.equal(order?.length, 8, 'the sections not named are appended, never dropped');
  assert.equal(readOrder('nonsense'), null);
  assert.equal(readOrder(null), null);
});

test('normaliseHex and isMetricTwin', () => {
  assert.equal(normaliseHex('#0070C0'), '0070c0');
  assert.equal(normaliseHex('0070c0'), '0070c0');
  assert.equal(normaliseHex('blue'), null);
  assert.equal(normaliseHex(null), null);
  assert.equal(isMetricTwin('Arial'), true);
  assert.equal(isMetricTwin('  helvetica '), true);
  assert.equal(isMetricTwin('Calibri'), false);
});

/* ---------- the shared plan ---------- */

test('the plan drops a section the resume has nothing for', () => {
  const plan = planRender(emptyResume(), KNOBS);
  assert.deepEqual(plan.blocks, []);
  assert.deepEqual(plan.header, { name: null, label: null, contact: null });
});

test('the plan puts the dates and the place on the right of their line', () => {
  const plan = planRender(RESUME, KNOBS);
  const lines = plan.blocks.filter((b) => b.kind === 'line');
  const company = lines.find((l) => l.left[0]?.text === 'V Shred');
  assert.equal(company?.right[0]?.text, 'Austin, Texas, US · Remote');
  const role = lines.find((l) => l.left[0]?.text === 'Senior Software Engineer');
  assert.equal(role?.right[0]?.text, 'Dec. 2024 – Present');
});

test('planToText reads as the resume, headings and bullets included', () => {
  const text = planToText(planRender(RESUME, KNOBS));
  assert.match(text, /^Назар Бойко/);
  assert.match(text, /\nSUMMARY\n/);
  assert.match(text, /\nEXPERIENCE\n/);
  assert.match(text, /• Built and deployed a cross-platform notification system\./);
  assert.match(text, /Programming: PHP, Go, JavaScript/);
  assert.match(text, /Ukrainian \(Native\)/);
});

/* ---------- the .docx ---------- */

test('the .docx reads back as the resume through our own reader', async () => {
  const text = docxToText(await renderDocx(RESUME, KNOBS));
  assert.match(text, /Назар Бойко/);
  assert.match(text, /boyko\.nazar@gmail\.com/);
  assert.match(text, /Led backend architecture for PHP\/Laravel systems/);
  assert.match(text, /Lviv Polytechnic National University/);
});

test('the .docx is a flow document the patcher can edit in place', async () => {
  const structure = docxStructure(await renderDocx(RESUME, KNOBS));
  assert.equal(structure.kind, 'flow', 'the point of the re-render: the loop continues on the result');
  assert.equal(structure.tables, 0);
  assert.equal(structure.textBoxes, 0);
  assert.equal(structure.columns, 1);
  assert.equal(structure.hiddenRuns + structure.whiteRuns + structure.tinyRuns, 0);
  assert.ok(structure.lines.editable > 0);
  assert.equal(structure.lines.editable, structure.lines.total);
});

test('the .docx names the candidate and no tool', async () => {
  const bytes = await renderDocx(RESUME, KNOBS);
  const props = readProps(bytes);
  assert.equal(props.creator, 'Назар Бойко');
  assert.equal(props.lastModifiedBy, 'Назар Бойко');
  assert.match(props.title ?? '', /Назар Бойко/);
  for (const fingerprint of ['dolanmiu', 'Un-named', 'PDFKit', 'ApplyPack']) {
    assert.equal(bytes.includes(fingerprint), false, `"${fingerprint}" is in the file`);
  }
});

test('the .docx passes the ATS parse check it was built to pass', async () => {
  const warnings = parseWarnings(docxToText(await renderDocx(RESUME, KNOBS)));
  assert.deepEqual(warnings, []);
});

/* ---------- the .pdf ---------- */

test('the .pdf reads back as the resume, Cyrillic included', async () => {
  const text = await pdfToText(await renderPdf(RESUME, KNOBS));
  assert.match(text, /Назар Бойко/, 'the bundled face has the glyphs pdfkit’s built-ins do not');
  assert.match(text, /Senior Software Engineer/);
  assert.match(text, /Built and deployed a cross-platform notification system\./);
  assert.match(text, /Ukrainian \(Native\)/);
});

test('the .pdf names the candidate and no tool', async () => {
  const { getDocumentProxy } = await import('unpdf');
  const doc = await getDocumentProxy(new Uint8Array(await renderPdf(RESUME, KNOBS)));
  const info = (await doc.getMetadata()).info as Record<string, string>;
  assert.equal(info.Producer, '', 'pdfkit writes its own name here by default');
  assert.equal(info.Creator, '');
  assert.equal(info.Author, 'Назар Бойко');
  assert.match(info.Title ?? '', /Назар Бойко/);
  await (doc as { destroy?: () => Promise<void> }).destroy?.();
});

test('the .pdf comes back through style inference as what it was rendered as', async () => {
  const knobs: RenderKnobs = { ...KNOBS, bodyPt: 10, page: 'A4' };
  const style = await inferFromPdf(await renderPdf(RESUME, knobs));
  assert.equal(style.source, 'pdf');
  assert.equal(style.fontFamily, 'Liberation Sans');
  assert.equal(style.bodyPt, 10);
  assert.equal(style.page, 'A4');
  assert.equal(style.nameCentered, true);
});

test('a resume too long for one page gets a second one', async () => {
  const many = JsonResumeSchema.parse({
    ...RESUME,
    work: Array.from({ length: 12 }, (_, i) => ({
      name: `Company ${i}`,
      position: 'Senior Software Engineer',
      startDate: '2015',
      endDate: '2024',
      highlights: Array.from({ length: 4 }, (_, j) => `Shipped feature ${i}-${j} and improved a number that mattered.`),
    })),
  });
  const { getDocumentProxy } = await import('unpdf');
  const doc = await getDocumentProxy(new Uint8Array(await renderPdf(many, KNOBS)));
  assert.ok(doc.numPages > 1, 'hand-positioned lines need their own page breaks');
  const text = await pdfToText(await renderPdf(many, KNOBS));
  assert.match(text, /Shipped feature 11-3/, 'nothing fell off the last page');
  await (doc as { destroy?: () => Promise<void> }).destroy?.();
});

test('an empty structure renders a file rather than throwing', async () => {
  const docx = await renderDocx(emptyResume(), KNOBS);
  assert.ok(docx.length > 0);
  const pdf = await renderPdf(emptyResume(), KNOBS);
  assert.ok(pdf.length > 0);
});

test('typefaceNote says which case the reader is in', () => {
  assert.match(typefaceNote('Arial'), /same letter widths as Arial/);
  assert.match(typefaceNote('Calibri'), /may break differently/);
});
