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
