import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextThings, type NextThingsFacts } from './next-things';

const facts = (over: Partial<NextThingsFacts> = {}): NextThingsFacts => ({
  top: { id: 7, title: 'Senior Backend Engineer', company: 'Acme', fitScore: 87 },
  comparisons: 0,
  resumes: 1,
  compareCost: 'Your plan covers it.',
  ...over,
});

test('the three steps point at the best match, its comparison, then the editor', () => {
  assert.deepEqual(nextThings(facts()), [
    { title: 'Open your best match', body: 'Senior Backend Engineer at Acme, fit 87.', href: '/jobs/7' },
    {
      title: 'Compare it with your resume',
      body: 'One AI call: the keywords the posting asks for, its must-have conditions, and the edits to make. Your plan covers it.',
      href: '/jobs/7?tab=match',
    },
    { title: 'Tailor your resume for it', body: 'Apply the edits in the editor, save a version, download the .docx.', href: null },
  ]);
});

test('with no resume yet, the second step is the upload', () => {
  const steps = nextThings(facts({ resumes: 0 }));
  assert.equal(steps?.[1]?.href, '/resumes');
  assert.match(steps?.[1]?.body ?? '', /Upload your resume first/);
});

test('the card goes away with the first comparison, and never shows without a match', () => {
  assert.equal(nextThings(facts({ comparisons: 1 })), null);
  assert.equal(nextThings(facts({ top: null })), null);
});
