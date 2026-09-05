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

test('the draft notice names the file and says the AI check follows', () => {
  const text = instantCheckNotice('cv-v3.pdf', 24);
  assert.match(text, /"cv-v3\.pdf" opened in the editor in 24 ms/);
  assert.match(text, /runs in the background/);
  assert.match(unchangedNotice('cv.pdf', '3m ago'), /"cv\.pdf" has the same text .* \(3m ago\)/);
});

test('a stashed draft loads only over the match it was checked against', () => {
  assert.equal(draftTextForPage({ matchId: 55, text: 'new' }, 55), 'new');
  assert.equal(draftTextForPage({ matchId: 55, text: 'new' }, 46), null);
  assert.equal(draftTextForPage(null, 55), null);
});
