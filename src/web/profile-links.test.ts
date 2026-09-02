import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingLinkMessage } from './profile-links';

test('both links intact — the save goes through', () => {
  assert.equal(missingLinkMessage({ resumeGone: false, telegramTargetGone: false }), null);
});

test('a resume deleted in another tab is named, not thrown', () => {
  const msg = missingLinkMessage({ resumeGone: true, telegramTargetGone: false });
  assert.match(msg ?? '', /resume no longer exists/);
  assert.match(msg ?? '', /Nothing was saved/);
});

test('a deleted Telegram target says which one it was', () => {
  const msg = missingLinkMessage({ resumeGone: false, telegramTargetGone: true });
  assert.match(msg ?? '', /Telegram target no longer exists/);
});

test('both gone at once is one sentence, not two flashes', () => {
  const msg = missingLinkMessage({ resumeGone: true, telegramTargetGone: true });
  assert.match(msg ?? '', /resume and that Telegram target/);
});
