import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingLinkMessage } from './profile-links';

test('both links intact — the save goes through', () => {
  assert.equal(missingLinkMessage({ resumeGone: false, notificationTargetGone: false }), null);
});

test('a resume deleted in another tab is named, not thrown', () => {
  const msg = missingLinkMessage({ resumeGone: true, notificationTargetGone: false });
  assert.match(msg ?? '', /resume no longer exists/);
  assert.match(msg ?? '', /Nothing was saved/);
});

test('a deleted alert target says which one it was', () => {
  const msg = missingLinkMessage({ resumeGone: false, notificationTargetGone: true });
  assert.match(msg ?? '', /alert target no longer exists/);
});

test('both gone at once is one sentence, not two flashes', () => {
  const msg = missingLinkMessage({ resumeGone: true, notificationTargetGone: true });
  assert.match(msg ?? '', /resume and that alert target/);
});
