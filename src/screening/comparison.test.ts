import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadKeywordMatcher } from '../resume/keyword-matcher';
import { anchorCompareReply, comparisonMarkdown, comparisonView, readStoredComparison, secondOrder, type StoredComparison } from './comparison';
import { CompareReplySchema } from './prompts';
import { RubricSchema, specOf, type Criterion, type Rubric } from './rubric';

const c = (id: string, kind: Criterion['kind'], label: string, spec: Partial<Criterion['spec']> = {}): Criterion =>
  ({ id, kind, label, mode: 'scored', weight: 3, source: 'you', spec: specOf(spec) });
const RUBRIC: Rubric = RubricSchema.parse({
  criteria: [c('java', 'skill', 'Java', { terms: [{ term: 'Java', aliases: [] }] }), c('lead', 'custom', 'has led a team', { question: 'has led a team', answer: 'yesno' })],
});
const TEXTS = new Map<number, string>([
  [1, 'Applicant №1\n\nSenior Backend Engineer\n- Owned the payments ledger on Java 17\n- Led a team of four engineers'],
  [3, 'Applicant №3\n\nBackend Engineer\n- Wrote Java services for a bank'],
]);

test('anchorCompareReply: a quote stays only in the resume it came from; numbers off the shortlist are dropped', async () => {
  const matcher = await loadKeywordMatcher();
  const reply = CompareReplySchema.parse({
    criteria: [
      {
        id: 'java',
        ranking: [1, 3, 9, 1],
        why: 'both, №1 with ownership',
        quotes: [
          { applicant: 1, quote: 'Owned the payments ledger on Java 17' },
          { applicant: 3, quote: 'Owned the payments ledger on Java 17' },
          { applicant: 3, quote: 'Wrote Java services for a bank' },
        ],
      },
      { id: 'lead', ranking: [1], why: 'only №1', quotes: [{ applicant: 1, quote: 'Led a team of four engineers' }] },
      { id: 'lead', ranking: [3], why: 'a second entry', quotes: [] },
      { id: 'ghost', ranking: [3], why: 'not in the rubric', quotes: [] },
    ],
    order: [{ applicant: 1, reason: 'ownership' }, { applicant: 9, reason: 'invented' }, { applicant: 3, reason: 'thinner' }, { applicant: 1, reason: 'again' }],
    decider: 'Which part of the ledger did you own?',
  });
  const { reply: out, report } = anchorCompareReply(reply, TEXTS, RUBRIC, matcher);
  assert.deepEqual(out.criteria.map((x) => x.id), ['java', 'lead']);
  assert.deepEqual(out.criteria[0]!.ranking, [1, 3]);
  assert.deepEqual(out.criteria[0]!.quotes, [
    { applicant: 1, quote: 'Owned the payments ledger on Java 17' },
    { applicant: 3, quote: 'Wrote Java services for a bank' },
  ], 'the line attributed to №3 is №1\'s and goes');
  assert.deepEqual(out.order.map((o) => o.applicant), [1, 3]);
  assert.deepEqual(report, { quotesDropped: 1, numbersDropped: 4, criteriaDropped: 2 });
});

const reading = (shown: number[], first: number, javaRanking: number[], why: string): StoredComparison['readings'][0] => ({
  shown,
  reply: CompareReplySchema.parse({
    criteria: [{ id: 'java', ranking: javaRanking, why, quotes: [{ applicant: 1, quote: 'Owned the payments ledger on Java 17' }] }, { id: 'lead', ranking: [1], why: 'only №1', quotes: [] }],
    order: first === 1 ? [{ applicant: 1, reason: 'owns' }, { applicant: 3, reason: 'thinner' }] : [{ applicant: 3, reason: 'bank' }, { applicant: 1, reason: 'owns' }],
    decider: 'Which part did you own?',
  }),
});

test('comparisonView says where the readings differ; the Markdown carries both', () => {
  const stored: StoredComparison = { v: 1, readings: [reading([1, 3], 1, [1, 3], 'ownership'), reading([3, 1], 3, [3, 1], 'bank scale')] };
  assert.deepEqual(secondOrder([1, 3]), [3, 1]);
  assert.ok(readStoredComparison(stored));
  assert.equal(readStoredComparison({ v: 1, readings: [stored.readings[0]] }), null, 'two readings or nothing');
  const view = comparisonView(stored, RUBRIC);
  assert.deepEqual(view.applicants, [1, 3]);
  assert.equal(view.criteria.length, 2);
  assert.deepEqual(view.criteria[0]!.picks, [1, 3]);
  assert.equal(view.criteria[0]!.agree, false);
  assert.equal(view.criteria[1]!.agree, true);
  assert.equal(view.disagreements, 1);
  assert.equal(view.firstAgree, false);
  assert.equal(view.orderAgree, false);
  assert.equal(view.criteria[0]!.quotes.length, 1, 'the same quote from both readings is one line');
  const md = comparisonMarkdown(view, new Map([[1, 'Олена'], [3, null]]), 'Senior Java');
  assert.match(md, /^# Shortlist — Senior Java/);
  assert.match(md, /Reading A:\n1\. №1 Олена — owns\n2\. №3 — thinner/);
  assert.match(md, /The two readings differ on who is first\./);
  assert.match(md, /\| Java \| №1 › №3 \| №3 › №1 \| differ \|/);
  assert.match(md, /\| has led a team \| №1 \| №1 \| agree \|/);
  assert.match(md, /\*\*Java\.\*\* ownership \/ bank scale\n- №1 Олена: "Owned the payments ledger on Java 17"/);

  const same: StoredComparison = { v: 1, readings: [reading([1, 3], 1, [1, 3], 'a'), reading([3, 1], 1, [1, 3], 'b')] };
  const agreed = comparisonView(same, RUBRIC);
  assert.deepEqual([agreed.firstAgree, agreed.orderAgree, agreed.disagreements], [true, true, 0]);
  assert.match(comparisonMarkdown(agreed, new Map(), 't'), /The two readings agree on the order\./);
});
