import { test } from 'node:test';
import assert from 'node:assert/strict';

type At = { line: number; start: number; end: number; cell: boolean };
type Page = { width: number; height: number; top: number; bottom: number; left: number; right: number };

// @ts-expect-error — plain JS with no declaration file; the shape is asserted below.
const mod = import('./public/doc-pane.mjs') as Promise<{
  wordsKey: (s: string) => string;
  changedKeys: (base: string, text: string) => Set<string>;
  fitScale: (available: number, pageWidth: number) => number;
  sheetFit: (available: number, page: { width: number; left: number; right: number }) => { zoom: number; shift: number };
  locateParagraph: (text: string, paragraph: string, occurrence?: number) => At | null;
  rewriteSpan: (text: string, at: At, words: string) => string;
  pageBreaks: (sheetHeight: number, page: Page) => number[];
  printCss: (page: Page) => string;
  fileNameFrom: (header: string | null) => string | null;
  bytesOf: (b64: string) => Uint8Array;
  safeLink: (href: string | null) => string | null;
  styleText: (css: string) => string;
}>;

const TEXT = [
  'Nazar Boyko',
  '## KEY SKILLS',
  'Programming: | PHP, Go, JavaScript',
  '## EXPERIENCE',
  '• Led backend architecture for PHP services.',
  '• Built a payment platform.',
  '• Built a payment platform.',
  'Technology Stack: PHP, Laravel.',
].join('\n');

test('wordsKey reads the words and nothing else', async () => {
  const { wordsKey } = await mod;
  assert.equal(wordsKey('• Led backend, architecture!'), 'ledbackendarchitecture');
  assert.equal(wordsKey('V Shred Austin, Texas ∙ Remote'), wordsKey('V Shred Austin, Texas · Remote'));
  assert.equal(wordsKey('Назар Бойко'), 'назарбойко');
  assert.equal(wordsKey('𝑂(𝑁)'), 'on', 'a formula reads as its letters');
});

test('changedKeys marks the lines the draft changed or added, and each cell of a changed row', async () => {
  const { changedKeys, wordsKey } = await mod;
  const draft = TEXT.replace('PHP, Go, JavaScript', 'PHP, Go, JavaScript, Kafka').replace('• Built a payment platform.\n• Built', '• Built a payment platform.\n• Shipped a notification service.\n• Built');
  const keys = changedKeys(TEXT, draft);
  assert.ok(keys.has(wordsKey('PHP, Go, JavaScript, Kafka')), 'the changed cell');
  assert.ok(keys.has(wordsKey('Shipped a notification service.')), 'the added bullet');
  assert.ok(!keys.has(wordsKey('Led backend architecture for PHP services.')), 'an untouched line');
  assert.ok(!keys.has(wordsKey('Programming:')), 'the untouched cell of a changed row');
});

test('fitScale fits the sheet, never enlarges it, and stops where it would be unreadable', async () => {
  const { fitScale } = await mod;
  assert.equal(fitScale(1200, 800), 1);
  assert.equal(fitScale(400, 800), 0.5);
  assert.equal(fitScale(100, 800), 0.35);
  assert.equal(fitScale(0, 800), 1);
});

test('#589: a pane too narrow for the whole sheet fits its text column, the side margins outside', async () => {
  const { sheetFit } = await mod;
  // The clean version's Letter sheet (0.6 in margins at 96 dpi) in the Tailor page's pane at 1280 px, 436 wide: it drew at 0.48.
  const letter = { width: 816, left: 57.5, right: 57.5 };
  const narrow = sheetFit(436, letter);
  assert.equal(narrow.shift, 57.5);
  assert.equal(narrow.zoom, 436 / (701 + 32));
  // Wide enough for the whole sheet: nothing moves.
  assert.deepEqual(sheetFit(900, letter), { zoom: 1, shift: 0 });
  // A sheet with no margins to leave out is fitted whole.
  assert.deepEqual(sheetFit(424, { width: 816, left: 0, right: 0 }), { zoom: 0.5, shift: 0 });
});

test('locateParagraph finds a bullet behind its marker, the n-th of identical ones, and a table cell', async () => {
  const { locateParagraph } = await mod;
  const bullet = locateParagraph(TEXT, 'Led backend architecture for PHP services.')!;
  assert.equal(TEXT.slice(bullet.start, bullet.end), 'Led backend architecture for PHP services.');
  const second = locateParagraph(TEXT, 'Built a payment platform.', 1)!;
  const first = locateParagraph(TEXT, 'Built a payment platform.', 0)!;
  assert.equal(second.line, first.line + 1);
  const cell = locateParagraph(TEXT, 'PHP, Go, JavaScript')!;
  assert.equal(cell.cell, true);
  assert.equal(TEXT.slice(cell.start, cell.end), 'PHP, Go, JavaScript');
  assert.equal(locateParagraph(TEXT, 'KEY SKILLS')!.line, 1, 'a heading behind its "## "');
  assert.equal(locateParagraph(TEXT, 'Nazar Boyko Led backend'), null, 'a paragraph no line reads');
});

test('rewriteSpan keeps the marker, and an emptied paragraph takes its line with it', async () => {
  const { locateParagraph, rewriteSpan } = await mod;
  const at = locateParagraph(TEXT, 'Led backend architecture for PHP services.')!;
  assert.match(rewriteSpan(TEXT, at, 'Owned the payments backend.'), /^• Owned the payments backend\.$/m);
  const removed = rewriteSpan(TEXT, at, '   ');
  assert.equal(removed.includes('Led backend'), false);
  assert.equal(removed.split('\n').length, TEXT.split('\n').length - 1);
  const last = locateParagraph(TEXT, 'Technology Stack: PHP, Laravel.')!;
  assert.equal(rewriteSpan(TEXT, last, '').endsWith('• Built a payment platform.'), true, 'the last line goes without leaving a newline');
  const cell = locateParagraph(TEXT, 'PHP, Go, JavaScript')!;
  assert.match(rewriteSpan(TEXT, cell, ''), /^Programming: \| $/m, 'a cell is emptied, never removed with its row');
});

test('a bullet the paragraph types as text is written back once, not twice', async () => {
  const { locateParagraph, rewriteSpan } = await mod;
  // The user's own .docx types "• " as text: the pane's paragraph carries it, the span starts after it.
  const at = locateParagraph(TEXT, '• Led backend architecture for PHP services.')!;
  const next = rewriteSpan(TEXT, at, '• Led the backend for PHP services.');
  assert.match(next, /^• Led the backend for PHP services\.$/m);
  assert.equal(next.includes('• •'), false);
});

test('pageBreaks marks where each page would end on the continuous sheet', async () => {
  const { pageBreaks } = await mod;
  const page = { width: 794, height: 1123, top: 48, bottom: 48, left: 58, right: 58 };
  assert.deepEqual(pageBreaks(1000, page), []);
  assert.deepEqual(pageBreaks(2100, page), [1075]);
  assert.deepEqual(pageBreaks(2200, page), [1075, 2102]);
});

test('printCss puts the file’s page and margins on paper and drops the pane’s furniture', async () => {
  const { printCss } = await mod;
  const css = printCss({ width: 816, height: 1056, top: 36, bottom: 36.5, left: 48, right: 48 });
  assert.match(css, /@page \{ size: 816px 1056px; margin: 36px 48px 36\.5px 48px; \}/);
  assert.match(css, /doc-page-guide \{ display: none/);
  assert.match(css, /print-color-adjust: exact/);
});

test('fileNameFrom prefers the UTF-8 name a Cyrillic file needs', async () => {
  const { fileNameFrom } = await mod;
  assert.equal(fileNameFrom(`attachment; filename="Resume.pdf"; filename*=UTF-8''${encodeURIComponent('Назар Бойко.pdf')}`), 'Назар Бойко.pdf');
  assert.equal(fileNameFrom('attachment; filename="Resume.docx"'), 'Resume.docx');
  assert.equal(fileNameFrom(null), null);
});

test('bytesOf decodes what the route encodes', async () => {
  const { bytesOf } = await mod;
  assert.deepEqual([...bytesOf(Buffer.from([80, 75, 3, 4, 255]).toString('base64'))], [80, 75, 3, 4, 255]);
});

test('safeLink keeps a web or mail address and nothing a click could run', async () => {
  const { safeLink } = await mod;
  assert.equal(safeLink('https://linkedin.com/in/x'), 'https://linkedin.com/in/x');
  assert.equal(safeLink('mailto:a@b.co'), 'mailto:a@b.co');
  assert.equal(safeLink('javascript:alert(1)'), null);
  assert.equal(safeLink(' JavaScript:alert(1)'), null);
  assert.equal(safeLink('data:text/html,<script>'), null);
  assert.equal(safeLink(null), null);
});

test('styleText leaves nothing in a stylesheet that could close its element', async () => {
  const { styleText } = await mod;
  const css = '.docx { font-family: "x</style><img src=x onerror=alert(1)>"; }';
  assert.equal(styleText(css).includes('</'), false);
  assert.equal(styleText('p { color: red; }'), 'p { color: red; }');
});

test('locateParagraph finds a paragraph the text broke over lines, and a cell the text keeps on one line', async () => {
  const { locateParagraph, rewriteSpan } = await mod;
  const text = [
    'SUMMARY',
    'Full stack engineer (10+ years) building production PHP/Laravel systems and',
    'Vue.js front ends, at 99.9% uptime.',
    'KEY SKILLS',
    'Programming: PHP, Go, JavaScript, TypeScript',
    'EXPERIENCE',
    'V Shred Austin, Texas, US ∙ Remote',
  ].join('\n');
  const summary = locateParagraph(text, 'Full stack engineer (10+ years) building production PHP/Laravel systems and Vue.js front ends, at 99.9% uptime.')!;
  assert.ok(summary, 'two lines read as one paragraph');
  const rewritten = rewriteSpan(text, summary, 'Full stack engineer (10+ years) owning PHP/Laravel and Vue.js systems.');
  assert.match(rewritten, /^SUMMARY\nFull stack engineer \(10\+ years\) owning PHP\/Laravel and Vue\.js systems\.\nKEY SKILLS$/m, 'one line now');
  // The clean version draws "Programming:" and its values as two cells of a table row.
  const values = locateParagraph(text, 'PHP, Go, JavaScript, TypeScript')!;
  assert.equal(text.slice(values.start, values.end), 'PHP, Go, JavaScript, TypeScript');
  assert.match(rewriteSpan(text, values, 'PHP, Go, JavaScript, TypeScript, Kafka'), /^Programming: PHP, Go, JavaScript, TypeScript, Kafka$/m);
  const label = locateParagraph(text, 'Programming:')!;
  assert.equal(text.slice(label.start, label.end), 'Programming:');
  assert.match(rewriteSpan(text, label, 'Languages:'), /^Languages: PHP, Go/m);
  // Whole words only.
  assert.equal(locateParagraph('The brothers built it.\nOthers: Jira, Blade', 'Others:')!.line, 1);
  // A company line the clean version sets on a tab reads as the whole line, and a tab written back as " | ".
  const company = locateParagraph(text, 'V Shred Austin, Texas, US ∙ Remote')!;
  assert.match(rewriteSpan(text, company, 'V Shred Inc. | Austin, Texas, US ∙ Remote'), /^V Shred Inc\. \| Austin, Texas, US ∙ Remote$/m);
});
