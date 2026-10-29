import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFrameReason } from './keyword-frame';
import { readMatchEvidence, parseMatchMode, readMatchMode, storedBreakdown, strengthsReport, withSuggestionsMode } from './match-mode';
import { scoreMatch } from './score';

test('parseMatchMode: only an explicit "full" upgrades; everything else is the quick check', () => {
  assert.equal(parseMatchMode('full'), 'full');
  assert.equal(parseMatchMode('fast'), 'fast');
  assert.equal(parseMatchMode(undefined), 'fast');
  assert.equal(parseMatchMode('FULL'), 'fast');
  assert.equal(parseMatchMode(['full']), 'fast');
});

test('readMatchMode: the marker, and "full" for rows written before it', () => {
  assert.equal(readMatchMode({ v: 3, score: 66, promptVersion: 6, mode: 'fast' }), 'fast');
  assert.equal(readMatchMode({ v: 3, score: 66, promptVersion: 6, mode: 'full' }), 'full');
  assert.equal(readMatchMode({ v: 3, score: 66, promptVersion: 5 }), 'full', 'pre-marker rows carried suggestions');
  assert.equal(readMatchMode({ mode: 'quick' }), 'full', 'an unknown marker is not a fast row');
  assert.equal(readMatchMode(null), 'full');
});

test('storedBreakdown carries the score parts and all five markers', () => {
  const bd = scoreMatch([], null, 0);
  const stored = storedBreakdown(bd, { promptVersion: 6, mode: 'fast', frame: 'rebuild', verificationId: 12, evidence: 'text' });
  assert.equal(stored.score, bd.score);
  assert.equal(stored.promptVersion, 6);
  assert.equal(stored.mode, 'fast');
  assert.equal(stored.frame, 'rebuild');
  assert.equal(stored.verificationId, 12);
  assert.equal(readMatchMode(stored), 'fast');
  assert.equal(readFrameReason(stored), 'rebuild');
  assert.equal(readMatchEvidence(stored), 'text');
  // A row from before the marker used the owner's evidence (R1).
  assert.equal(readMatchEvidence({ mode: 'full' }), 'own');
  assert.equal(storedBreakdown(bd, { promptVersion: 6, mode: 'fast', frame: null, verificationId: null, evidence: 'own' }).verificationId, null);
});

test('withSuggestionsMode flips a stored JSON to full, stamps the verification and keeps everything else', () => {
  const next = withSuggestionsMode({ v: 3, score: 66, promptVersion: 6, mode: 'fast' }, 12);
  assert.deepEqual(next, { v: 3, score: 66, promptVersion: 6, mode: 'full', verificationId: 12 });
  assert.deepEqual(withSuggestionsMode(null, null), { mode: 'full', verificationId: null });
});

test('a letter after Save as vN reads the strengths of the report the edits came from (#642)', () => {
  const row = (id: number, mode: 'fast' | 'full', strengths: string[], resumeId = 1) => ({ id, resumeId, strengths, breakdown: { mode } });
  const saved = row(12, 'fast', []);
  const tailored = row(10, 'full', ['Owns the payments ledger']);
  assert.equal(strengthsReport(saved, [saved, row(11, 'full', ['x'], 2), tailored], false), tailored, 'the newest full report of the same resume, older than the quick check');
  assert.equal(strengthsReport(tailored, [], false), tailored, 'a full report is its own');
  assert.equal(strengthsReport(saved, [saved, row(11, 'fast', [])], false), null, 'no full report: nothing to lend');
  assert.equal(strengthsReport(saved, [row(14, 'full', ['later'])], false), null, 'a report written after the quick check is not what it was tailored from');
  assert.equal(strengthsReport(saved, [tailored], true), null, "a one-off file's earlier texts were other files");
});
