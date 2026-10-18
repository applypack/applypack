import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packBusy, packFact, packLine, packNoticeLines, preparingLine, readPackEdits, unplacedLines, type PackNotice } from './view';

const notice = (over: Partial<PackNotice> = {}): PackNotice => ({
  jobId: 12,
  title: 'Senior Laravel Engineer',
  company: 'Acme',
  status: 'ready',
  stop: null,
  scoreBefore: 76,
  scoreAfter: 100,
  verdict: 'legit',
  recommendation: 'apply',
  ...over,
});

/** The message's words alone, the way the tests before links read it. */
const texts = (packs: PackNotice[]): string[] => packNoticeLines(packs).map((l) => l.text);

test('the edits column reads back whole, and anything else reads as nothing done', () => {
  const stored = { applied: 4, unplaced: ['not-found'], held: [{ section: 'summary', where: 'Summary', reason: 'drops-figure' }], checks: [] };
  assert.deepEqual(readPackEdits(stored), stored);
  assert.deepEqual(readPackEdits(null), { applied: 0, unplaced: [], held: [], checks: [] });
  assert.deepEqual(readPackEdits({ applied: 'many', held: [{ reason: 'because' }] }), { applied: 0, unplaced: [], held: [], checks: [] });
});

test('the tab says what stands behind it', () => {
  assert.equal(packFact(null), null);
  assert.equal(packFact({ status: 'queued', sentAt: null }), 'preparing');
  assert.equal(packFact({ status: 'running', sentAt: null }), 'preparing');
  assert.equal(packFact({ status: 'ready', sentAt: null }), 'ready');
  assert.equal(packFact({ status: 'stopped', sentAt: null }), 'not worth it');
  assert.equal(packFact({ status: 'failed', sentAt: null }), 'failed');
  assert.equal(packFact({ status: 'ready', sentAt: new Date() }), 'sent');
});

test('a pack is told by its score and the company verdict', () => {
  assert.equal(packLine(notice()), 'match 76 → 100 · company legit, apply');
  assert.equal(packLine(notice({ scoreAfter: 76 })), 'match 76 · company legit, apply');
  assert.equal(packLine(notice({ scoreAfter: null, verdict: null, recommendation: null })), 'match 76 · company not checked');
  assert.equal(packLine(notice({ scoreBefore: null, scoreAfter: null })), 'company legit, apply');
});

test('one message: the ready packs, then the postings to skip', () => {
  assert.deepEqual(texts([notice(), notice({ title: 'Go Developer', company: 'Bright', status: 'stopped', stop: 'failed-gate' })]), [
    'An application pack is ready:',
    '• Senior Laravel Engineer — Acme (match 76 → 100 · company legit, apply)',
    'Open the job in ApplyPack → Application pack: read the edits, download the resume, apply.',
    '',
    'Not worth your time:',
    '• Go Developer — Bright: the posting requires something the resume does not show',
  ]);
  assert.deepEqual(texts([notice({ status: 'stopped', stop: 'closed' }), notice({ status: 'stopped', stop: 'paused' })]), [
    'Not worth your time (2):',
    '• Senior Laravel Engineer — Acme: the posting is closed',
    '• Senior Laravel Engineer — Acme: stopped',
  ]);
});

test('a pack that could not be prepared is said, not passed over (#381)', () => {
  // Five failed rows a day and no word about them: the message listed ready and stopped packs only.
  assert.deepEqual(texts([notice({ status: 'failed' })]), ['One could not be prepared — open the job to see why:', '• Senior Laravel Engineer — Acme']);
  assert.deepEqual(texts([notice(), notice({ title: 'Go Developer', company: 'Bright', status: 'failed' }), notice({ title: 'QA Lead', company: 'Corex', status: 'failed' })]), [
    'An application pack is ready:',
    '• Senior Laravel Engineer — Acme (match 76 → 100 · company legit, apply)',
    'Open the job in ApplyPack → Application pack: read the edits, download the resume, apply.',
    '',
    '2 could not be prepared — open each job to see why:',
    '• Go Developer — Bright',
    '• QA Lead — Corex',
  ]);
});

test('with the dashboard address, every pack line links to its tab, and only those (#487)', () => {
  const packs = [notice(), notice({ jobId: 30, status: 'stopped', stop: 'closed' }), notice({ jobId: 31, status: 'failed' })];
  const lines = packNoticeLines(packs, 'https://ap.example.com/ui');
  assert.deepEqual(
    lines.filter((l) => l.link !== null).map((l) => l.link),
    ['https://ap.example.com/ui/jobs/12?tab=pack', 'https://ap.example.com/ui/jobs/30?tab=pack', 'https://ap.example.com/ui/jobs/31?tab=pack'],
  );
  assert.ok(lines.filter((l) => l.link !== null).every((l) => l.text.startsWith('• ')));
  // Without it the message is the one it always was.
  assert.ok(packNoticeLines(packs).every((l) => l.link === null));
  assert.deepEqual(packNoticeLines(packs).map((l) => l.text), lines.map((l) => l.text));
});

test('a long wait lists the first eight and counts the rest', () => {
  const lines = texts(Array.from({ length: 11 }, (_, i) => notice({ title: `Role ${i}` })));
  assert.equal(lines[0], '11 application packs are ready:');
  assert.equal(lines.filter((l) => l.startsWith('• ')).length, 8);
  assert.equal(lines[9], '…and 3 more.');
});

test('a pack in the queue or in flight says where it is, in one sentence', () => {
  assert.equal(preparingLine({ status: 'queued', step: null }), 'Queued — the worker starts it within a minute. This page refreshes itself; you can leave it.');
  assert.match(preparingLine({ status: 'running', step: 'verify' }), /… This page refreshes itself; you can leave it\.$/);
  // A step this version does not know is still "Preparing".
  assert.equal(preparingLine({ status: 'running', step: 'something-new' }), 'Preparing… This page refreshes itself; you can leave it.');
  assert.deepEqual(['queued', 'running', 'ready', 'stopped', 'failed'].map((status) => packBusy({ status })), [true, true, false, false, false]);
  assert.equal(packBusy(null), false);
});

test('unplacedLines: an edit that was not made says its own reason (#384)', () => {
  assert.deepEqual(unplacedLines([]), []);
  // The one sentence the card had is true of one error only.
  assert.deepEqual(unplacedLines(['not-found', 'not-found']), ['2 edits could not be placed: the text it quoted is not in the resume as written.']);
  assert.deepEqual(unplacedLines(['not-found', 'protected', 'no-replacement', 'protected']), [
    '1 edit could not be placed: the text it quoted is not in the resume as written.',
    '2 edits were not made: their lines carry your email or phone.',
    '1 edit was not made: it had no wording to paste.',
  ]);
  // An error this file has never heard of is still counted, without a reason it cannot give.
  assert.deepEqual(unplacedLines(['moved-on', 'something-new']), ['2 edits could not be made.']);
});
