import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packFact, packLine, packNoticeLines, readPackEdits, type PackNotice } from './view';

const notice = (over: Partial<PackNotice> = {}): PackNotice => ({
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
  assert.deepEqual(packNoticeLines([notice(), notice({ title: 'Go Developer', company: 'Bright', status: 'stopped', stop: 'failed-gate' })]), [
    'An application pack is ready:',
    '• Senior Laravel Engineer — Acme (match 76 → 100 · company legit, apply)',
    'Open the job in ApplyPack → Application pack: read the edits, download the resume, apply.',
    '',
    'Not worth your time:',
    '• Go Developer — Bright: the posting requires something the resume does not show',
  ]);
  assert.deepEqual(packNoticeLines([notice({ status: 'stopped', stop: 'closed' }), notice({ status: 'stopped', stop: 'paused' })]), [
    'Not worth your time (2):',
    '• Senior Laravel Engineer — Acme: the posting is closed',
    '• Senior Laravel Engineer — Acme: stopped',
  ]);
});

test('a pack that could not be prepared is said, not passed over (#381)', () => {
  // Five failed rows a day and no word about them: the message listed ready and stopped packs only.
  assert.deepEqual(packNoticeLines([notice({ status: 'failed' })]), ['One could not be prepared — open the job to see why:', '• Senior Laravel Engineer — Acme']);
  assert.deepEqual(packNoticeLines([notice(), notice({ title: 'Go Developer', company: 'Bright', status: 'failed' }), notice({ title: 'QA Lead', company: 'Corex', status: 'failed' })]), [
    'An application pack is ready:',
    '• Senior Laravel Engineer — Acme (match 76 → 100 · company legit, apply)',
    'Open the job in ApplyPack → Application pack: read the edits, download the resume, apply.',
    '',
    '2 could not be prepared — open each job to see why:',
    '• Go Developer — Bright',
    '• QA Lead — Corex',
  ]);
});

test('a long wait lists the first eight and counts the rest', () => {
  const lines = packNoticeLines(Array.from({ length: 11 }, (_, i) => notice({ title: `Role ${i}` })));
  assert.equal(lines[0], '11 application packs are ready:');
  assert.equal(lines.filter((l) => l.startsWith('• ')).length, 8);
  assert.equal(lines[9], '…and 3 more.');
});
