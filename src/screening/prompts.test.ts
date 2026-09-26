import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScreenPrompt } from './prompts';
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
