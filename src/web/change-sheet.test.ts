import { test } from 'node:test';
import assert from 'node:assert/strict';

// Both modules ship to the browser as static ES modules; node loads them the same way.
// @ts-expect-error — plain JS with no declaration file; the shape is asserted below.
const lineDiff = import('./public/line-diff.mjs') as Promise<{
  diffLines: (
    before: string,
    after: string,
  ) => { op: 'keep' | 'change' | 'delete' | 'insert'; a?: { i: number; text: string }; b?: { i: number; text: string } }[];
}>;

// @ts-expect-error — plain JS with no declaration file.
const sheet = import('./public/change-sheet.mjs') as Promise<{
  formatEditSheet: (
    heading: { jobTitle: string; companyName: string; resumeName: string },
    before: string,
    after: string,
  ) => string | null;
}>;

// @ts-expect-error — plain JS with no declaration file.
const copy = import('./public/copy.mjs') as Promise<Record<string, unknown>>;

const ops = (d: { op: string }[]) => d.map((x) => x.op);

test('diffLines reports an unchanged text as all keeps', async () => {
  const { diffLines } = await lineDiff;
  const text = 'Summary\n\nBuilt payment systems.\nLed code review.';
  assert.deepEqual(ops(diffLines(text, text)), ['keep', 'keep', 'keep', 'keep']);
});

test('diffLines pairs a delete followed by an insert into one change', async () => {
  const { diffLines } = await lineDiff;
  const d = diffLines('Alpha\nBravo\nCharlie', 'Alpha\nBravo reworded\nCharlie');
  assert.deepEqual(ops(d), ['keep', 'change', 'keep']);
  assert.equal(d[1]!.a?.text, 'Bravo');
  assert.equal(d[1]!.b?.text, 'Bravo reworded');
  assert.equal(d[1]!.a?.i, 1, 'line indexes are 0-based on each side');
  assert.equal(d[1]!.b?.i, 1);
});

test('diffLines separates a pure insert from a pure delete', async () => {
  const { diffLines } = await lineDiff;
  assert.deepEqual(ops(diffLines('Alpha\nCharlie', 'Alpha\nBravo\nCharlie')), ['keep', 'insert', 'keep']);
  assert.deepEqual(ops(diffLines('Alpha\nBravo\nCharlie', 'Alpha\nCharlie')), ['keep', 'delete', 'keep']);
});

test('diffLines reads a moved line as one delete and one insert, not a change', async () => {
  const { diffLines } = await lineDiff;
  // Documented behaviour, not an accident: nothing here tracks identity across a move.
  const d = diffLines('- first\n- second\n- third', '- second\n- third\n- first');
  assert.deepEqual(ops(d), ['delete', 'keep', 'keep', 'insert']);
  assert.equal(d[0]!.a?.text, '- first');
  assert.equal(d[3]!.b?.text, '- first');
});

test('diffLines ignores re-indentation and doubled spaces but keeps the original text', async () => {
  const { diffLines } = await lineDiff;
  const d = diffLines('  Built  payment systems.', 'Built payment systems.');
  assert.deepEqual(ops(d), ['keep']);
  assert.equal(d[0]!.a?.text, '  Built  payment systems.', 'the op carries what is on screen');
});

test('diffLines treats a lost blank line as a change to the document', async () => {
  const { diffLines } = await lineDiff;
  assert.deepEqual(ops(diffLines('Alpha\n\nBravo', 'Alpha\nBravo')), ['keep', 'delete', 'keep']);
});

test('diffLines handles an empty side', async () => {
  const { diffLines } = await lineDiff;
  // An empty text is still one (blank) line, so it shows up as such on either side.
  assert.deepEqual(ops(diffLines('', 'Alpha')), ['delete', 'insert'], 'nothing in common is not a rewrite');
  assert.deepEqual(ops(diffLines('Alpha\nBravo', '')), ['delete', 'delete', 'insert']);
});

const HEADING = { jobTitle: 'Back end Developer', companyName: 'Acme', resumeName: 'Nazar CV v3' };

test('formatEditSheet returns null when nothing was edited', async () => {
  const { formatEditSheet } = await sheet;
  assert.equal(formatEditSheet(HEADING, 'Alpha\nBravo', 'Alpha\nBravo'), null);
  assert.equal(formatEditSheet(HEADING, 'Alpha\nBravo', ' Alpha \nBravo'), null, 'whitespace alone is not an edit');
});

test('formatEditSheet writes Was/Now for a rework and names added and removed lines', async () => {
  const { formatEditSheet } = await sheet;
  const md = formatEditSheet(
    HEADING,
    'Senior Backend Engineer\nBuilt payment systems.\nDrop me.',
    'Senior Backend Engineer\nBuilt PHP/Laravel payment systems at 99.9% uptime.\nBrand new line.',
  );
  assert.ok(md);
  assert.match(md!, /^# My resume edits — Back end Developer at Acme$/m);
  assert.match(md!, /^Resume: Nazar CV v3$/m);
  assert.match(md!, /1 reworded, 1 added, 1 removed/);
  assert.match(md!, /A line moved elsewhere reads as one removed and one added\./);
  assert.match(md!, /^### 1\. Reworded — line 2$/m);
  assert.match(md!, /^\*\*Was:\*\*$/m);
  assert.match(md!, /^> Built payment systems\.$/m);
  assert.match(md!, /^\*\*Now:\*\*$/m);
  assert.match(md!, /^> Built PHP\/Laravel payment systems at 99\.9% uptime\.$/m);
  assert.match(md!, /^### 2\. Removed — line 3$/m);
  assert.match(md!, /^> Drop me\.$/m);
  assert.match(md!, /^### 3\. Added — line 3$/m);
  assert.match(md!, /^> Brand new line\.$/m);
  assert.equal(md!.includes('\n\n\n'), false, 'no triple blank lines');
});

test('formatEditSheet names a blank line instead of quoting nothing', async () => {
  const { formatEditSheet } = await sheet;
  const md = formatEditSheet(HEADING, 'Alpha\n\nBravo', 'Alpha\nBravo');
  assert.match(md!, /^> \(blank line\)$/m);
});

test('copy module loads without a DOM and exposes the clipboard helpers', async () => {
  const mod = await copy;
  for (const name of ['wireCopy', 'copyToClipboard', 'flashCopied', 'copyFrom', 'announce']) {
    assert.equal(typeof mod[name], 'function', name);
  }
});

test('wireCopy listens once per root, so a page that boots it twice copies once', async () => {
  const { wireCopy } = (await copy) as { wireCopy: (root: unknown) => void };
  // /jobs/:id boots this module itself and again through the cover-letter card.
  let listeners = 0;
  const root = { addEventListener: () => listeners++ };
  wireCopy(root);
  wireCopy(root);
  assert.equal(listeners, 1);
});

test('copyToClipboard refuses empty text rather than clearing the clipboard', async () => {
  const { copyToClipboard } = (await copy) as { copyToClipboard: (t: string) => Promise<boolean> };
  assert.equal(await copyToClipboard(''), false);
});
