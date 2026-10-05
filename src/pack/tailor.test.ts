import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadKeywordMatcher } from '../resume/keyword-matcher';
import type { MatchKeyword } from '../resume/prompts';
import type { EditPlan } from './policy';
import { loadEditor, scoreOnText, tailor, tailorChecks } from './tailor';

const RESUME = [
  'Jane Doe',
  'jane@example.com | +1 512 555 0100 | Austin, TX',
  '',
  'SUMMARY',
  'Back end developer with ten years of PHP.',
  '',
  'SKILLS',
  'Backend: PHP, Laravel, MySQL',
  '',
  'EXPERIENCE',
  'Acme — Senior Developer, 2019 – Present',
  '• Built a billing service.',
  '• Led code reviews.',
].join('\n');

const keyword = (term: string, over: Partial<MatchKeyword> = {}): MatchKeyword => ({
  term,
  priority: 2,
  requirement: 'must',
  primary: false,
  status: 'add',
  aliases: [],
  where: null,
  note: null,
  elsewhere: null,
  ...over,
});

const KEYWORDS = [keyword('Laravel', { status: 'present', primary: true }), keyword('Redis'), keyword('Kubernetes', { status: 'cannot_claim' })];
const REPORT = { keywords: KEYWORDS, redFlags: [], alignment: null };

const PLAN: EditPlan = {
  ops: [
    { key: 'bullet', kind: 'change', quote: 'Built a billing service.', wording: 'Built a billing service on Laravel queues, cutting invoice time 40%.' },
    { key: 'gone', kind: 'change', quote: 'A line the resume never had.', wording: 'Anything.' },
  ],
  terms: [{ term: 'Redis' }],
  held: [],
};

test('the cards run first, then the keywords; what cannot be placed is reported and the rest lands', async () => {
  const out = tailor(RESUME, PLAN, await loadEditor());
  assert.match(out.text, /• Built a billing service on Laravel queues, cutting invoice time 40%\./);
  assert.match(out.text, /Backend: PHP, Laravel, MySQL, Redis/);
  assert.deepEqual(out.done.map((d) => d.key), ['bullet', 'kw:Redis']);
  assert.deepEqual(out.failed.map((f) => [f.key, f.error]), [['gone', 'not-found']]);
});

test('a keyword a rewritten bullet already carries is not written twice', async () => {
  const plan: EditPlan = { ...PLAN, ops: [{ key: 'bullet', kind: 'change', quote: 'Built a billing service.', wording: 'Built a billing service on Redis.' }] };
  const out = tailor(RESUME, plan, await loadEditor());
  assert.equal(out.text.match(/Redis/g)?.length, 1);
  assert.deepEqual(out.failed, []);
});

test('the score follows the text: a backed keyword written in counts, and the ceiling stays where it was', async () => {
  const matcher = await loadKeywordMatcher();
  const before = scoreOnText(RESUME, REPORT, matcher);
  const after = scoreOnText(tailor(RESUME, PLAN, await loadEditor()).text, REPORT, matcher);
  assert.ok(after.score > before.score, `${after.score} should be above ${before.score}`);
  // The ceiling already counted the keyword as written, so writing it moves the score toward it.
  assert.equal(after.ceiling, before.ceiling);
});

test('an unbacked keyword typed in is counted too, which is why the plan never writes one', async () => {
  const matcher = await loadKeywordMatcher();
  const typed = scoreOnText(`${RESUME}\nKubernetes`, REPORT, matcher);
  assert.ok(typed.score > scoreOnText(RESUME, REPORT, matcher).score);
});

test('the checks pass an edit the plan made: a rewritten bullet, a wrapped summary, a keyword appended', async () => {
  const wrapped = RESUME.replace('Back end developer with ten years of PHP.', 'Back end developer with ten\nyears of PHP.');
  const plan: EditPlan = {
    ops: [
      { key: 'summary', kind: 'change', quote: 'Back end developer with ten years of PHP.', wording: 'Senior PHP developer, ten years with Laravel.' },
      { key: 'bullet', kind: 'change', quote: 'billing service', wording: 'billing service on Laravel queues' },
    ],
    terms: [{ term: 'Redis' }],
    held: [],
  };
  const outcome = tailor(wrapped, plan, await loadEditor());
  assert.deepEqual(outcome.failed, []);
  assert.deepEqual(tailorChecks({ before: wrapped, plan, outcome, score: { before: 60, after: 70 } }), []);
});

test('the checks catch what no plan asked for: a contact detail, a line, a lower score', async () => {
  const plan: EditPlan = { ops: [{ key: 'bullet', kind: 'change', quote: 'Built a billing service.', wording: 'Built a billing service on Laravel.' }], terms: [], held: [] };
  const outcome = tailor(RESUME, plan, await loadEditor());
  const score = { before: 60, after: 70 };
  const check = (text: string, over = score) => tailorChecks({ before: RESUME, plan, outcome: { ...outcome, text }, score: over });

  assert.deepEqual(check(outcome.text.replace(' | +1 512 555 0100', '')), ['contact-changed', 'line-lost']);
  assert.deepEqual(check(outcome.text.replace('\n• Led code reviews.', '')), ['line-lost']);
  assert.deepEqual(check(outcome.text, { before: 70, after: 64 }), ['score-dropped']);
  // A planned change that did not land excuses nothing.
  assert.deepEqual(tailorChecks({ before: RESUME, plan, outcome: { text: RESUME.replace('• Built a billing service.\n', ''), done: [], failed: [] }, score }), ['line-lost']);
});

test('a removal the plan made is not a lost line', async () => {
  const plan: EditPlan = { ops: [{ key: 'cut', kind: 'remove', quote: '• Led code reviews.' }], terms: [], held: [] };
  const outcome = tailor(RESUME, plan, await loadEditor());
  assert.doesNotMatch(outcome.text, /Led code reviews/);
  assert.deepEqual(tailorChecks({ before: RESUME, plan, outcome, score: { before: 60, after: 60 } }), []);
});
