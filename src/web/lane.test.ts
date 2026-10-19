import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laneTimes, stepBand, TIMED_FEATURES } from './lane';
import type { AnswerTimes } from '../ai-spend';

const lane = (engine: string, model: string, times: AnswerTimes[] = []) => laneTimes({ engine, model }, times);
/** Answered calls of one feature on an engine and model, as the ledger sums them. */
const timed = (feature: string, engine: string, model: string, answered: number, medianMs: number, p90Ms = medianMs): AnswerTimes => ({
  feature,
  engine,
  model,
  answered,
  medianMs,
  p90Ms,
});

test('the lane is the engine and the model family; anything else is unmeasured', () => {
  assert.equal(lane('claude_code', 'claude-sonnet-5').lane, 'cli-sonnet');
  assert.equal(lane('claude_code', 'claude-haiku-4-5-20251001').lane, 'cli-haiku');
  assert.equal(lane('anthropic_api', 'claude-opus-5').lane, 'api-opus');
  assert.equal(lane('anthropic_api', '').lane, 'other');
  assert.equal(lane('gemini_cli', 'gemini-2.5-pro').lane, 'other');
  assert.equal(lane('openai_api', 'claude-sonnet-5').lane, 'other');
  assert.equal(laneTimes(null, []).lane, 'other');
});

test('a measured lane names its band per step; an unmeasured one the rough time on the engine and model that answer', () => {
  assert.equal(stepBand('keywords', lane('claude_code', 'claude-sonnet-5')), 'about 20 s on Sonnet 5 through the Claude CLI');
  assert.equal(stepBand('match', lane('anthropic_api', 'claude-opus-5')), 'about 110 s on Opus 5 on the API');
  assert.equal(stepBand('scan', lane('claude_code', 'claude-sonnet-5')), 'roughly 20 s on Sonnet 5 through the Claude CLI');
  assert.equal(stepBand('letter', lane('claude_code', 'claude-sonnet-5')), null);
  // #527: a local-only install's comparison runs on its own model, never "on Opus".
  assert.equal(stepBand('match', lane('local_api', 'gemma4:26b')), '1½ to 2 minutes on Local model (Ollama) · gemma4:26b');
  assert.equal(stepBand('keywords', lane('local_api', 'llama3.1:8b')), 'half a minute to a minute on Local model (Ollama) · llama3.1:8b');
  assert.equal(stepBand('review', laneTimes(null, [])), 'about a minute on this engine');
  assert.equal(lane('claude_code', 'claude-haiku-4-5').name, 'Haiku 4.5 through the Claude CLI');
  assert.equal(laneTimes(null, []).name, 'this engine');
});

test('#483: ten answered calls on the engine and model that will answer state their own time, a local model included', () => {
  const ten = [timed('resume-match', 'local_api', 'llama3.1:8b', 10, 48_200)];
  assert.equal(stepBand('match', lane('local_api', 'llama3.1:8b', ten)), 'about 48.2s on Local model (Ollama) · llama3.1:8b, going by your last 10 calls');
  // Nine is an anecdote: the generic words stay.
  const generic = '1½ to 2 minutes on Local model (Ollama) · llama3.1:8b';
  assert.equal(stepBand('match', lane('local_api', 'llama3.1:8b', [timed('resume-match', 'local_api', 'llama3.1:8b', 9, 48_200)])), generic);
  // Another model's calls, or another step's, are not this one's.
  assert.equal(stepBand('match', lane('local_api', 'qwen2.5:14b', ten)), '1½ to 2 minutes on Local model (Ollama) · qwen2.5:14b');
  assert.equal(stepBand('suggestions', lane('local_api', 'llama3.1:8b', ten)), 'about a minute on Local model (Ollama) · llama3.1:8b');
  // On a measured lane this install's own calls win over the reference pair's.
  const cli = [timed('resume-scan', 'claude_code', '', 20, 31_000), timed('resume-scan', 'claude_code', 'claude-sonnet-5', 12, 18_000)];
  assert.equal(stepBand('scan', lane('claude_code', 'claude-sonnet-5', cli)), 'about 18.0s on Sonnet 5 through the Claude CLI, going by your last 12 calls');
  assert.equal(stepBand('scan', lane('claude_code', '', cli)), 'about 31.0s on Claude Code CLI · CLI default, going by your last 20 calls');
});

test('the slow tail is said as AI usage says it: from ten answers, and only when it is slower than the middle', () => {
  const slow = [timed('resume-review', 'openai_api', 'qwen2.5:14b', 20, 40_000, 95_000)];
  assert.equal(stepBand('review', lane('openai_api', 'qwen2.5:14b', slow)), 'about 40.0s on OpenAI-compatible API · qwen2.5:14b, 9 in 10 under 1.6m, going by your last 20 calls');
  const even = [timed('resume-review', 'openai_api', 'qwen2.5:14b', 20, 40_000, 42_000)];
  assert.doesNotMatch(stepBand('review', lane('openai_api', 'qwen2.5:14b', even)) ?? '', /9 in 10/);
});

test('every step that states a time names the feature its calls are recorded under', () => {
  assert.deepEqual([...TIMED_FEATURES].sort(), ['posting-brief', 'resume-match', 'resume-match-fast', 'resume-review', 'resume-scan', 'resume-structure', 'resume-suggestions']);
  // The posting's brief has no measured lane band, so only its own calls give it one.
  assert.equal(stepBand('brief', lane('claude_code', 'claude-sonnet-5')), null);
  assert.match(stepBand('brief', lane('claude_code', 'claude-sonnet-5', [timed('posting-brief', 'claude_code', 'claude-sonnet-5', 10, 25_000)])) ?? '', /^about 25\.0s/);
  assert.match(stepBand('rubric', lane('claude_code', 'claude-sonnet-5', [timed('posting-brief', 'claude_code', 'claude-sonnet-5', 10, 25_000)])) ?? '', /^about 25\.0s/, 'a screening\'s criteria come from the same brief');
});

test('#580: no band says "about ~": every lane, every step', () => {
  for (const [engine, model] of [['claude_code', 'claude-haiku-4-5'], ['claude_code', 'claude-sonnet-5'], ['claude_code', 'claude-opus-5'], ['anthropic_api', 'claude-haiku-4-5'], ['anthropic_api', 'claude-sonnet-5'], ['anthropic_api', 'claude-opus-5'], ['local_api', 'gemma4:26b']] as const) {
    for (const step of ['scan', 'structure', 'keywords', 'match', 'suggestions', 'review']) {
      const said = stepBand(step, lane(engine, model)) ?? '';
      assert.doesNotMatch(said, /~|about about|about roughly|about more/, `${engine} ${model} ${step}: ${said}`);
      assert.match(said, / on /);
    }
  }
});
