import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testReport, type TestFacts } from './ai-test-report';

const facts = (over: Partial<TestFacts> = {}): TestFacts => ({
  engine: 'Local model (Ollama)',
  model: 'stand-in',
  attempt: { text: 'OK' },
  elapsedMs: 2_000,
  failure: null,
  offered: null,
  pickedForTest: false,
  unlistable: '',
  ...over,
});

test('a press that waited for the local server says the engine’s own time, as the ledger books it (#611)', () => {
  // Measured: the second of two presses waited 1.8 s for the one slot, then the model took 2.0 s.
  const { durationMs, result } = testReport(facts({ attempt: { text: 'OK', queuedMs: 1_800 }, elapsedMs: 3_809 }));
  assert.equal(durationMs, 2_009);
  assert.equal(result.text, 'Local model (Ollama) works — replied in 2.0s (model stand-in).');
});

test('a failure says the same time', () => {
  const { durationMs, result } = testReport(facts({ attempt: { text: null, queuedMs: 500 }, elapsedMs: 1_700, failure: 'no answer' }));
  assert.equal(durationMs, 1_200);
  assert.deepEqual(result, { ok: false, text: 'Local model (Ollama) test failed after 1.2s — no answer.' });
});

test('a call that never queued keeps its whole time', () => {
  assert.equal(testReport(facts({ elapsedMs: 4_321 })).durationMs, 4_321);
});

test('a reply names the model, or the CLI default, and what the server lists', () => {
  assert.equal(testReport(facts({ model: '', engine: 'Claude Code CLI' })).result.text, 'Claude Code CLI works — replied in 2.0s (model CLI default).');
  const listed = testReport(facts({ offered: ['a', 'b', 'c', 'd', 'e', 'f'], pickedForTest: true })).result;
  assert.equal(listed.ok, true);
  assert.match(listed.text, /pick yours below\. The server offers 6 models: a, b, c, d, e, …\.$/);
});

test('a failed call on a server that does not list the model says so', () => {
  const { result } = testReport(facts({ attempt: { text: null }, offered: ['other'], unlistable: '' }));
  assert.match(result.text, /no reason reported .* The server does not list "stand-in"\. The server offers 1 model: other\.$/);
});
