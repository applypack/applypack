import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadKeywordMatcher } from '../resume/keyword-matcher';
import { anchorScreenReply } from './anchor';
import { emptyRubric, type Rubric } from './rubric';
import { ScreenReplySchema } from './prompts';

const TEXT = `Applicant №4

Senior Backend Engineer
Kyiv

EXPERIENCE
Senior Backend Engineer, Acme — Jan 2020 – Present
- Owned the payments ledger on Java 17 and Spring Boot, 12k rps, cut p99 latency 40%
- Ran the PostgreSQL migration for 30 services

SKILLS
Java, Spring Boot, PostgreSQL, Kafka, Docker
`;

const RUBRIC: Rubric = {
  ...emptyRubric(),
  gates: ['EU work authorisation', 'at least 5 years of backend'],
  must: [
    { term: 'Java', primary: true, aliases: [], group: null },
    { term: 'Kafka', primary: false, aliases: [], group: null },
    { term: 'Kubernetes', primary: false, aliases: ['k8s'], group: null },
    { term: 'PostgreSQL', primary: false, aliases: ['postgres'], group: null },
  ],
  nice: [],
};

test('anchorScreenReply: quotes must be in the text, rungs fall to what the text shows', async () => {
  const matcher = await loadKeywordMatcher();
  const reply = ScreenReplySchema.parse({
    summary: { who: '', did: '', verdict: '' },
    gates: [
      { gate: 'EU work authorisation', status: 'pass', quote: 'holds an EU passport', question: null },
      { gate: 'at least 5 years of backend', status: 'pass', quote: 'Jan 2020 – Present', question: null },
    ],
    must: [
      { term: 'Java', level: 'production', quote: 'Owned the payments ledger on Java 17 and Spring Boot, 12k rps, cut p99 latency 40%', last_used: 'Present' },
      { term: 'Kafka', level: 'role', quote: 'built Kafka pipelines for the ledger', last_used: null },
      { term: 'Kubernetes', level: 'role', quote: 'deployed on Kubernetes', last_used: null },
      { term: 'Terraform', level: 'production', quote: 'x', last_used: null },
    ],
    nice: [],
    roles: [
      { position: 'Senior Backend Engineer', employer: 'Acme', start: 'Jan 2020', end: 'Present', relevant: true, why: 'same' },
      { position: 'Staff Engineer', employer: 'Nowhere', start: '2015', end: '2019', relevant: true, why: 'invented' },
    ],
    level: { observed: 'senior', signals: ['Owned the payments ledger on Java 17', 'led a team of nine'] },
    impact: { grade: 'strong', quotes: ['cut p99 latency 40%'] },
    domain: { grade: 'unknown', why: '' },
    education: { status: 'unknown', note: null },
  });
  const { reply: out, report } = anchorScreenReply(reply, TEXT, RUBRIC, matcher);

  assert.deepEqual(
    out.gates.map((g) => [g.gate, g.status, g.quote]),
    [
      ['EU work authorisation', 'unknown', null],
      ['at least 5 years of backend', 'pass', 'Jan 2020 – Present'],
    ],
    'an unquoted pass becomes unknown',
  );
  assert.equal(report.gatesUnproven, 1);

  const byTerm = Object.fromEntries(out.must.map((m) => [m.term, m]));
  assert.equal(byTerm.Java!.level, 'production', 'a located quote keeps the rung');
  assert.equal(byTerm.Java!.last_used, 'Present');
  assert.equal(byTerm.Kafka!.level, 'listed', 'a paraphrased quote falls to the skills line the text has');
  assert.equal(byTerm.Kafka!.quote, null);
  assert.equal(byTerm.Kubernetes!.level, 'absent', 'a term the text never spells is absent whatever the model said');
  assert.equal(byTerm.PostgreSQL!.level, 'role', 'a term the model skipped is filled from the text: it sits in a work sentence');
  assert.ok(!('Terraform' in byTerm), 'a term the rubric never named is dropped');
  assert.equal(report.termsDropped, 1);
  assert.equal(report.termsFilled, 1);
  assert.equal(report.rungsLowered, 2);

  assert.equal(out.roles.length, 1, 'a role the text does not carry is dropped');
  assert.equal(report.rolesDropped, 1);
  assert.deepEqual(out.level.signals, ['Owned the payments ledger on Java 17']);
  assert.equal(out.impact.grade, 'strong');
});

test('anchorScreenReply lowers a strong impact with no surviving quote', async () => {
  const matcher = await loadKeywordMatcher();
  const reply = ScreenReplySchema.parse({
    summary: { who: '', did: '', verdict: '' },
    impact: { grade: 'strong', quotes: ['tripled revenue'] },
  });
  const { reply: out } = anchorScreenReply(reply, TEXT, { ...RUBRIC, gates: [], must: [] }, matcher);
  assert.equal(out.impact.grade, 'ok');
  assert.deepEqual(out.impact.quotes, []);
});
