import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GEMINI_DEFAULT_CLASSIFIER_MODEL,
  GEMINI_DEFAULT_RESUME_MODEL,
  isAiProviderId,
  modelFitsProvider,
  resolveAiEngine,
  type AiEngineEnv,
} from './ai-engine';

const ENV: AiEngineEnv = {
  provider: 'claude_code',
  hasAnthropicKey: false,
  classifierModel: 'claude-haiku-4-5-20251001',
  resumeModel: 'claude-opus-5',
};

describe('resolveAiEngine', () => {
  it('follows .env when there is no stored row', () => {
    assert.deepEqual(resolveAiEngine(null, ENV), {
      providerId: 'claude_code',
      classifierModel: ENV.classifierModel,
      resumeModel: ENV.resumeModel,
    });
  });

  it('stored provider overrides .env and switches model family defaults', () => {
    const out = resolveAiEngine(
      { aiProvider: 'gemini_cli', aiModelClassifier: null, aiModelResume: null },
      ENV,
    );
    assert.deepEqual(out, {
      providerId: 'gemini_cli',
      classifierModel: GEMINI_DEFAULT_CLASSIFIER_MODEL,
      resumeModel: GEMINI_DEFAULT_RESUME_MODEL,
    });
  });

  it('keeps stored models that fit the provider', () => {
    const out = resolveAiEngine(
      {
        aiProvider: 'claude_code',
        aiModelClassifier: 'claude-sonnet-5',
        aiModelResume: 'opus',
      },
      ENV,
    );
    assert.equal(out.classifierModel, 'claude-sonnet-5');
    assert.equal(out.resumeModel, 'opus');
  });

  it('drops a stored model from the wrong family', () => {
    const out = resolveAiEngine(
      {
        aiProvider: 'gemini_cli',
        aiModelClassifier: 'claude-haiku-4-5-20251001',
        aiModelResume: 'gemini-2.5-pro',
      },
      ENV,
    );
    assert.equal(out.classifierModel, GEMINI_DEFAULT_CLASSIFIER_MODEL);
    assert.equal(out.resumeModel, 'gemini-2.5-pro');
  });

  it('anthropic_api without a key falls back to the .env provider', () => {
    const out = resolveAiEngine(
      { aiProvider: 'anthropic_api', aiModelClassifier: null, aiModelResume: null },
      ENV,
    );
    assert.equal(out.providerId, 'claude_code');
  });

  it('anthropic_api with a key is honoured', () => {
    const out = resolveAiEngine(
      { aiProvider: 'anthropic_api', aiModelClassifier: null, aiModelResume: null },
      { ...ENV, hasAnthropicKey: true },
    );
    assert.equal(out.providerId, 'anthropic_api');
  });

  it('ignores unknown provider strings and blank models', () => {
    const out = resolveAiEngine(
      { aiProvider: 'openai', aiModelClassifier: '  ', aiModelResume: '' },
      ENV,
    );
    assert.deepEqual(out, {
      providerId: 'claude_code',
      classifierModel: ENV.classifierModel,
      resumeModel: ENV.resumeModel,
    });
  });
});

describe('modelFitsProvider', () => {
  it('gemini models only fit gemini_cli', () => {
    assert.equal(modelFitsProvider('gemini-2.5-flash', 'gemini_cli'), true);
    assert.equal(modelFitsProvider('gemini-2.5-flash', 'claude_code'), false);
    assert.equal(modelFitsProvider('claude-opus-5', 'gemini_cli'), false);
  });

  it('claude aliases fit claude_code but not the Messages API', () => {
    assert.equal(modelFitsProvider('haiku', 'claude_code'), true);
    assert.equal(modelFitsProvider('haiku', 'anthropic_api'), false);
    assert.equal(modelFitsProvider('claude-opus-5', 'anthropic_api'), true);
  });
});

describe('isAiProviderId', () => {
  it('accepts the three known ids and nothing else', () => {
    assert.equal(isAiProviderId('gemini_cli'), true);
    assert.equal(isAiProviderId('anthropic_api'), true);
    assert.equal(isAiProviderId('claude_code'), true);
    assert.equal(isAiProviderId('openai'), false);
    assert.equal(isAiProviderId(null), false);
  });
});
