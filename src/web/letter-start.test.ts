import { test } from 'node:test';
import assert from 'node:assert/strict';

// Served as a static ES module; node loads it the same way the browser does.
// @ts-expect-error — plain JS with no declaration file; the shape is asserted below.
const page = import('./public/letter-start.mjs') as Promise<{
  matchesQuery: (text: string, query: string) => boolean;
  filterOptions: (
    options: { value: string; text: string }[],
    query: string,
  ) => { value: string; text: string }[];
  init: unknown;
}>;

const OPTIONS = [
  { value: '1', text: 'Reddit — Fullstack Software Engineer · fit 91 · today' },
  { value: '2', text: 'GitLab — Fullstack Engineer (TypeScript) · fit 88 · 2d old' },
  { value: '3', text: 'Prompt Health — Senior Full Stack Engineer · fit 98 · 4d old' },
];

test('matchesQuery is case-insensitive and ANDs its terms', async () => {
  const { matchesQuery } = await page;
  assert.equal(matchesQuery('Reddit — Fullstack Engineer', 'reddit'), true);
  assert.equal(matchesQuery('Reddit — Fullstack Engineer', 'REDDIT full'), true);
  assert.equal(matchesQuery('Reddit — Fullstack Engineer', 'reddit gitlab'), false);
  assert.equal(matchesQuery('anything', '   '), true, 'an empty query keeps everything');
});

test('filterOptions narrows by company or title and can empty out', async () => {
  const { filterOptions } = await page;
  assert.deepEqual(filterOptions(OPTIONS, '').length, 3);
  assert.deepEqual(
    filterOptions(OPTIONS, 'gitlab').map((o) => o.value),
    ['2'],
  );
  assert.deepEqual(
    filterOptions(OPTIONS, 'fullstack').map((o) => o.value),
    ['1', '2'],
  );
  assert.deepEqual(filterOptions(OPTIONS, 'nothing here'), []);
});

test('letter-start module imports without a DOM and exposes init', async () => {
  assert.equal(typeof (await page).init, 'function');
});
