import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  answerFor,
  answerLines,
  MAX_ANSWERS,
  MAX_ANSWER_CHARS,
  readAnswers,
  unansweredAsks,
  upsertAnswer,
} from './answers';

const AT = new Date('2026-09-02T18:00:00Z');
const Q = 'how many requests per day did that service handle?';

describe('readAnswers', () => {
  it('reads what upsertAnswer wrote', () => {
    const stored = upsertAnswer([], Q, '1.2M', AT);
    assert.deepEqual(readAnswers(stored), [
      { question: Q, answer: '1.2M', answeredAt: AT.toISOString() },
    ]);
  });

  it('a hand-edited row degrades to nothing answered rather than throwing', () => {
    assert.deepEqual(readAnswers(null), []);
    assert.deepEqual(readAnswers('nonsense'), []);
    assert.deepEqual(readAnswers([{ question: 1, answer: [] }]), []);
  });

  it('drops half-written entries — a question with no answer says nothing', () => {
    const raw = [
      { question: Q, answer: '   ', answeredAt: AT.toISOString() },
      { question: '  ', answer: '1.2M', answeredAt: AT.toISOString() },
    ];
    assert.deepEqual(readAnswers(raw), []);
  });

  it('clips an answer instead of storing an essay', () => {
    const raw = [{ question: Q, answer: 'x'.repeat(MAX_ANSWER_CHARS + 50), answeredAt: '' }];
    assert.equal(readAnswers(raw)[0]?.answer.length, MAX_ANSWER_CHARS);
  });
});

describe('upsertAnswer', () => {
  it('a corrected figure replaces the old one — both must never reach the prompt', () => {
    const once = upsertAnswer([], Q, '1.2M', AT);
    const twice = upsertAnswer(once, Q, '2.4M', AT);
    assert.equal(twice.length, 1);
    assert.equal(twice[0]?.answer, '2.4M');
  });

  it('a blank answer takes back what was said', () => {
    const once = upsertAnswer([], Q, '1.2M', AT);
    assert.deepEqual(upsertAnswer(once, Q, '  ', AT), []);
  });

  it('ignores an empty question', () => {
    assert.deepEqual(upsertAnswer([], '   ', '1.2M', AT), []);
  });

  it('keeps the newest when the list runs over', () => {
    let answers = [] as ReturnType<typeof upsertAnswer>;
    for (let i = 0; i < MAX_ANSWERS + 5; i += 1) {
      answers = upsertAnswer(answers, `question ${i}`, `answer ${i}`, AT);
    }
    assert.equal(answers.length, MAX_ANSWERS);
    assert.equal(answers[answers.length - 1]?.answer, `answer ${MAX_ANSWERS + 4}`);
  });

  it('does not mutate the list it was given', () => {
    const before = upsertAnswer([], Q, '1.2M', AT);
    upsertAnswer(before, Q, '2.4M', AT);
    assert.equal(before[0]?.answer, '1.2M');
  });
});

describe('unansweredAsks', () => {
  const answers = upsertAnswer([], Q, '1.2M', AT);

  it('counts only what is still open', () => {
    assert.deepEqual(unansweredAsks([Q, 'what did the migration save?'], answers), [
      'what did the migration save?',
    ]);
  });

  it('ignores advice with no question at all', () => {
    assert.deepEqual(unansweredAsks([null, null], answers), []);
  });

  it('asks the same question once', () => {
    const twice = ['what did the migration save?', 'what did the migration save?'];
    assert.equal(unansweredAsks(twice, []).length, 1);
  });
});

describe('answerLines', () => {
  it('says nothing when nothing was answered', () => {
    assert.deepEqual(answerLines([]), []);
  });

  it('tells the model to write the figure in rather than ask again', () => {
    const lines = answerLines(upsertAnswer([], Q, '1.2M', AT));
    assert.match(lines[0] ?? '', /CANDIDATE-SUPPLIED METRICS/);
    assert.match(lines[0] ?? '', /instead of asking again/);
    assert.equal(lines[1], `- ${Q} → 1.2M`);
  });
});
