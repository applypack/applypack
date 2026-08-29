import { test } from 'node:test';
import assert from 'node:assert/strict';

// The enhancement ships to the browser as a static ES module; node loads it the same way.
// @ts-expect-error — plain JS with no declaration file; the shape is asserted below.
const page = import('./public/target-start.mjs') as Promise<{
  mergeExtracted: (
    current: Record<string, string>,
    extracted: Record<string, unknown> | null,
  ) => Record<string, string>;
  init: unknown;
}>;

test('mergeExtracted fills only empty fields and never overwrites the user', async () => {
  const { mergeExtracted } = await page;
  const extracted = { company: ' Acme ', title: 'PHP Dev', location: 'Remote (US)' };
  assert.deepEqual(mergeExtracted({ company: '', title: '  ', location: '' }, extracted), {
    company: 'Acme',
    title: 'PHP Dev',
    location: 'Remote (US)',
  });
  assert.deepEqual(mergeExtracted({ company: 'MyCo', title: '', location: 'Kyiv' }, extracted), {
    title: 'PHP Dev',
  });
});

test('mergeExtracted ignores nulls, blanks and a failed extraction', async () => {
  const { mergeExtracted } = await page;
  assert.deepEqual(
    mergeExtracted({ company: '', title: '', location: '' }, { company: null, title: '  ', location: 42 }),
    {},
  );
  assert.deepEqual(mergeExtracted({ company: '', title: '', location: '' }, null), {});
});

test('target-start module imports without a DOM and exposes init', async () => {
  assert.equal(typeof (await page).init, 'function');
});

// @ts-expect-error — plain JS with no declaration file.
const cleaner = import('./public/posting-clean.mjs') as Promise<{
  cleanPostingText: (raw: string) => string;
}>;

const BODY = [
  'About the job',
  'Acme Robotics is hiring a Senior Backend Engineer for our platform team.',
  'You will build Node.js and TypeScript services on AWS, own PostgreSQL schemas',
  'and mentor a team of four engineers. Requirements: 5+ years backend experience,',
  'strong SQL, CI/CD and Docker. We offer equity and a fully remote culture.',
].join('\n');

test('cleanPostingText strips chrome but keeps the job-header block above the marker', async () => {
  const { cleanPostingText } = await cleaner;
  const navSpam = Array.from({ length: 30 }, (_, i) => `Nav item ${i} from the page shell`);
  const paste = [
    'Skip to main content',
    ...navSpam,
    'Sign in',
    'Senior Backend Engineer',
    'Acme Robotics · Remote (US) · $120K/yr - $160K/yr',
    '243 applicants',
    'Easy Apply',
    'Save',
    '',
    BODY,
    '',
    'Show less',
    'Set alert for similar jobs',
    'Similar jobs',
    'Backend Engineer at Other Corp',
  ].join('\n');
  const out = cleanPostingText(paste);
  assert.ok(out.includes('Senior Backend Engineer'), 'the title line survives');
  assert.ok(out.includes('$120K/yr - $160K/yr'), 'the salary line survives');
  assert.ok(out.includes('About the job'));
  assert.ok(out.includes('mentor a team of four engineers'));
  assert.ok(!out.includes('Skip to main content'));
  assert.ok(!out.includes('Nav item'), 'the Sign in line bounds the header — no nav spam leaks');
  assert.ok(!out.includes('Similar jobs'));
  assert.ok(!out.includes('243 applicants'));
  assert.ok(out.indexOf('Senior Backend Engineer') < out.indexOf('About the job'));
});

test('cleanPostingText drops noise lines and duplicates without a head marker', async () => {
  const { cleanPostingText } = await cleaner;
  const body = BODY.split('\n').slice(1).join('\n');
  const out = cleanPostingText(['Apply', body, body.split('\n')[0], 'Show more'].join('\n'));
  assert.ok(!out.includes('Apply'));
  assert.ok(!out.includes('Show more'));
  assert.ok(out.includes('mentor a team of four engineers'));
});

test('cleanPostingText returns the original when cleaning would leave too little', async () => {
  const { cleanPostingText } = await cleaner;
  const tiny = 'Sign in\nApply\nShort posting text.';
  assert.equal(cleanPostingText(tiny), tiny);
  const plain = BODY + '\n' + BODY;
  assert.equal(cleanPostingText(plain).includes('About the job'), true, 'plain text passes through');
});
