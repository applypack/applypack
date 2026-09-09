import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capExplanation, orderVerdicts, readScreenBreakdown, scoreScreening } from './score';
import { emptyRubric, type Rubric } from './rubric';
import { ScreenReplySchema, type ScreenReply } from './prompts';

const NOW = new Date('2026-09-09T00:00:00Z');

const RUBRIC: Rubric = {
  ...emptyRubric(),
  level: 'senior',
  yearsMin: 5,
  domain: 'fintech',
  educationRequired: false,
  gates: ['EU work authorisation', 'at least 5 years'],
  must: [
    { term: 'Java', primary: true, aliases: [], group: null },
    { term: 'Spring Boot', primary: true, aliases: [], group: null },
    { term: 'PostgreSQL', primary: false, aliases: [], group: null },
    { term: 'Kafka', primary: false, aliases: [], group: 'broker' },
    { term: 'RabbitMQ', primary: false, aliases: [], group: 'broker' },
  ],
  nice: [{ term: 'Kubernetes', primary: false, aliases: [], group: null }],
};

function reply(over: Partial<ScreenReply> = {}): ScreenReply {
  return ScreenReplySchema.parse({
    summary: { who: 'w', did: 'd', verdict: 'v' },
    gates: [
      { gate: 'EU work authorisation', status: 'pass', quote: 'EU citizen' },
      { gate: 'at least 5 years', status: 'pass', quote: '2018 – Present' },
    ],
    must: [
      { term: 'Java', level: 'production', quote: 'q' },
      { term: 'Spring Boot', level: 'role', quote: 'q' },
      { term: 'PostgreSQL', level: 'listed', quote: null },
      { term: 'Kafka', level: 'role', quote: 'q' },
      { term: 'RabbitMQ', level: 'absent', quote: null },
    ],
    nice: [{ term: 'Kubernetes', level: 'project', quote: 'q' }],
    roles: [
      { position: 'Senior Java Developer', employer: 'Bank', start: 'Jan 2020', end: 'Present', relevant: true, why: 'same' },
      { position: 'Java Developer', employer: 'Shop', start: '2017', end: '2019', relevant: true, why: 'same' },
      { position: 'Waiter', employer: 'Cafe', start: '2014', end: '2016', relevant: false, why: 'other' },
    ],
    level: { observed: 'senior', signals: ['owned'] },
    impact: { grade: 'strong', quotes: ['cut latency 40%'] },
    domain: { grade: 'strong', why: 'a bank' },
    education: { status: 'unknown', note: null },
    questions: ['q1'],
    ...over,
  });
}

test('a strong applicant: every part earns, no cap, gates pass', () => {
  const bd = scoreScreening({ rubric: RUBRIC, reply: reply(), textChars: 3000, now: NOW });
  assert.equal(bd.gateBucket, 'pass');
  // must: Java 1, Spring 0.8, Postgres 0.3, broker group max(0.8, 0) = 0.8 → 2.9 / 4 = 0.725 → 25.4 of 35
  assert.equal(bd.parts.must.pts, 25.4);
  assert.equal(bd.mustCovered, 4);
  assert.equal(bd.mustTotal, 5);
  assert.equal(bd.primaryCovered, 2);
  // years: 2017–2019 (3 y) + 2020–now (6.75 y) = 9.75 ≥ 5 → share 1; current → recency 1 → 15
  assert.equal(bd.years, 9.8);
  assert.equal(bd.parts.years.pts, 15);
  assert.equal(bd.parts.level.pts, 15);
  assert.equal(bd.parts.impact.pts, 15);
  assert.equal(bd.parts.domain.pts, 10);
  assert.equal(bd.parts.nice.pts, 2.5);
  assert.equal(bd.parts.education.max, 0, 'not required → out of the denominator');
  assert.equal(bd.weightTotal, 95);
  assert.equal(bd.score, Math.round((100 * (25.4 + 15 + 15 + 15 + 10 + 2.5)) / 95));
  assert.equal(bd.cap, null);
  assert.equal(bd.confidence.band, 'high');
  assert.equal(capExplanation(bd), null);
});

test('no core-stack term anywhere caps at 30', () => {
  const r = reply({
    must: [
      { term: 'Java', level: 'absent', quote: null, last_used: null },
      { term: 'Spring Boot', level: 'absent', quote: null, last_used: null },
      { term: 'PostgreSQL', level: 'production', quote: 'q', last_used: null },
      { term: 'Kafka', level: 'production', quote: 'q', last_used: null },
      { term: 'RabbitMQ', level: 'production', quote: 'q', last_used: null },
    ],
  });
  const bd = scoreScreening({ rubric: RUBRIC, reply: r, textChars: 3000, now: NOW });
  assert.equal(bd.primaryCovered, 0);
  assert.equal(bd.cap, 30);
  assert.equal(bd.capReason, 'primary');
  assert.equal(bd.score, 30);
  assert.match(capExplanation(bd)!, /none of the 2 core-stack terms/);
});

test('two levels under caps at 50; one level either way is half credit', () => {
  const under = scoreScreening({ rubric: RUBRIC, reply: reply({ level: { observed: 'junior', signals: [] } }), textChars: 3000, now: NOW });
  assert.equal(under.cap, 50);
  assert.equal(under.capReason, 'level');
  assert.equal(under.parts.level.pts, 0);
  const over = scoreScreening({ rubric: RUBRIC, reply: reply({ level: { observed: 'lead', signals: [] } }), textChars: 3000, now: NOW });
  assert.equal(over.cap, null, 'over-qualification is a risk line, never a cap');
  assert.equal(over.parts.level.pts, 7.5);
});

test('duties-only impact caps at 60, and the strictest cap wins', () => {
  const bd = scoreScreening({ rubric: RUBRIC, reply: reply({ impact: { grade: 'weak', quotes: [] } }), textChars: 3000, now: NOW });
  assert.equal(bd.cap, 60);
  assert.equal(bd.capReason, 'impact');
  const both = scoreScreening({
    rubric: RUBRIC,
    reply: reply({ impact: { grade: 'weak', quotes: [] }, level: { observed: 'junior', signals: [] } }),
    textChars: 3000,
    now: NOW,
  });
  assert.equal(both.cap, 50);
  assert.equal(both.capReason, 'level');
});

test('unknown leaves the denominator and lowers confidence, never the score', () => {
  const r = reply({
    roles: [],
    level: { observed: null, signals: [] },
    domain: { grade: 'unknown', why: '' },
    gates: [
      { gate: 'EU work authorisation', status: 'unknown', quote: null, question: 'ask' },
      { gate: 'at least 5 years', status: 'pass', quote: 'q', question: null },
    ],
  });
  const bd = scoreScreening({ rubric: RUBRIC, reply: r, textChars: 3000, now: NOW });
  assert.equal(bd.gateBucket, 'ask');
  assert.deepEqual(bd.gatesUnknown, ['EU work authorisation']);
  assert.equal(bd.parts.years.max, 0);
  assert.equal(bd.parts.level.max, 0);
  assert.equal(bd.parts.domain.max, 0);
  assert.equal(bd.weightTotal, 35 + 15 + 5);
  assert.equal(bd.years, null);
  assert.equal(bd.confidence.band, 'medium');
  assert.ok(bd.confidence.answered < bd.confidence.total);
  assert.match(bd.parts.years.detail, /ask/);
});

test('a failed gate buckets the applicant; the score is still computed for the file', () => {
  const r = reply({ gates: [{ gate: 'EU work authorisation', status: 'fail', quote: 'needs sponsorship', question: null }, { gate: 'at least 5 years', status: 'pass', quote: 'q', question: null }] });
  const bd = scoreScreening({ rubric: RUBRIC, reply: r, textChars: 3000, now: NOW });
  assert.equal(bd.gateBucket, 'fail');
  assert.deepEqual(bd.gatesFailed, ['EU work authorisation']);
  assert.ok(bd.score > 0);
});

test('a thin resume lowers confidence', () => {
  const bd = scoreScreening({ rubric: RUBRIC, reply: reply(), textChars: 400, now: NOW });
  assert.equal(bd.confidence.thin, true);
  assert.equal(bd.confidence.band, 'medium');
});

test('years: a minimum met by half earns half of the share; old work earns little recency', () => {
  const r = reply({
    roles: [{ position: 'Java Developer', employer: 'Shop', start: '2010', end: '2012', relevant: true, why: 'same' }],
  });
  const bd = scoreScreening({ rubric: RUBRIC, reply: r, textChars: 3000, now: NOW });
  assert.equal(bd.years, 3);
  // share 3/5 = 0.6 × 0.7 = 0.42; recency floor 0.2 × 0.3 = 0.06 → 0.48 × 15 = 7.2
  assert.equal(bd.parts.years.pts, 7.2);
  assert.match(bd.parts.years.detail, /years ago/);
});

test('orderVerdicts: bucket, then score, then confidence, then number', () => {
  const rows = [
    { number: 1, gateBucket: 'ask' as const, score: 90, confidence: 'high' as const },
    { number: 2, gateBucket: 'pass' as const, score: 60, confidence: 'low' as const },
    { number: 3, gateBucket: 'pass' as const, score: 60, confidence: 'high' as const },
    { number: 4, gateBucket: 'fail' as const, score: 99, confidence: 'high' as const },
    { number: 5, gateBucket: 'pass' as const, score: 80, confidence: 'medium' as const },
  ];
  assert.deepEqual(orderVerdicts(rows).map((r) => r.number), [5, 3, 2, 1, 4]);
});

test('readScreenBreakdown round-trips the stored JSON', () => {
  const bd = scoreScreening({ rubric: RUBRIC, reply: reply(), textChars: 3000, now: NOW });
  assert.deepEqual(readScreenBreakdown(JSON.parse(JSON.stringify(bd))), bd);
  assert.equal(readScreenBreakdown({}), null);
});
