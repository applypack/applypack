import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMatchMode, readMatchMode, storedBreakdown, withSuggestionsMode } from './match-mode';
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

test('storedBreakdown carries the score parts and both markers', () => {
  const bd = scoreMatch([], null, 0);
  const stored = storedBreakdown(bd, { promptVersion: 6, mode: 'fast' });
  assert.equal(stored.score, bd.score);
  assert.equal(stored.promptVersion, 6);
  assert.equal(stored.mode, 'fast');
  assert.equal(readMatchMode(stored), 'fast');
});

test('withSuggestionsMode flips a stored JSON to full and keeps everything else', () => {
  const next = withSuggestionsMode({ v: 3, score: 66, promptVersion: 6, mode: 'fast' });
  assert.deepEqual(next, { v: 3, score: 66, promptVersion: 6, mode: 'full' });
  assert.deepEqual(withSuggestionsMode(null), { mode: 'full' });
});
