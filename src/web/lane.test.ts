import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandFor, laneLabel, laneOf } from './lane';

test('the lane is the engine and the model family; anything else is unmeasured', () => {
  assert.equal(laneOf('claude_code', 'claude-sonnet-5'), 'cli-sonnet');
  assert.equal(laneOf('claude_code', 'claude-haiku-4-5-20251001'), 'cli-haiku');
  assert.equal(laneOf('anthropic_api', 'claude-opus-5'), 'api-opus');
  assert.equal(laneOf('anthropic_api', ''), 'other');
  assert.equal(laneOf('gemini_cli', 'gemini-2.5-pro'), 'other');
  assert.equal(laneOf('openai_api', 'claude-sonnet-5'), 'other');
});

test('a measured lane names its band per step; an unmeasured one names nothing', () => {
  assert.equal(bandFor('keywords', 'cli-sonnet'), '20 s');
  assert.equal(bandFor('match', 'api-opus'), '110 s');
  assert.equal(bandFor('letter', 'cli-sonnet'), null);
  assert.equal(bandFor('keywords', 'other'), null);
  assert.equal(laneLabel('cli-haiku'), 'Haiku 4.5 through the Claude CLI');
  assert.equal(laneLabel('other'), 'this engine');
});
