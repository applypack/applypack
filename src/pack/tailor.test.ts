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

test('the checks pass what the plan made: a wrapped summary rewritten, a few words inside a bullet, a keyword appended', async () => {
  const editor = await loadEditor();
  const wrapped = RESUME.replace('Back end developer with ten years of PHP.', 'Back end developer with ten\nyears of PHP.');
  const plan: EditPlan = {
    ops: [
      { key: 'summary', kind: 'change', quote: 'Back end developer with ten years of PHP.', wording: 'Senior PHP developer, ten years with Laravel.' },
      { key: 'bullet', kind: 'change', quote: 'billing service', wording: 'billing service on Laravel queues' },
      { key: 'more', kind: 'add', anchor: '• Led code reviews.', wording: 'Mentored four developers.' },
    ],
    terms: [{ term: 'Redis' }],
    held: [],
  };
  const outcome = tailor(wrapped, plan, editor);
  assert.deepEqual(outcome.failed, []);
  assert.equal(outcome.done.length, 4);
  assert.deepEqual(tailorChecks({ before: wrapped, plan, outcome, score: { before: 60, after: 70 } }, editor), []);
});

test('a removal the plan made passes, bullet marker and all', async () => {
  const editor = await loadEditor();
  const plan: EditPlan = { ops: [{ key: 'cut', kind: 'remove', quote: 'Led code reviews.' }], terms: [], held: [] };
  const outcome = tailor(RESUME, plan, editor);
  assert.doesNotMatch(outcome.text, /Led code reviews/);
  assert.deepEqual(tailorChecks({ before: RESUME, plan, outcome, score: { before: 60, after: 60 } }, editor), []);
});

test('the checks catch what no plan asked for', async () => {
  const editor = await loadEditor();
  const plan: EditPlan = { ops: [{ key: 'bullet', kind: 'change', quote: 'Built a billing service.', wording: 'Built a billing service on Laravel.' }], terms: [], held: [] };
  const outcome = tailor(RESUME, plan, editor);
  const score = { before: 60, after: 70 };
  const check = (over: Partial<Parameters<typeof tailorChecks>[0]>) => tailorChecks({ before: RESUME, plan, outcome, score, ...over }, editor);

  // A line gone that no operation recorded: undoing what is on record does not give the original back.
  assert.deepEqual(check({ outcome: { ...outcome, text: outcome.text.replace('\n• Led code reviews.', '') } }), ['unexplained-change']);
  assert.deepEqual(check({ before: `${RESUME}\nReferences on request.` }), ['unexplained-change']);
  // An operation that took out more than its suggestion quoted.
  const greedy = outcome.done.map((d) => ({ ...d, edit: { ...d.edit, removed: `${d.edit.removed}\n• Led code reviews.` } }));
  assert.ok(check({ outcome: { ...outcome, done: greedy } }).includes('beyond-quote'));
  // A keyword that replaced a word instead of joining the line.
  const swapped = { ...outcome, done: [{ key: 'kw:Redis', kind: 'keyword', edit: { start: 0, removed: 'MySQL', inserted: 'Redis' } }] };
  assert.ok(check({ outcome: swapped }).includes('beyond-quote'));
  assert.deepEqual(check({ score: { before: 70, after: 64 } }), ['score-dropped']);
});

test('a contact detail inside a rewritten span is caught even when the plan quoted it', async () => {
  const editor = await loadEditor();
  const plan: EditPlan = {
    ops: [{ key: 'contact', kind: 'change', quote: 'jane@example.com | +1 512 555 0100 | Austin, TX', wording: 'Austin, TX' }],
    terms: [],
    held: [],
  };
  const outcome = tailor(RESUME, plan, editor);
  assert.deepEqual(tailorChecks({ before: RESUME, plan, outcome, score: { before: 60, after: 60 } }, editor), ['contact-changed']);
});
