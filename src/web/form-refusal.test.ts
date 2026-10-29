import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { launcherRefusal } from './form-refusal';

const FORM = z.object({
  jobMode: z.enum(['existing', 'new']),
  companyName: z.string().max(200).default(''),
  description: z.string().trim().min(80).max(60_000),
});

const refusal = (sent: Record<string, unknown>, given: string[]) => {
  const parsed = FORM.safeParse(sent);
  assert.equal(parsed.success, false);
  return launcherRefusal(parsed.success ? [] : parsed.error.issues, 'Pick a job source and a resume.', given);
};

test("a missing choice keeps the form's own sentence (#682)", () => {
  assert.equal(refusal({ description: 'x'.repeat(100) }, ['jobMode']), 'Pick a job source and a resume.');
  assert.equal(refusal({ jobMode: 'existing', description: 'short' }, ['description']), 'Pick a job source and a resume.', 'too short is not given');
});

test('any other refusal names its field in the page\'s words (#682)', () => {
  assert.equal(
    refusal({ jobMode: 'new', companyName: 'x'.repeat(201), description: 'x'.repeat(100) }, ['jobMode']),
    'Company: At most 200 characters. Nothing was sent; fix that field and try again.',
  );
  assert.match(refusal({ jobMode: 'new', description: 'x'.repeat(60_001) }, ['description']), /^Job description: At most 60,000 characters\./);
});
