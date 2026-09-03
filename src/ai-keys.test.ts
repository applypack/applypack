import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_KEY_ENV_VARS,
  MAX_AI_KEY_LENGTH,
  aiKeySource,
  parseAiKeys,
  providerTakesKey,
  resolveAiKey,
} from './ai-keys';

describe('providerTakesKey', () => {
  it('covers the four key-bearing engines and not codex', () => {
    assert.deepEqual(Object.keys(AI_KEY_ENV_VARS), [
      'anthropic_api',
      'claude_code',
      'gemini_cli',
      'openai_api',
    ]);
    assert.equal(providerTakesKey('codex_cli'), false);
  });
});

describe('parseAiKeys', () => {
  it('returns an empty map for null, junk and wrong shapes', () => {
    assert.deepEqual(parseAiKeys(null), {});
    assert.deepEqual(parseAiKeys('nope'), {});
    assert.deepEqual(parseAiKeys({ openai_api: 42 }), {});
  });

  it('keeps known engines, drops unknown ids and blanks', () => {
    const keys = parseAiKeys({
      anthropic_api: ' sk-ant-live ',
      codex_cli: 'not-a-key-engine',
      gemini_cli: '   ',
      made_up: 'x',
    });
    assert.deepEqual(keys, { anthropic_api: 'sk-ant-live' });
  });

  it('drops an oversized entry whole rather than truncating a credential', () => {
    const keys = parseAiKeys({ openai_api: 'k'.repeat(MAX_AI_KEY_LENGTH + 1) });
    assert.deepEqual(keys, {});
    const atLimit = parseAiKeys({ openai_api: 'k'.repeat(MAX_AI_KEY_LENGTH) });
    assert.equal(atLimit.openai_api?.length, MAX_AI_KEY_LENGTH);
  });
});

describe('resolveAiKey', () => {
  const env = { ANTHROPIC_API_KEY: 'from-env', OPENAI_API_KEY: '  ' };

  it('prefers the stored key over .env', () => {
    assert.equal(resolveAiKey('anthropic_api', { anthropic_api: 'from-db' }, env), 'from-db');
  });

  it('falls back to .env when nothing is stored', () => {
    assert.equal(resolveAiKey('anthropic_api', {}, env), 'from-env');
  });

  it('treats a blank .env value as absent', () => {
    assert.equal(resolveAiKey('openai_api', {}, env), undefined);
  });

  it('has nothing to resolve for a login-only engine', () => {
    assert.equal(resolveAiKey('codex_cli', {}, { OPENAI_API_KEY: 'x' }), undefined);
  });
});

describe('aiKeySource', () => {
  it('names where the credential comes from', () => {
    const env = { GEMINI_API_KEY: 'g' };
    assert.equal(aiKeySource('gemini_cli', { gemini_cli: 'db' }, env), 'db');
    assert.equal(aiKeySource('gemini_cli', {}, env), 'env');
    assert.equal(aiKeySource('openai_api', {}, env), 'none');
    assert.equal(aiKeySource('codex_cli', {}, env), 'none');
  });
});
