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
  type Rubric,
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
    { term: 'Java Developer', priority: 2, requirement: 'must', primary: false, aliases: [], group: null },
    { term: 'fintech', priority: 4, requirement: 'nice', primary: false, aliases: [], group: null },
  ],
  gates: ['at least 5 years of backend development', 'EU work authorisation', "Bachelor's degree in Computer Science or equivalent", 'German at B2 or higher', 'on-site in Berlin or remote within Germany'],
});

const byKind = (r: { criteria: Criterion[] }, kind: CriterionKind) => r.criteria.filter((c) => c.kind === kind);

/** The editor's form as it posts a rubric back, with some rows' text changed. */
function formOf(r: Rubric, texts: Record<string, string> = {}): Record<string, string> {
  const form: Record<string, string> = {};
  for (const c of r.criteria) {
    form[`text_${c.id}`] = texts[c.id] ?? criterionText(c);
    form[`mode_${c.id}`] = c.mode;
    form[`weight_${c.id}`] = String(c.weight);
  }
  return form;
}

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
  ], 'the posted title, a fragment of it and the sector are not skills; an either/or group is one criterion; "Java" inside the title is');
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
  const form = formOf(first);
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
    ['skill', 'React / Vue within 36 months !', 'React / Vue within 36 months !'],
    ['skill', 'React / Vue ! within 36 months', 'React / Vue within 36 months !'],
    ['skill', 'Kubernetes within 3 years', 'Kubernetes within 36 months'],
    ['skill', 'Kubernetes within 1 month', 'Kubernetes within 1 month'],
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

test('a skill\'s recency window is typed into its text, and off unless it is', () => {
  const read = (text: string) => {
    const p = parseCriterionText('skill', text);
    return p && { terms: p.spec.terms.map((t) => t.term), core: p.spec.core, months: p.spec.recentWithinMonths, label: p.label };
  };
  assert.deepEqual(read('React / Vue within 36 months !'), { terms: ['React', 'Vue'], core: true, months: 36, label: 'React / Vue !' }, 'the window stays out of the terms and the label');
  assert.deepEqual(read('React / Vue ! within 36 months'), read('React / Vue within 36 months !'), '"!" before the window reads the same');
  assert.deepEqual(read('Kubernetes within 3 years'), { terms: ['Kubernetes'], core: false, months: 36, label: 'Kubernetes' });
  assert.equal(read('Kubernetes WITHIN 1 Year')!.months, 12, 'any case, the singular too');
  assert.equal(read('Kubernetes within 1 month')!.months, 1);
  assert.equal(read('Playwright / Cypress !')!.months, null, 'no window typed, no decay');
  assert.equal(read('TypeScript')!.months, null);
  assert.equal(read('Kubernetes within 0 months')!.months, 1, 'clamped to the schema, as an upside-down band is');
  assert.equal(read('Kubernetes within 300 months')!.months, 240);
  assert.equal(read('Kubernetes within 25 years')!.months, 240);
  for (const unreadable of ['Kubernetes within two years', 'Kubernetes within 1.5 years', 'Kubernetes within 3 yrs', 'React within 2 years / Vue', 'within 36 months !']) {
    assert.equal(parseCriterionText('skill', unreadable), null, `${unreadable}: refused, never kept inside a term`);
  }
});

test('the editor saves a window from the row\'s text, and deleting the words deletes it', () => {
  const first = draftRubric(BRIEF);
  const pg = byKind(first, 'skill').find((c) => c.label === 'PostgreSQL')!;
  const save = (texts: Record<string, string>, previous: Rubric): Rubric => {
    const out = rubricFromForm(formOf(previous, texts), previous);
    assert.ok('rubric' in out, JSON.stringify(out));
    return out.rubric;
  };
  const windowed = save({ [pg.id]: 'PostgreSQL within 24 months' }, first);
  const row = windowed.criteria.find((c) => c.id === pg.id)!;
  assert.equal(row.spec.recentWithinMonths, 24);
  assert.deepEqual(row.spec.terms[0]!.aliases, ['postgres'], 'the aliases survive');
  assert.equal(row.label, 'PostgreSQL', 'the label stays the terms');
  assert.equal(criterionText(row), 'PostgreSQL within 24 months', 'the row re-opens on the same text');
  assert.ok(!rubricEquals(first, windowed), 'a window is a new yardstick');
  assert.deepEqual(save({}, windowed).criteria.find((c) => c.id === pg.id), row, 'saved again untouched, the row stays');
  assert.equal(save({ [pg.id]: 'PostgreSQL' }, windowed).criteria.find((c) => c.id === pg.id)!.spec.recentWithinMonths, null);
  const refused = rubricFromForm(formOf(first, { [pg.id]: 'PostgreSQL within two years' }), first);
  assert.ok('error' in refused && /add "within 36 months"/.test(refused.error), 'an unreadable window is refused with the hint');
  const removed = rubricFromForm({ ...formOf(windowed), [`remove_${pg.id}`]: '1' }, windowed);
  assert.ok('rubric' in removed);
  assert.ok(!draftRubric(BRIEF, removed.rubric).criteria.some((c) => c.label === 'PostgreSQL'), 'removed with a window, a redraft does not bring it back');
});

test('protectedCharacteristic refuses the wish and names the lawful criterion', () => {
  assert.match(protectedCharacteristic({ kind: 'custom', label: 'under 30 years old' })!, /0–2 years/);
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
