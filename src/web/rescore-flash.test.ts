import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rescoreFlash } from './rescore-flash';

const was = (status: 'ALERTED' | 'NEW' | 'SAVED', fitScore: number | null = 72) => ({ status, fitScore });

test('a verdict that was formed says its score, so the same number is not a press that did nothing (#544)', () => {
  assert.deepEqual(rescoreFlash({ kind: 'scored', status: 'ALERTED', fitScore: 72 }, was('ALERTED')), { kind: 'ok', text: 'Scored again: 72, as before.' });
  assert.equal(rescoreFlash({ kind: 'scored', status: 'DISMISSED', fitScore: 41 }, was('NEW')).text, 'Scored again: 41; it was 72.');
  assert.equal(rescoreFlash({ kind: 'scored', status: 'NEW', fitScore: 88 }, was('NEW', null)).text, 'Scored: 88.');
});

test('a re-score no engine answered says what failed, what is safe and the way forward', () => {
  assert.deepEqual(rescoreFlash({ kind: 'failed', reason: 'Claude Code CLI: the sign-in was refused' }, was('ALERTED')), {
    kind: 'err',
    text: 'This posting was not scored again: Claude Code CLI: the sign-in was refused. Its verdict is as it was. Check the engine under Settings → AI & costs, then press Re-classify again.',
  });
  // With no reason from the engine, the web log is where the detail is.
  assert.match(rescoreFlash({ kind: 'failed', reason: '' }, was('ALERTED')).text, /^This posting was not scored again\. Its verdict is as it was\..* The web log has the detail\.$/);
});

test('a posting the prefilter turned away says so, and what became of its status', () => {
  const said = (after: 'ALERTED' | 'DISMISSED' | 'SAVED', before: 'ALERTED' | 'NEW' | 'SAVED') => rescoreFlash({ kind: 'prefiltered', status: after }, was(before));
  assert.equal(said('DISMISSED', 'ALERTED').kind, 'warn');
  assert.match(said('DISMISSED', 'ALERTED').text, /turned this posting away at its quick first pass.*The job is now Dismissed/);
  // A pasted or saved posting is never dismissed by a score: it is kept Saved.
  assert.match(said('SAVED', 'NEW').text, /You chose this posting yourself, so it is kept as Saved\.$/);
  // Applied and Saved are the person's own word and do not move.
  assert.match(said('SAVED', 'SAVED').text, /Its status is as it was\.$/);
});

test('with no search to score against, the press says where to fill one in', () => {
  assert.deepEqual(rescoreFlash({ kind: 'no-search' }, was('NEW')).kind, 'warn');
  assert.match(rescoreFlash({ kind: 'no-search' }, was('NEW')).text, /no running search has a stack or role types.*Settings → Job search/);
});
