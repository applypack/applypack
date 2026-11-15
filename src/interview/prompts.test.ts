import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interviewLanguage } from './languages';
import {
  buildInterviewPrompt,
  FROM_RESUME,
  MAX_NOTE_CHARS,
  notesThatFit,
  parseInterviewResponse,
  readQuestions,
  settleQuestions,
  sourceKeyOf,
  type InterviewInput,
} from './prompts';

const INPUT: InterviewInput = {
  job: { title: 'Senior Backend Engineer', companyName: 'Acme', location: 'Remote', description: 'Laravel, queues, 200 partners.' },
  language: interviewLanguage('uk')!,
  resumeText: 'Backend engineer. Built a booking marketplace on Laravel.',
  notes: [{ title: 'Booking marketplace', text: 'Переписав чергу бронювань, час обробки впав з 900 мс до 120 мс.' }],
  confirmedFacts: [{ term: 'kafka', note: 'two years at a previous job' }],
  companySnapshot: 'Acme builds scheduling software, about 60 people.',
};

const reply = (questions: unknown[]) => JSON.stringify({ questions });
const question = (over: Record<string, unknown> = {}) => ({
  kind: 'technical',
  question: 'Як ви масштабували черги?',
  why: 'Вакансія наголошує на чергах.',
  answer: ['Я переписав чергу бронювань.'],
  based_on: ['Booking marketplace'],
  missing: null,
  ...over,
});

test('the prompt names the language of the interview and says the material may be in any', () => {
  const { system, user } = buildInterviewPrompt(INPUT);
  assert.match(system, /in Ukrainian — the language the interview will be held in/);
  assert.match(system, /may be written in any language/);
  assert.match(user, /## Booking marketplace\nПереписав чергу/);
  assert.match(user, /- kafka: two years at a previous job/);
});

test('a prompt from notes alone carries no resume block, and no company block without a verification', () => {
  const { user } = buildInterviewPrompt({ ...INPUT, resumeText: null, companySnapshot: null });
  assert.doesNotMatch(user, /UNTRUSTED RESUME/);
  assert.doesNotMatch(user, /COMPANY CONTEXT/);
  assert.match(user, /UNTRUSTED CAREER NOTES/);
});

test('a reply is read leniently: an unknown kind and a missing list do not cost the question', () => {
  const parsed = parseInterviewResponse(reply([question({ kind: 'culture', answer: undefined, based_on: 'x', missing: '  ' })]));
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.data[0], { kind: 'about_you', question: 'Як ви масштабували черги?', why: 'Вакансія наголошує на чергах.', answer: [], based_on: [], missing: null });
});

test('a reply with no question at all is a failure, and a cut-off one says so', () => {
  assert.equal(parseInterviewResponse(reply([])).ok, false);
  const cut = parseInterviewResponse('{"questions": [{"kind": "technical", "question": "Як');
  assert.ok(!cut.ok && cut.cutOff);
});

test('a source an answer names must be one the person has', () => {
  const [q] = settleQuestions(
    [{ ...question(), based_on: ['booking MARKETPLACE', 'Resume', 'A project the model made up'] } as never],
    INPUT,
  );
  assert.deepEqual(q!.based_on, ['Booking marketplace', FROM_RESUME]);
  const [alone] = settleQuestions([{ ...question(), based_on: ['resume'] } as never], { ...INPUT, resumeText: null });
  assert.deepEqual(alone!.based_on, []);
});

test('a figure in an answer must come from the person, never from the posting or the company', () => {
  const [q] = settleQuestions(
    [{ ...question(), answer: ['Час обробки впав з 900 мс до 120 мс.', 'Я працював із 200 партнерами в команді з 60 людей і підняв конверсію на 35%.'] } as never],
    INPUT,
  );
  // Neither is the person's to claim. The posting's own figure is said to be the posting's (#734); the rest are nobody's.
  assert.deepEqual(q!.unbacked, ['60', '35']);
  assert.deepEqual(q!.posted, ['200']);
});

test('what was stored reads back, and another shape reads as nothing prepared', () => {
  const stored = settleQuestions([question() as never], INPUT);
  assert.deepEqual(readQuestions(JSON.parse(JSON.stringify(stored))), stored);
  assert.deepEqual(readQuestions({ questions: 'old' }), []);
});

test('the notes one prompt holds stop at the ceiling, newest first', () => {
  const long = 'x'.repeat(MAX_NOTE_CHARS);
  const notes = [1, 2, 3, 4].map((n) => ({ title: `Note ${n}`, text: long }));
  assert.deepEqual(notesThatFit(notes).map((n) => n.title), ['Note 1', 'Note 2', 'Note 3']);
});

test('the source key moves with the history and the posting, and with nothing else', () => {
  const key = sourceKeyOf(INPUT.job.description, INPUT.notes);
  assert.equal(key, sourceKeyOf(INPUT.job.description, [...INPUT.notes]));
  assert.notEqual(key, sourceKeyOf(INPUT.job.description, []));
  assert.notEqual(key, sourceKeyOf(`${INPUT.job.description} `, INPUT.notes));
});
