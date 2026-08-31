import { test } from 'node:test';
import assert from 'node:assert/strict';

test('cover-letter module imports without a DOM and exposes init', async () => {
  // @ts-expect-error — plain JS with no declaration file; the shape is asserted below.
  const mod = (await import('./public/cover-letter.mjs')) as { init: unknown };
  assert.equal(typeof mod.init, 'function');
});
