import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rescoreFlash } from './rescore-flash';

test('a verdict that was formed needs no word: the page shows it', () => {
  assert.equal(rescoreFlash({ kind: 'scored', status: 'ALERTED' }, 'ALERTED'), null);
  assert.equal(rescoreFlash({ kind: 'scored', status: 'DISMISSED' }, 'NEW'), null);
});

test('a re-score no engine answered says what failed, what is safe and the way forward', () => {
  assert.deepEqual(rescoreFlash({ kind: 'failed', reason: 'Claude Code CLI: the sign-in was refused' }, 'ALERTED'), {
    kind: 'err',
    text: 'This posting was not scored again: Claude Code CLI: the sign-in was refused. Its verdict is as it was. Check the engine under Settings → AI & costs, then press Re-classify again.',
  });
  // With no reason from the engine, the web log is where the detail is.
  assert.match(rescoreFlash({ kind: 'failed', reason: '' }, 'ALERTED')!.text, /^This posting was not scored again\. Its verdict is as it was\..* The web log has the detail\.$/);
});

test('a posting the prefilter turned away says so, and what became of its status', () => {
  const said = (after: 'ALERTED' | 'DISMISSED' | 'SAVED', before: 'ALERTED' | 'NEW' | 'SAVED') => rescoreFlash({ kind: 'prefiltered', status: after }, before);
  assert.equal(said('DISMISSED', 'ALERTED')?.kind, 'warn');
  assert.match(said('DISMISSED', 'ALERTED')!.text, /turned this posting away at its quick first pass.*The job is now Dismissed/);
  // A pasted or saved posting is never dismissed by a score: it is kept Saved.
  assert.match(said('SAVED', 'NEW')!.text, /You chose this posting yourself, so it is kept as Saved\.$/);
  // Applied and Saved are the person's own word and do not move.
  assert.match(said('SAVED', 'SAVED')!.text, /Its status is as it was\.$/);
});

test('with no search to score against, the press says where to fill one in', () => {
  assert.deepEqual(rescoreFlash({ kind: 'no-search' }, 'NEW')?.kind, 'warn');
  assert.match(rescoreFlash({ kind: 'no-search' }, 'NEW')!.text, /no running search has a stack or role types.*Settings → Job search/);
});
