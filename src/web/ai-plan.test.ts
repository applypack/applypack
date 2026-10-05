import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiPlanRows, taskShown } from './ai-plan';
import { resolveAiEngine, type AiEngineEnv } from '../ai-engine';

const ENV: AiEngineEnv = {
  provider: 'claude_code',
  hasAnthropicKey: false,
  hasOpenAiKey: false,
  openAiLocal: false,
  geminiUsable: false,
  codexUsable: false,
  classifierModel: 'claude-haiku-4-5-20251001',
  resumeModel: '',
  coverModel: '',
  openAiModel: '',
  localModel: 'gemma4:e4b',
};

test('each task names the engine that answers it, the model in the slot it reads, and whose money that is', () => {
  const engine = resolveAiEngine({ order: ['local_api', 'claude_code'], tasks: { local_api: ['scoring'] } }, ENV);
  const rows = aiPlanRows(engine, (id) => (id === 'local_api' ? 'local' : 'plan'), false);
  assert.deepEqual(rows.map((r) => r.label), ['Scoring postings', 'Reading a resume', 'Resume analysis', 'Cover letters', 'Is it real?']);
  assert.deepEqual(rows[0]?.engines, [
    { id: 'local_api', label: 'Local model (Ollama)', model: 'gemma4:e4b', billing: 'local' },
    { id: 'claude_code', label: 'Claude Code CLI', model: 'claude-haiku-4-5-20251001', billing: 'plan' },
  ]);
  assert.deepEqual(rows[3]?.engines, [{ id: 'claude_code', label: 'Claude Code CLI', model: 'claude-opus-5', billing: 'plan' }]);
  assert.ok(rows.every((r) => !r.unclaimed));
});

test('Screening is a row only while employer mode is on', () => {
  const engine = resolveAiEngine(null, ENV);
  assert.equal(aiPlanRows(engine, () => 'plan', true).at(-1)?.label, 'Screening applicants');
  assert.ok(taskShown('scoring', false));
  assert.ok(!taskShown('screening', false));
});
