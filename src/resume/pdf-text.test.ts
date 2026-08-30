import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { ResumeTextError } from './docx-text';
import { pdfToText } from './pdf-text';
import { extractResumeText } from './resume-text';

/*
 * Fixtures are hand-built minimal PDFs (no xref table — pdf.js falls back to
 * scanning all objects, which is exactly the resilience we rely on for
 * real-world exports).
 */

function buildPdf(lines: string[], opts: { compress?: boolean } = {}): Buffer {
  const ops = ['BT /F1 12 Tf 72 720 Td']
    .concat(lines.map((l, i) => `${i > 0 ? '0 -14 Td ' : ''}(${l}) Tj`))
    .concat(['ET'])
    .join('\n');
  const raw = Buffer.from(ops, 'latin1');
  const stream = opts.compress ? deflateSync(raw) : raw;
  const filter = opts.compress ? '/Filter/FlateDecode' : '';
  const head = Buffer.from(
    '%PDF-1.4\n' +
      '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
      '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R' +
      '/Resources<</Font<</F1 5 0 R>>>>>>endobj\n' +
      `4 0 obj<</Length ${stream.length}${filter}>>stream\n`,
    'latin1',
  );
  const tail = Buffer.from(
    '\nendstream endobj\n' +
      '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n' +
      'trailer<</Root 1 0 R>>\n%%EOF',
    'latin1',
  );
  return Buffer.concat([head, stream, tail]);
}

const RESUME_LINES = [
  'Alex Doe - Senior Software Engineer',
  'Ten years of PHP, Laravel and TypeScript in production.',
  'Built payment, CRM and e-commerce platforms end to end.',
  'PostgreSQL, Redis, Docker, AWS; CI/CD and observability.',
  'Led migrations from legacy monoliths to tested services.',
  'Open to senior full-stack and backend roles, remote US.',
];

test('pdfToText extracts multi-line text from an uncompressed PDF', async () => {
  const text = await pdfToText(buildPdf(RESUME_LINES));
  assert.ok(text.includes('Senior Software Engineer'));
  assert.ok(text.includes('PostgreSQL, Redis, Docker'));
  // Lines stay separated — the target view and keyword matcher need tokens intact.
  assert.ok(!text.includes('production.Built'));
});

test('pdfToText handles FlateDecode-compressed content streams', async () => {
  const text = await pdfToText(buildPdf(RESUME_LINES, { compress: true }));
  assert.ok(text.includes('Laravel and TypeScript'));
});

test('pdfToText rejects a file that is not a PDF', async () => {
  await assert.rejects(
    () => pdfToText(Buffer.from('this is definitely not a pdf, just bytes')),
    (err: unknown) => err instanceof ResumeTextError && /not a readable PDF/.test(err.message),
  );
});

test('pdfToText explains a text-free PDF (scanned image) instead of accepting it', async () => {
  await assert.rejects(
    () => pdfToText(buildPdf(['Too short'])),
    (err: unknown) => err instanceof ResumeTextError && /scanned image/.test(err.message),
  );
});

test('extractResumeText routes .pdf files to the PDF extractor', async () => {
  const text = await extractResumeText('resume.PDF', buildPdf(RESUME_LINES));
  assert.ok(text.includes('Senior Software Engineer'));
});

test('extractResumeText lists .pdf among supported types in the error', async () => {
  await assert.rejects(
    () => extractResumeText('resume.rtf', Buffer.from('x')),
    (err: unknown) => err instanceof ResumeTextError && err.message.includes('.pdf'),
  );
});
