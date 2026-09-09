import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BriefSchema } from '../resume/prompts';
import {
  applyPreset,
  coreCriteria,
  criterionText,
  draftRubric,
  emptyRubric,
  levelFromBrief,
  parseCriterionText,
  protectedCharacteristic,
  readRubric,
  rubricEquals,
  rubricFromForm,
  rubricSummary,
  RUBRIC_VERSION,
  type Criterion,
  type CriterionKind,
} from './rubric';

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
    { term: 'Senior Java Developer', priority: 2, requirement: 'must', primary: false, aliases: [], group: null },
    { term: 'fintech', priority: 4, requirement: 'nice', primary: false, aliases: [], group: null },
  ],
  gates: ['at least 5 years of backend development', 'EU work authorisation', "Bachelor's degree in Computer Science or equivalent", 'German at B2 or higher', 'on-site in Berlin or remote within Germany'],
});

const byKind = (r: { criteria: Criterion[] }, kind: CriterionKind) => r.criteria.filter((c) => c.kind === kind);

test('draftRubric turns the brief into criteria under the kinds their wording names', () => {
  const r = draftRubric(BRIEF);
  assert.equal(r.version, RUBRIC_VERSION);
  assert.deepEqual(byKind(r, 'years').map((c) => [c.label, c.mode, c.spec.min, c.spec.max]), [['at least 5 years of backend development', 'gate', 5, null]], 'the years gate, once — the brief\'s years_min is not repeated');
  assert.deepEqual(byKind(r, 'authorization').map((c) => c.mode), ['gate']);
  assert.deepEqual(byKind(r, 'education').map((c) => c.mode), ['gate']);
  assert.deepEqual(byKind(r, 'language').map((c) => c.label), ['German at B2 or higher']);
  assert.deepEqual(byKind(r, 'location').map((c) => [c.label, c.spec.remoteOk]), [['on-site in Berlin or remote within Germany', true]]);
  const skills = byKind(r, 'skill');
  assert.deepEqual(skills.map((c) => [criterionText(c), c.weight, c.spec.core]), [
    ['Java !', 3, true],
    ['Spring Boot !', 3, true],
    ['PostgreSQL', 3, false],
    ['Kafka / RabbitMQ', 1, false],
  ], 'the posted title and the sector are not skills; an either/or group is one criterion');
  assert.deepEqual(skills[0]!.spec.terms[0]!.aliases, ['java 17']);
  assert.deepEqual(byKind(r, 'level').map((c) => [c.spec.wanted, c.spec.tolerance]), [['senior', 'one']]);
  assert.deepEqual(byKind(r, 'industry').map((c) => c.spec.items), [['fintech']]);
  assert.equal(byKind(r, 'impact').length, 1);
  assert.equal(byKind(r, 'overall').length, 1);
  assert.ok(r.criteria.every((c) => c.source === 'posting'));
  assert.deepEqual(draftRubric(null), emptyRubric());
});

test('a redraft keeps the person\'s own criteria and does not resurrect what they removed', () => {
  const first = draftRubric(BRIEF);
  const form: Record<string, string> = {};
  for (const c of first.criteria) {
    form[`text_${c.id}`] = criterionText(c);
    form[`mode_${c.id}`] = c.mode;
    form[`weight_${c.id}`] = String(c.weight);
  }
  form[`remove_${byKind(first, 'language')[0]!.id}`] = '1';
  form.add_kind = 'custom';
  form.add_text = 'has led a team of three or more';
  form.add_mode = 'gate';
  const edited = rubricFromForm(form, first);
  assert.ok('rubric' in edited, JSON.stringify(edited));
  const r = edited.rubric;
  assert.deepEqual(r.removed, ['German at B2 or higher']);
  assert.equal(byKind(r, 'language').length, 0);
  const mine = byKind(r, 'custom').find((c) => c.source === 'you')!;
  assert.equal(mine.label, 'has led a team of three or more');
  assert.equal(mine.mode, 'gate');
  const again = draftRubric(BRIEF, r);
  assert.equal(byKind(again, 'language').length, 0, 'removed stays removed');
  assert.ok(again.criteria.some((c) => c.id === mine.id), 'my own criterion survives the redraft');
});

test('the text grammar round-trips every kind', () => {
  const cases: [CriterionKind, string, string][] = [
    ['skill', 'Playwright / Cypress !', 'Playwright / Cypress !'],
    ['skill', 'TypeScript', 'TypeScript'],
    ['years', '5+: test automation', '5+: test automation'],
    ['years', '0–2', '0–2'],
    ['years', '3-5', '3–5'],
    ['level', 'junior or below', 'junior or below'],
    ['level', 'senior or above', 'senior or above'],
    ['level', 'mid exactly', 'mid exactly'],
    ['level', 'lead', 'lead'],
    ['industry', 'fintech, payments: 3+', 'fintech, payments: 3+'],
    ['industry', 'e-commerce', 'e-commerce'],
    ['companyType', 'agency, consultancy', 'agency, consultancy'],
    ['language', 'English B2', 'English B2'],
    ['location', 'Kyiv or remote', 'Kyiv or remote'],
    ['authorization', 'Ukraine', 'Ukraine'],
    ['availability', 'within 4 weeks', 'within 4 weeks'],
    ['education', 'bachelor: computer science, software engineering', 'bachelor: computer science, software engineering'],
    ['certification', 'ISTQB, AWS SAA', 'ISTQB, AWS SAA'],
    ['scale', 'team of 5+', 'team of 5+'],
    ['custom', 'has shipped an app to a store', 'has shipped an app to a store'],
    ['impact', '', ''],
    ['overall', '', ''],
  ];
  for (const [kind, input, expected] of cases) {
    const parsed = parseCriterionText(kind, input);
    assert.ok(parsed, `${kind}: ${input}`);
    const c: Criterion = { id: 'x', kind, label: parsed.label, mode: 'scored', weight: 3, source: 'you', spec: parsed.spec };
    assert.equal(criterionText(c), expected, `${kind}: ${input}`);
  }
  assert.equal(parseCriterionText('years', 'five'), null);
  assert.equal(parseCriterionText('level', 'guru'), null);
  assert.equal(parseCriterionText('skill', '  '), null);
  const band = parseCriterionText('years', '8–3')!;
  assert.deepEqual([band.spec.min, band.spec.max], [3, 3], 'a band upside down is clamped');
});

test('protectedCharacteristic refuses the wish and names the lawful criterion', () => {
  assert.match(protectedCharacteristic({ kind: 'custom', label: 'under 30 years old' })!, /years band/);
  assert.match(protectedCharacteristic({ kind: 'custom', label: 'дівчина' })!, /read blind/);
  assert.match(protectedCharacteristic({ kind: 'custom', label: 'no children' })!, /availability/);
  assert.match(protectedCharacteristic({ kind: 'custom', label: 'Ukrainian citizen' })!, /work permit/);
  assert.equal(protectedCharacteristic({ kind: 'custom', label: 'has led a team of three or more' }), null);
  assert.equal(protectedCharacteristic({ kind: 'authorization', label: 'Ukrainian citizenship or a work permit' }), null, 'the kind is lawful by construction');
  assert.equal(protectedCharacteristic({ kind: 'custom', label: 'a healthy test pyramid' }), null, 'a word inside a phrase is not the person');
  const refused = rubricFromForm({ add_kind: 'custom', add_text: 'must be a woman' }, emptyRubric());
  assert.ok('error' in refused && /read blind/.test(refused.error));
});

test('presets bend the draft to a shape of hiring', () => {
  const base = draftRubric(BRIEF);
  const junior = applyPreset(base, 'junior');
  assert.deepEqual(byKind(junior, 'years').map((c) => [c.mode, c.spec.min, c.spec.max]), [['gate', 0, 2]]);
  assert.deepEqual(byKind(junior, 'level').map((c) => [c.spec.wanted, c.spec.tolerance]), [['junior', 'atMost']]);
  assert.ok(byKind(junior, 'skill').every((c) => c.spec.minRung === 'project'));
  assert.equal(byKind(junior, 'impact')[0]!.weight, 1);
  const senior = applyPreset(base, 'senior');
  assert.deepEqual(byKind(senior, 'level').map((c) => [c.spec.wanted, c.spec.tolerance]), [['senior', 'atLeast']]);
  assert.equal(byKind(senior, 'impact')[0]!.weight, 3);
  assert.equal(byKind(senior, 'scale').length, 1);
  const regulated = applyPreset(base, 'regulated');
  assert.ok(byKind(regulated, 'education').every((c) => c.mode === 'gate'));
  assert.equal(byKind(regulated, 'certification').length, 1);
  const agency = applyPreset(base, 'agency');
  assert.deepEqual(byKind(agency, 'companyType').map((c) => [c.weight, c.spec.items]), [[4, ['agency', 'consultancy']]]);
  assert.equal(byKind(agency, 'industry')[0]!.weight, 4);
  assert.ok(rubricEquals(applyPreset(base, 'standard'), base));
});

test('readRubric converts a v1 rubric on read', () => {
  const v1 = {
    level: 'senior',
    yearsMin: 5,
    gates: ['Legally able to work in Ukraine'],
    must: [{ term: 'Playwright', primary: true, aliases: [], group: 'E2E' }, { term: 'Cypress', primary: true, aliases: [], group: 'E2E' }, { term: 'SQL', primary: false, aliases: [], group: null }],
    nice: [{ term: 'k6', primary: false, aliases: [], group: null }],
    domain: 'fintech',
    educationRequired: true,
    weights: { must: 35, years: 15, level: 15, impact: 15, domain: 10, nice: 5, education: 5 },
  };
  const r = readRubric(v1);
  assert.equal(r.version, RUBRIC_VERSION);
  assert.deepEqual(byKind(r, 'custom').map((c) => [c.label, c.mode]), [['Legally able to work in Ukraine', 'gate']]);
  assert.deepEqual(byKind(r, 'skill').map((c) => [criterionText(c), c.weight]), [['Playwright / Cypress !', 3], ['SQL', 3], ['k6', 1]]);
  assert.equal(byKind(r, 'education')[0]!.mode, 'gate');
  assert.deepEqual(coreCriteria(r).map((c) => criterionText(c)), ['Playwright / Cypress !']);
  assert.deepEqual(readRubric({ nonsense: true }), emptyRubric());
  assert.deepEqual(readRubric(r), r, 'a v2 rubric reads back as itself');
});

test('rubricEquals, rubricSummary, levelFromBrief', () => {
  const r = draftRubric(BRIEF);
  assert.ok(rubricEquals(r, readRubric(JSON.parse(JSON.stringify(r)))));
  const heavier = { ...r, criteria: r.criteria.map((c) => (c.kind === 'industry' ? { ...c, weight: 5 } : c)) };
  assert.ok(!rubricEquals(r, heavier), 'a weight is part of the yardstick');
  const renamed = { ...r, criteria: r.criteria.map((c) => ({ ...c, id: `${c.id}x` })) };
  assert.ok(rubricEquals(r, renamed), 'ids are not');
  assert.equal(rubricSummary(r), '5 gates · 8 scored');
  assert.equal(levelFromBrief('staff'), 'lead');
  assert.equal(levelFromBrief(null), null);
});
