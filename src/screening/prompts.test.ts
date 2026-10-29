import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildComparePrompt, buildScreenPrompt, parseScreenResponse } from './prompts';
import { parseCriterionText, RubricSchema, type CriterionSpec } from './rubric';

const JOB = { title: 'Platform Engineer', companyName: 'Acme', location: 'Remote', description: 'Kubernetes in production.' };

test('a skill\'s recency window never reaches the model: the prompt is the one without it', () => {
  const parsed = parseCriterionText('skill', 'Kubernetes within 36 months !')!;
  const prompt = (spec: CriterionSpec) =>
    buildScreenPrompt({
      rubric: RubricSchema.parse({ criteria: [{ id: 's1', kind: 'skill', label: parsed.label, mode: 'scored', weight: 3, source: 'you', spec }] }),
      job: JOB,
      applicantText: 'Ran the Kubernetes clusters.',
      number: 1,
    });
  assert.equal(parsed.spec.recentWithinMonths, 36);
  assert.deepEqual(prompt(parsed.spec), prompt({ ...parsed.spec, recentWithinMonths: null }));
  assert.match(prompt(parsed.spec).user, /- \[s1\] Skill: Kubernetes ! \(core stack\) \| scored \| answer as: rung/);
});

test('a company type outside the list costs that role its type, never the whole reply (#553)', () => {
  const role = (position: string, companyType: unknown) => ({ position, employer: null, start: '2019', end: '2020', relevant: true, why: 'same work', sector: null, companyType });
  const parsed = parseScreenResponse(
    JSON.stringify({
      summary: { who: 'Backend developer, 6 years', did: 'Built the billing service', verdict: 'priority to talk to' },
      roles: [role('Backend Developer', 'Product'), role('Freelance Developer', 'freelance'), role('Contractor', 'self-employed'), role('Developer', 'outsourcing'), role('Intern', 7)],
      answers: [],
    }),
  );
  assert.ok(parsed.ok);
  assert.deepEqual(
    parsed.data.roles.map((r) => r.companyType),
    ['product', 'freelance', 'freelance', null, null],
  );
});

test('a years criterion that names a kind of work asks for it on every role; any other answer word is unknown (#645)', () => {
  const years = parseCriterionText('years', '5+ years in test automation for web applications')!;
  const rubric = RubricSchema.parse({
    criteria: [
      { id: 'y1', kind: 'years', label: years.label, mode: 'gate', weight: 3, source: 'posting', spec: years.spec },
      { id: 'y2', kind: 'years', label: '5+', mode: 'gate', weight: 3, source: 'you', spec: { min: 5 } },
    ],
  });
  const screen = buildScreenPrompt({ rubric, job: JOB, applicantText: 'QA Engineer, Acme (2019 – 2024)', number: 1 }).user;
  assert.match(screen, /- \[y1\] Years of experience: 5\+ years in test automation for web applications \| gate \| answer as: roles, with "work" on every role: was it test automation for web applications\?/);
  assert.match(screen, /- \[y2\] Years of experience: 5\+ \| gate \| answer as: roles\n/);
  const compare = buildComparePrompt({ rubric, job: JOB, applicants: [{ number: 1, text: 'a' }, { number: 2, text: 'b' }] }).user;
  assert.doesNotMatch(compare, /"work"/, 'a shortlist read head to head marks no roles');

  const role = { position: 'QA Engineer', employer: 'Acme', start: '2019', end: '2024', relevant: true, why: 'QA', sector: null, companyType: null };
  const parsed = parseScreenResponse(
    JSON.stringify({
      roles: [
        { ...role, work: [{ id: 'y1', answer: 'yes', quote: 'Wrote Cypress tests' }, { id: 'y1', answer: 'partly', quote: 'x' }, { id: 'y1' }] },
        role,
      ],
      answers: [],
    }),
  );
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.data.roles[0]!.work!.map((w) => w.answer), ['yes', 'unknown', 'unknown']);
  assert.equal(parsed.data.roles[1]!.work, undefined, 'a role with no "work" reads as a reply from before it');
});
