import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capExplanation, levelCredit, orderVerdicts, readScreenBreakdown, scoreScreening, sectorMatches } from './score';
import { RubricSchema, specOf, type Criterion, type Rubric } from './rubric';
import { ScreenReplySchema, type ScreenReply } from './prompts';

const NOW = new Date('2026-09-09T00:00:00Z');

const c = (id: string, kind: Criterion['kind'], label: string, mode: Criterion['mode'], weight: number, spec: Partial<Criterion['spec']> = {}): Criterion =>
  ({ id, kind, label, mode, weight, source: 'you', spec: specOf(spec) });

const RUBRIC: Rubric = RubricSchema.parse({
  criteria: [
    c('g-auth', 'authorization', 'EU work authorisation', 'gate', 3, { items: ['EU'] }),
    c('g-years', 'years', '5+ years: backend', 'gate', 3, { min: 5, of: 'backend' }),
    c('s-java', 'skill', 'Java !', 'scored', 5, { terms: [{ term: 'Java', aliases: [] }], core: true }),
    c('s-spring', 'skill', 'Spring Boot !', 'scored', 4, { terms: [{ term: 'Spring Boot', aliases: [] }], core: true }),
    c('s-broker', 'skill', 'Kafka / RabbitMQ', 'scored', 2, { terms: [{ term: 'Kafka', aliases: [] }, { term: 'RabbitMQ', aliases: [] }] }),
    c('s-k8s', 'skill', 'Kubernetes', 'scored', 1, { terms: [{ term: 'Kubernetes', aliases: [] }], recentWithinMonths: 36 }),
    c('l', 'level', 'senior (one rung either way)', 'scored', 2, { wanted: 'senior', tolerance: 'one' }),
    c('i', 'industry', 'fintech, payments: 3+', 'scored', 3, { items: ['fintech', 'payments'], min: 3 }),
    c('t', 'companyType', 'product', 'scored', 1, { items: ['product'] }),
    c('imp', 'impact', 'outcomes, not duties', 'scored', 2),
    c('ov', 'overall', 'the whole resume', 'scored', 2),
    c('q', 'custom', 'has led a team of three or more', 'scored', 3, { question: 'has led a team of three or more', answer: 'yesno' }),
    c('n', 'custom', 'open-source contributions', 'note', 1, { question: 'open-source contributions' }),
  ],
});

function reply(over: Partial<ScreenReply> = {}, answers: Partial<Record<string, Partial<ScreenReply['answers'][number]>>> = {}): ScreenReply {
  const base: Record<string, Partial<ScreenReply['answers'][number]>> = {
    'g-auth': { status: 'pass', quote: 'EU citizen' },
    's-java': { rung: 'production', quote: 'q' },
    's-spring': { rung: 'role', quote: 'q' },
    's-broker': { rung: 'role', quote: 'q' },
    's-k8s': { rung: 'role', quote: 'q', last_used: '2019' },
    l: { level: 'senior', quote: 'owned' },
    imp: { impact: 'strong', quote: 'cut latency 40%' },
    ov: { overall: 'strong', reasons: ['a', 'b', 'c'], concerns: ['x'] },
    q: { status: 'pass', quote: 'led a team of four' },
    n: { status: 'unknown' },
  };
  return ScreenReplySchema.parse({
    summary: { who: 'w', did: 'd', verdict: 'v' },
    roles: [
      { position: 'Senior Java Developer', employer: 'Bank', start: 'Jan 2020', end: 'Present', relevant: true, why: 'same', sector: 'banking and payments', companyType: 'product' },
      { position: 'Java Developer', employer: 'Shop', start: '2017', end: '2019', relevant: true, why: 'same', sector: 'e-commerce', companyType: 'agency' },
      { position: 'Waiter', employer: 'Cafe', start: '2014', end: '2016', relevant: false, why: 'other', sector: 'hospitality', companyType: null },
    ],
    answers: Object.entries({ ...base, ...answers }).map(([id, a]) => ({ id, ...a })),
    questions: ['q1'],
    ...over,
  });
}

test('a strong applicant: every criterion earns, gates pass, no cap', () => {
  const bd = scoreScreening({ rubric: RUBRIC, reply: reply(), textChars: 3000, now: NOW });
  const row = (id: string) => bd.rows.find((r) => r.id === id)!;
  assert.equal(bd.gateBucket, 'pass');
  assert.deepEqual(row('g-years').gate, 'pass');
  assert.equal(row('g-years').answer, '9.8 years');
  assert.equal(row('s-java').pts, 5);
  assert.equal(row('s-spring').pts, 3.2);
  assert.equal(row('s-broker').pts, 1.6);
  assert.equal(row('s-k8s').pts, 0.4, 'used in 2019, past the 36-month window: half of 0.8');
  assert.match(row('s-k8s').detail, /half credit/);
  assert.equal(row('l').pts, 2);
  // industry: 2020–now in "banking and payments" = 6.8 years ≥ 3 → 1
  assert.equal(row('i').pts, 3);
  assert.match(row('i').detail, /6\.8 years in fintech, payments of 3 asked/);
  // companyType: product 6.8 of 9.8 dated years = 0.69
  assert.equal(row('t').pts, 0.7);
  assert.equal(row('imp').pts, 2);
  assert.equal(row('ov').pts, 1.5);
  assert.equal(row('q').pts, 3);
  assert.equal(row('n').max, 0, 'a note weighs nothing');
  assert.equal(bd.weightTotal, 5 + 4 + 2 + 1 + 2 + 3 + 1 + 2 + 2 + 3);
  assert.equal(bd.score, Math.round((100 * (5 + 3.2 + 1.6 + 0.4 + 2 + 3 + 0.7 + 2 + 1.5 + 3)) / 25));
  assert.equal(bd.cap, null);
  assert.deepEqual([bd.skillsCovered, bd.skillsStrong, bd.skillsTotal, bd.coreCovered, bd.coreTotal], [4, 4, 4, 2, 2]);
  assert.equal(bd.level, 'senior');
  assert.equal(bd.confidence.band, 'high');
  assert.equal(capExplanation(bd), null);
});

test('no core skill anywhere caps at 30', () => {
  const bd = scoreScreening({ rubric: RUBRIC, reply: reply({}, { 's-java': { rung: 'absent' }, 's-spring': { rung: 'absent' } }), textChars: 3000, now: NOW });
  assert.equal(bd.coreCovered, 0);
  assert.deepEqual([bd.cap, bd.capReason, bd.score], [30, 'core', 30]);
  assert.match(capExplanation(bd)!, /none of the 2 core-stack skills/);
});

test('level: two under caps at 50 unless the criterion says "or below"; tolerance rules', () => {
  const under = scoreScreening({ rubric: RUBRIC, reply: reply({}, { l: { level: 'junior', quote: 'q' } }), textChars: 3000, now: NOW });
  assert.deepEqual([under.cap, under.capReason], [50, 'level']);
  const atMost: Rubric = { ...RUBRIC, criteria: RUBRIC.criteria.map((x) => (x.id === 'l' ? { ...x, spec: { ...x.spec, wanted: 'lead' as const, tolerance: 'atMost' as const } } : x)) };
  const fine = scoreScreening({ rubric: atMost, reply: reply({}, { l: { level: 'junior', quote: 'q' } }), textChars: 3000, now: NOW });
  assert.equal(fine.cap, null, '"lead or below" welcomes a junior');
  assert.equal(levelCredit(0, 'exact'), 1);
  assert.equal(levelCredit(1, 'exact'), 0.5);
  assert.equal(levelCredit(1, 'one'), 1);
  assert.equal(levelCredit(2, 'one'), 0.25);
  assert.equal(levelCredit(-1, 'atLeast'), 0.5);
  assert.equal(levelCredit(1, 'atLeast'), 1);
  assert.equal(levelCredit(1, 'atMost'), 0.5);
});

test('gates: a failed gate buckets; an unknown asks; a years gate reads the dated roles', () => {
  const failed = scoreScreening({ rubric: RUBRIC, reply: reply({}, { 'g-auth': { status: 'fail', quote: 'needs sponsorship' } }), textChars: 3000, now: NOW });
  assert.equal(failed.gateBucket, 'fail');
  assert.deepEqual(failed.gatesFailed, ['EU work authorisation']);
  const ask = scoreScreening({ rubric: RUBRIC, reply: reply({}, { 'g-auth': { status: 'unknown', question: 'Can you work in the EU?' } }), textChars: 3000, now: NOW });
  assert.equal(ask.gateBucket, 'ask');
  assert.match(ask.rows.find((r) => r.id === 'g-auth')!.detail, /ask: Can you work in the EU\?/);
  const junior = scoreScreening({ rubric: RUBRIC, reply: reply({ roles: [{ position: 'Java Developer', employer: 'Shop', start: '2023', end: 'Present', relevant: true, why: 'same', sector: null, companyType: null }] }), textChars: 3000, now: NOW });
  assert.equal(junior.rows.find((r) => r.id === 'g-years')!.gate, 'fail', '3.7 years against 5 asked');
  assert.equal(junior.rows.find((r) => r.id === 'i')!.credit, null, 'no sector read → unknown, out of the denominator');
});

test('a years band with a maximum fails the over-qualified as a gate', () => {
  const band: Rubric = RubricSchema.parse({ criteria: [c('g', 'years', '0–2', 'gate', 3, { min: 0, max: 2 })] });
  const bd = scoreScreening({ rubric: band, reply: reply(), textChars: 3000, now: NOW });
  assert.equal(bd.rows[0]!.gate, 'fail');
  assert.equal(bd.gateBucket, 'fail');
});

test('unknown leaves the denominator and lowers confidence; duties-only caps at 60', () => {
  const r = reply({}, { q: { status: 'unknown', question: 'ask' }, imp: { impact: 'weak' }, ov: { overall: 'weak' } });
  const bd = scoreScreening({ rubric: RUBRIC, reply: r, textChars: 3000, now: NOW });
  assert.equal(bd.rows.find((x) => x.id === 'q')!.max, 0);
  assert.equal(bd.weightTotal, 25 - 3);
  assert.deepEqual([bd.cap, bd.capReason], [60, 'impact']);
  assert.ok(bd.confidence.answered < bd.confidence.total);
  const thin = scoreScreening({ rubric: RUBRIC, reply: reply(), textChars: 400, now: NOW });
  assert.equal(thin.confidence.thin, true);
});

test('sectorMatches, orderVerdicts, readScreenBreakdown', () => {
  assert.ok(sectorMatches('banking and payments', ['fintech', 'payments']));
  assert.ok(sectorMatches('web design agency', ['web design agencies']));
  assert.ok(!sectorMatches('hospitality', ['fintech']));
  assert.ok(!sectorMatches(null, ['fintech']));
  const rows = [
    { number: 1, gateBucket: 'ask' as const, score: 90, confidence: 'high' as const },
    { number: 2, gateBucket: 'pass' as const, score: 60, confidence: 'low' as const },
    { number: 3, gateBucket: 'pass' as const, score: 60, confidence: 'high' as const },
  ];
  assert.deepEqual(orderVerdicts(rows).map((r) => r.number), [3, 2, 1]);
  const bd = scoreScreening({ rubric: RUBRIC, reply: reply(), textChars: 3000, now: NOW });
  assert.deepEqual(readScreenBreakdown(JSON.parse(JSON.stringify(bd))), bd);
  assert.equal(readScreenBreakdown({ v: 1, score: 80 }), null, 'a v1 breakdown is stale, not read');
});
