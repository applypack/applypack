import { test } from 'node:test';
import assert from 'node:assert/strict';

// The activity module ships to the browser as a static ES module; node loads it the same way.
// @ts-expect-error — plain JS with no declaration file; the shape is asserted below.
const page = import('./public/fetch-run.mjs') as Promise<{
  sourceLine: (state: Record<string, unknown>) => string;
  fetchActivity: (step: string, state: Record<string, unknown>) => string;
}>;

test('sourceLine narrates the sources as they answer', async () => {
  const { sourceLine } = await page;
  assert.equal(sourceLine({ sourcesTotal: null, sourcesDone: 0, jobsFetched: 0 }), 'Contacting the first source…');
  assert.equal(
    sourceLine({
      sourcesTotal: 71,
      sourcesDone: 14,
      jobsFetched: 312,
      lastSource: { name: 'RemoteOK', count: 120, failed: false },
    }),
    '14 of 71 sources · 312 jobs so far · RemoteOK: 120 jobs',
  );
  assert.match(
    sourceLine({ sourcesTotal: 71, sourcesDone: 2, jobsFetched: 1, lastSource: { name: 'Acme', count: 0, failed: true } }),
    /1 job so far · Acme: failed$/,
  );
  assert.match(
    sourceLine({ sourcesTotal: 71, sourcesDone: 3, jobsFetched: 1, lastSource: { name: 'Acme', count: 0, failed: false } }),
    /Acme: no jobs$/,
  );
});

test('fetchActivity paces the store step by mode and ignores unknown steps', async () => {
  const { fetchActivity } = await page;
  const unscored = fetchActivity('store', { classify: false, stageElapsedMs: 0 });
  assert.match(unscored, /^Filtering/);
  assert.match(fetchActivity('store', { classify: false, stageElapsedMs: 10 * 60_000 }), /unscored/);
  assert.match(fetchActivity('store', { classify: true, stageElapsedMs: 10 * 60_000 }), /alerts/);
  assert.equal(fetchActivity('fetch', { sourcesTotal: null }), 'Contacting the first source…');
  assert.equal(fetchActivity('nope', {}), '');
});
