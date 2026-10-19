import { test } from 'node:test';
import assert from 'node:assert/strict';

// Served as a static ES module; node loads it the same way the browser does.
// @ts-expect-error — plain JS with no declaration file; the shape is asserted below.
const page = import('./public/settings-models.mjs') as Promise<{
  statusFor: (state: string, error?: string) => string;
  wireForm: (form: unknown) => void;
  init: unknown;
}>;

test('statusFor names each state and prefers the server wording on failure', async () => {
  const { statusFor } = await page;
  assert.equal(statusFor(''), '');
  assert.match(statusFor('saving'), /Saving/);
  assert.equal(statusFor('saved'), 'Saved');
  assert.match(statusFor('failed'), /press the Save button/);
  assert.equal(
    statusFor('failed', '"gemini-2.5-pro" is not a Claude Code CLI model id. Nothing saved.'),
    '"gemini-2.5-pro" is not a Claude Code CLI model id. Nothing saved.',
  );
});

test('settings-models module imports without a DOM and exposes init', async () => {
  assert.equal(typeof (await page).init, 'function');
});

test('Enter in a model field saves in place, once, instead of reloading the page (#563)', async (t) => {
  const { wireForm } = await page;
  // A stand-in form: its fields, its status line, the listeners the module adds.
  const fields = [['provider', 'local_api'], ['classifier', 'gemma4:e4b']];
  const status = { textContent: '' };
  const listeners: Record<string, (e: unknown) => void> = {};
  const form = {
    action: '/settings/ai/models',
    querySelector: (selector: string) => (selector === '[data-save-status]' ? status : null),
    querySelectorAll: () => [],
    addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn),
  };
  const posted: string[] = [];
  const globals = globalThis as Record<string, unknown>;
  const saved = { FormData: globals.FormData, fetch: globals.fetch, document: globals.document };
  t.after(() => Object.assign(globals, saved));
  Object.assign(globals, {
    FormData: function FormData() {
      return fields;
    },
    fetch: async (_url: string, init: { body: URLSearchParams }) => {
      posted.push(init.body.toString());
      return { ok: true, json: async () => ({ ok: true }) };
    },
    document: { querySelector: () => null },
  });
  wireForm(form);
  let prevented = false;
  // The browser fires `change` as Enter commits the value, then submits the form.
  listeners.change!({ target: { tagName: 'INPUT' } });
  listeners.submit!({ preventDefault: () => (prevented = true) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(prevented, true);
  assert.deepEqual(posted, ['provider=local_api&classifier=gemma4%3Ae4b']);
  assert.equal(status.textContent, 'Saved');
});
