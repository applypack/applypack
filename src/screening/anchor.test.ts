import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadKeywordMatcher } from '../resume/keyword-matcher';
import { anchorScreenReply, textEvidence } from './anchor';
import { RubricSchema, specOf, type Criterion, type Rubric } from './rubric';
import { ScreenReplySchema } from './prompts';

const TEXT = `Applicant №4

Senior Backend Engineer
Kyiv

EXPERIENCE
Senior Backend Engineer, Acme — Jan 2020 – Present
- Owned the payments ledger on Java 17 and Spring Boot, 12k rps, cut p99 latency 40%
- Ran the PostgreSQL migration for 30 services
- Led a team of four engineers through the migration

SKILLS
Java, Spring Boot, PostgreSQL, Kafka, Docker
`;

const c = (id: string, kind: Criterion['kind'], label: string, mode: Criterion['mode'], spec: Partial<Criterion['spec']> = {}): Criterion =>
  ({ id, kind, label, mode, weight: 3, source: 'you', spec: specOf(spec) });

const RUBRIC: Rubric = RubricSchema.parse({
  criteria: [
    c('g', 'authorization', 'EU work authorisation', 'gate', { items: ['EU'] }),
    c('java', 'skill', 'Java !', 'scored', { terms: [{ term: 'Java', aliases: [] }], core: true }),
    c('kafka', 'skill', 'Kafka', 'scored', { terms: [{ term: 'Kafka', aliases: [] }] }),
    c('k8s', 'skill', 'Kubernetes', 'scored', { terms: [{ term: 'Kubernetes', aliases: ['k8s'] }] }),
    c('pg', 'skill', 'PostgreSQL', 'scored', { terms: [{ term: 'PostgreSQL', aliases: ['postgres'] }] }),
    c('lead', 'custom', 'has led a team of three or more', 'scored', { question: 'has led a team of three or more', answer: 'yesno' }),
    c('how', 'custom', 'how much payments work', 'scored', { question: 'how much payments work', answer: 'howmuch' }),
    c('imp', 'impact', 'outcomes', 'scored'),
    c('ov', 'overall', 'overall', 'scored'),
    c('y', 'years', '5+', 'scored', { min: 5 }),
  ],
});

test('anchorScreenReply: quotes must be in the text; answers fall to what the text shows', async () => {
  const matcher = await loadKeywordMatcher();
  const reply = ScreenReplySchema.parse({
    summary: { who: '', did: '', verdict: '' },
    roles: [
      { position: 'Senior Backend Engineer', employer: 'Acme', start: 'Jan 2020', end: 'Present', relevant: true, why: 'same', sector: 'payments', companyType: 'product' },
      { position: 'Staff Engineer', employer: 'Nowhere', start: '2015', end: '2019', relevant: true, why: 'invented', sector: null, companyType: null },
    ],
    answers: [
      { id: 'g', status: 'pass', quote: 'holds an EU passport' },
      { id: 'java', rung: 'production', quote: 'Owned the payments ledger on Java 17 and Spring Boot, 12k rps, cut p99 latency 40%', last_used: 'Present' },
      { id: 'kafka', rung: 'role', quote: 'built Kafka pipelines for the ledger' },
      { id: 'k8s', rung: 'role', quote: 'deployed on Kubernetes' },
      { id: 'ghost', rung: 'production', quote: 'x' },
      { id: 'lead', status: 'pass', quote: 'Led a team of four engineers through the migration' },
      { id: 'how', rung: 'production', quote: 'shipped the whole payments platform alone' },
      { id: 'imp', impact: 'strong', quote: 'cut p99 latency 40%' },
      { id: 'ov', overall: 'exceptional', quote: 'a made-up line', reasons: ['a'], concerns: [] },
      { id: 'y', status: 'pass', quote: 'Jan 2020 – Present' },
    ],
  });
  const { reply: out, report } = anchorScreenReply(reply, TEXT, RUBRIC, matcher);
  const by = Object.fromEntries(out.answers.map((a) => [a.id, a]));

  assert.equal(by.g!.status, 'unknown', 'an unquoted pass becomes unknown');
  assert.equal(report.statusesUnproven, 1);
  assert.equal(by.java!.rung, 'production', 'a located quote keeps the rung');
  assert.equal(by.java!.last_used, 'Present');
  assert.equal(by.kafka!.rung, 'listed', 'a paraphrased quote falls to the skills line the text has');
  assert.equal(by.kafka!.quote, 'Java, Spring Boot, PostgreSQL, Kafka, Docker');
  assert.equal(by.k8s!.rung, 'absent', 'a term the text never spells is absent whatever the model said');
  assert.equal(by.pg!.rung, 'role', 'a skill the model skipped is read off the text: a work sentence');
  assert.equal(by.pg!.quote, 'Ran the PostgreSQL migration for 30 services');
  assert.ok(!('ghost' in by), 'an answer for an id the rubric never named is dropped');
  assert.equal(by.lead!.status, 'pass', 'a quoted yes / no stands');
  assert.equal(by.how!.rung, 'listed', 'an unquoted "how much" answer is at most listed');
  assert.equal(by.imp!.impact, 'strong');
  assert.equal(by.ov!.overall, 'exceptional', 'the overall grade stands; its quote is checked');
  assert.equal(by.ov!.quote, null);
  assert.ok(!('y' in by), 'years are read off the roles, never answered');
  assert.deepEqual([report.answersDropped, report.answersFilled, report.rungsLowered, report.quotesDropped], [1, 1, 3, 5], 'lowered: Kafka, Kubernetes, the unquoted how-much');
  assert.equal(out.roles.length, 1, 'a role the text does not carry is dropped');
  assert.equal(report.rolesDropped, 1);
});

test('anchorScreenReply raises a rung the text shows more of, and lowers a strong impact with no quote', async () => {
  const matcher = await loadKeywordMatcher();
  const reply = ScreenReplySchema.parse({
    answers: [
      { id: 'java', rung: 'listed', quote: 'Java, Spring Boot, PostgreSQL, Kafka, Docker' },
      { id: 'imp', impact: 'strong', quote: 'tripled revenue' },
    ],
  });
  const { reply: out, report } = anchorScreenReply(reply, TEXT, RUBRIC, matcher);
  const by = Object.fromEntries(out.answers.map((a) => [a.id, a]));
  assert.equal(by.java!.rung, 'role', 'the skills line was quoted over a bullet that shipped it');
  assert.equal(by.java!.quote, 'Owned the payments ledger on Java 17 and Spring Boot, 12k rps, cut p99 latency 40%');
  assert.equal(report.rungsRaised, 1);
  assert.equal(by.imp!.impact, 'ok');
  assert.deepEqual(textEvidence([{ term: 'Kubernetes', aliases: ['k8s'] }], TEXT, matcher), { rung: 'absent', quote: null });
});
