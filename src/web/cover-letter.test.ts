import { test } from 'node:test';
import assert from 'node:assert/strict';

test('cover-letter module imports without a DOM and exposes init', async () => {
  // @ts-expect-error — plain JS with no declaration file; the shape is asserted below.
  const mod = (await import('./public/cover-letter.mjs')) as { init: unknown };
  assert.equal(typeof mod.init, 'function');
});

test('statusFor names every save state and surfaces the gate verdict', async () => {
  // @ts-expect-error — plain JS with no declaration file.
  const { statusFor } = (await import('./public/cover-letter.mjs')) as {
    statusFor: (state: string, verdict?: string) => string;
  };
  assert.equal(statusFor(''), '');
  assert.match(statusFor('dirty'), /Unsaved/);
  assert.match(statusFor('saving'), /Saving/);
  assert.equal(statusFor('saved'), 'Saved');
  assert.match(statusFor('saved', 'warn'), /could not read/);
  assert.match(statusFor('saved', 'block'), /flags a claim/);
  assert.match(statusFor('failed'), /Could not save/);
});

test('nextDelay backs off and caps', async () => {
  // @ts-expect-error — plain JS with no declaration file.
  const { nextDelay } = (await import('./public/cover-letter.mjs')) as {
    nextDelay: (attempt: number) => number;
  };
  assert.ok(nextDelay(1) > nextDelay(0));
  assert.equal(nextDelay(99), 15_000, 'never sleeps forever');
});
