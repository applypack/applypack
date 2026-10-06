import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addUsage, billingOf, checkLocalAiUrl, checkOpenAiBaseUrl, count, hasUsage, isLocalUrl, NO_USAGE } from './ai-usage';

test('a count is what the vendor reported, or null', () => {
  assert.equal(count(1204), 1204);
  assert.equal(count(0), 0);
  for (const v of [undefined, null, -1, Number.NaN, '12', Infinity]) assert.equal(count(v), null);
});

test('two requests of one attempt add up, and a field stays null only when both are', () => {
  const a = { ...NO_USAGE, inputTokens: 100, outputTokens: 20, webSearches: 1 };
  const b = { ...NO_USAGE, inputTokens: 300, cacheReadTokens: 50 };
  assert.deepEqual(addUsage(a, b), { ...NO_USAGE, inputTokens: 400, outputTokens: 20, cacheReadTokens: 50, webSearches: 1 });
  assert.equal(hasUsage(NO_USAGE), false);
  assert.equal(hasUsage({ ...NO_USAGE, outputTokens: 0 }), true);
});

test('whose money each engine spends', () => {
  const remote = { openAiBaseUrl: 'https://api.openai.com/v1', geminiKey: false };
  assert.equal(billingOf('anthropic_api', remote), 'billed');
  assert.equal(billingOf('openai_api', remote), 'billed');
  assert.equal(billingOf('openai_api', { ...remote, openAiBaseUrl: 'https://openrouter.ai/api/v1' }), 'billed');
  assert.equal(billingOf('openai_api', { ...remote, openAiBaseUrl: 'http://localhost:11434/v1' }), 'local');
  assert.equal(billingOf('claude_code', remote), 'plan');
  assert.equal(billingOf('codex_cli', remote), 'plan');
  assert.equal(billingOf('gemini_cli', remote), 'plan');
  assert.equal(billingOf('gemini_cli', { ...remote, geminiKey: true }), 'billed');
  assert.equal(billingOf('local_api', remote), 'local');
});

test('a local server is this machine or a private network, nothing that merely looks like one', () => {
  for (const url of [
    'http://localhost:11434/v1',
    'http://127.0.0.1:1234/v1',
    'http://[::1]:8080/v1',
    'http://192.168.1.20:11434/v1',
    'http://10.0.0.5/v1',
    'http://172.20.1.1/v1',
    'http://host.docker.internal:11434/v1',
    'http://ollama.local:11434/v1',
  ]) {
    assert.equal(isLocalUrl(url), true, url);
  }
  for (const url of ['https://api.openai.com/v1', 'https://fd-ai.example.com/v1', 'http://172.32.0.1/v1', 'not a url']) {
    assert.equal(isLocalUrl(url), false, url);
  }
});


test('a server address is http(s) without a key in it, and plain http only on this machine', () => {
  assert.deepEqual(checkOpenAiBaseUrl('  http://127.0.0.1:11434/v1/  '), { ok: true, url: 'http://127.0.0.1:11434/v1' });
  assert.deepEqual(checkOpenAiBaseUrl('https://openrouter.ai/api/v1'), { ok: true, url: 'https://openrouter.ai/api/v1' });
  assert.deepEqual(checkOpenAiBaseUrl('http://host.docker.internal:1234/v1?x=1#y'), { ok: true, url: 'http://host.docker.internal:1234/v1' });
  assert.deepEqual(checkOpenAiBaseUrl('http://localhost:11434'), { ok: true, url: 'http://localhost:11434' });
  for (const bad of ['', 'localhost:11434/v1', 'ftp://127.0.0.1/v1', 'javascript:alert(1)', 'http://user:sk-1@127.0.0.1/v1', 'http://api.example.com/v1']) {
    assert.equal(checkOpenAiBaseUrl(bad).ok, false, bad);
  }
});

test("the local engine's address is Ollama's root, on this machine or the user's network", () => {
  assert.deepEqual(checkLocalAiUrl('http://127.0.0.1:11434'), { ok: true, url: 'http://127.0.0.1:11434' });
  assert.deepEqual(checkLocalAiUrl('http://127.0.0.1:11434/v1/'), { ok: true, url: 'http://127.0.0.1:11434' });
  assert.deepEqual(checkLocalAiUrl('http://host.docker.internal:11434/api'), { ok: true, url: 'http://host.docker.internal:11434' });
  assert.equal(checkLocalAiUrl('https://ollama.example.com').ok, false);
  assert.equal(checkLocalAiUrl('localhost:11434').ok, false);
});
