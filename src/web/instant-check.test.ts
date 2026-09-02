import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideInstantCheck, draftTextForPage, instantCheckNotice, unchangedNotice } from './instant-check';

const frame = { id: 55, resumeText: 'Senior PHP engineer\nLaravel, Vue', createdAt: new Date('2026-09-02T13:08:11Z') };

test('no frame means the full analysis', () => {
  assert.deepEqual(decideInstantCheck(null, 'anything'), { kind: 'analyze' });
});

test('the analysed text is unchanged, anything else is a draft', () => {
  assert.deepEqual(decideInstantCheck(frame, frame.resumeText), { kind: 'unchanged', frame });
  assert.equal(decideInstantCheck(frame, frame.resumeText + '\nReact').kind, 'draft');
  assert.equal(decideInstantCheck(frame, frame.resumeText + '\n').kind, 'draft', 'a whitespace edit is a draft');
});

test('the draft notice names the file, the frame and the inherited statuses', () => {
  const text = instantCheckNotice('cv-v3.pdf', '2h ago', 24);
  assert.match(text, /"cv-v3\.pdf" checked in 24 ms — no AI call/);
  assert.match(text, /analysis from 2h ago/);
  assert.match(text, /confirms what is present/);
  assert.match(text, /add \/ confirm \/ can't-claim keep the AI's verdict/);
  assert.match(unchangedNotice('cv.pdf', '3m ago'), /"cv\.pdf" has the same text .* \(3m ago\)/);
});

test('a stashed draft loads only over the match it was checked against', () => {
  assert.equal(draftTextForPage({ matchId: 55, text: 'new' }, 55), 'new');
  assert.equal(draftTextForPage({ matchId: 55, text: 'new' }, 46), null);
  assert.equal(draftTextForPage(null, 55), null);
});
