import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BriefSchema } from '../resume/prompts';
import { activeWeights, draftRubric, emptyRubric, levelFromBrief, linesOf, readRubric, rubricEquals, rubricFromForm, rubricSummary, termsOf } from './rubric';

const BRIEF = BriefSchema.parse({
  role: { posted_title: 'Senior Java Developer', family: 'backend engineering', seniority: 'senior', years_min: 5, focus: '' },
  company: { industry: 'fintech', product: null, audience: null, stage: null },
  screening: { reader: '', scan_for: [], wow: [], dealbreakers: [] },
  requirement_groups: [{ label: 'message broker', level: 'preferred', satisfy: 'any', options: ['Kafka', 'RabbitMQ'] }],
  keywords: [
    { term: 'Java', priority: 1, requirement: 'must', primary: true, aliases: ['java 17'], group: null },
    { term: 'Spring Boot', priority: 1, requirement: 'must', primary: true, aliases: [], group: null },
    { term: 'PostgreSQL', priority: 1, requirement: 'must', primary: false, aliases: ['postgres'], group: null },
    { term: 'Kafka', priority: 3, requirement: 'preferred', primary: false, aliases: [], group: 'message broker' },
    { term: 'RabbitMQ', priority: 3, requirement: 'preferred', primary: false, aliases: [], group: 'message broker' },
    { term: 'agile', priority: 4, requirement: 'context', primary: false, aliases: [], group: null },
  ],
  gates: ['at least 5 years of backend development', 'EU work authorisation', 'BSc in Computer Science or equivalent'],
});

test('draftRubric takes the frame from the brief', () => {
  const r = draftRubric(BRIEF);
  assert.equal(r.level, 'senior');
  assert.equal(r.yearsMin, 5);
  assert.equal(r.domain, 'fintech');
  assert.deepEqual(r.gates, BRIEF.gates);
  assert.deepEqual(r.must.map((t) => t.term), ['Java', 'Spring Boot', 'PostgreSQL']);
  assert.deepEqual(r.must.map((t) => t.primary), [true, true, false]);
  assert.deepEqual(r.nice.map((t) => t.term), ['Kafka', 'RabbitMQ'], 'context terms are not requirements');
  assert.equal(r.nice[0]?.group, 'message broker');
  assert.equal(r.educationRequired, true, 'a degree gate makes education count');
  assert.deepEqual(draftRubric(null), emptyRubric());
});

test('levelFromBrief folds the brief vocabulary to four rungs', () => {
  assert.equal(levelFromBrief('staff'), 'lead');
  assert.equal(levelFromBrief('Senior'), 'senior');
  assert.equal(levelFromBrief('mid-level'), 'mid');
  assert.equal(levelFromBrief('entry'), 'junior');
  assert.equal(levelFromBrief(null), null);
  assert.equal(levelFromBrief('experienced'), null);
});

test('rubricFromForm reads the editor and keeps aliases of unchanged terms', () => {
  const previous = draftRubric(BRIEF);
  const r = rubricFromForm(
    {
      level: 'mid',
      yearsMin: '3',
      gates: 'EU work authorisation\n\nGerman B2\nEU work authorisation',
      must: 'Java\nKotlin, PostgreSQL',
      core: 'java',
      nice: 'Kafka',
      domain: '',
      educationRequired: 'on',
      weight_must: '40',
      weight_years: 'abc',
    },
    previous,
  );
  assert.equal(r.level, 'mid');
  assert.equal(r.yearsMin, 3);
  assert.deepEqual(r.gates, ['EU work authorisation', 'German B2'], 'blank and duplicate lines dropped');
  assert.deepEqual(r.must.map((t) => t.term), ['Java', 'Kotlin', 'PostgreSQL']);
  assert.deepEqual(r.must.map((t) => t.primary), [true, false, false], 'core stack from its own field');
  assert.deepEqual(r.must[0]?.aliases, ['java 17'], 'aliases survive when the spelling matches');
  assert.deepEqual(r.must[1]?.aliases, [], 'a new term has none');
  assert.equal(r.nice[0]?.group, 'message broker');
  assert.equal(r.domain, null);
  assert.equal(r.educationRequired, true);
  assert.equal(r.weights.must, 40);
  assert.equal(r.weights.years, 15, 'a non-number keeps the previous weight');
});

test('rubricEquals ignores nothing that changes the yardstick', () => {
  const a = draftRubric(BRIEF);
  assert.ok(rubricEquals(a, readRubric(JSON.parse(JSON.stringify(a)))));
  assert.ok(!rubricEquals(a, { ...a, yearsMin: 4 }));
  assert.ok(!rubricEquals(a, { ...a, gates: a.gates.slice(1) }));
});

test('activeWeights zeroes what the rubric cannot compare', () => {
  const w = activeWeights({ ...emptyRubric(), level: null, domain: null, educationRequired: false });
  assert.equal(w.level, 0);
  assert.equal(w.domain, 0);
  assert.equal(w.education, 0);
  assert.equal(w.must, 0, 'no terms, no must-have part');
  assert.equal(w.impact, 15);
});

test('rubricSummary, linesOf, termsOf', () => {
  assert.equal(rubricSummary(draftRubric(BRIEF)), '3 gates · 3 must-have · 2 nice-to-have · senior · 5+ years · fintech · education required');
  assert.deepEqual(linesOf(' a \nA\n\nb'), ['a', 'b']);
  assert.deepEqual(termsOf('React, Vue; Node.js\nTypeScript'), ['React', 'Vue', 'Node.js', 'TypeScript']);
  assert.deepEqual(termsOf(42), []);
});
