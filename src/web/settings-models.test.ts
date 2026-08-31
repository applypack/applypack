import { test } from 'node:test';
import assert from 'node:assert/strict';

// Served as a static ES module; node loads it the same way the browser does.
// @ts-expect-error — plain JS with no declaration file; the shape is asserted below.
const page = import('./public/settings-models.mjs') as Promise<{
  statusFor: (state: string, error?: string) => string;
  init: unknown;
}>;

test('statusFor names each state and prefers the server wording on failure', async () => {
  const { statusFor } = await page;
  assert.equal(statusFor(''), '');
  assert.match(statusFor('saving'), /Saving/);
  assert.equal(statusFor('saved'), 'Saved');
  assert.match(statusFor('failed'), /press Save models/);
  assert.equal(
    statusFor('failed', '"gemini-2.5-pro" is not a Claude Code CLI model id. Nothing saved.'),
    '"gemini-2.5-pro" is not a Claude Code CLI model id. Nothing saved.',
  );
});

test('settings-models module imports without a DOM and exposes init', async () => {
  assert.equal(typeof (await page).init, 'function');
});
