import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withLocale } from '../i18n/locale';
import { VERDICTS } from '../verification/prompts';
import { jobTabLabels } from './job-tabs';
import { signalWord, verdictWord } from './verify-words';

test('every verdict the verifier may answer with has a word, in each language', () => {
  for (const verdict of VERDICTS) assert.ok(verdictWord(verdict), verdict);
  withLocale('uk', () => {
    assert.equal(verdictWord('fake'), 'фейк');
    assert.equal(signalWord('ghost'), 'може бути вакансією-привидом');
  });
  assert.equal(verdictWord('FAKE'), 'fake');
});

test('a word outside the lists is left for the page to show as written', () => {
  assert.equal(verdictWord('likely_real'), null);
  assert.equal(signalWord('odd'), null);
});

test('the tab label carries the verdict in the reader’s language', () => {
  const label = (verdict: string) => jobTabLabels({ matchScore: null, letters: 0, verdict, pack: null, questions: 0 }).find((x) => x.tab === 'verify')?.label;
  assert.equal(label('fake'), 'Is it real? · fake');
  withLocale('uk', () => assert.match(label('fake') ?? '', /фейк$/));
  assert.equal(label('likely_real'), 'Is it real? · likely real');
});
