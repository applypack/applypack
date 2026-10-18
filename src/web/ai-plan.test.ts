import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiPlanRows, pickedTasks, planSummary, taskShown, tasksSaved } from './ai-plan';
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

test('a save answers in the tasks the page shows, never one it hides', () => {
  assert.equal(tasksSaved('Claude Code CLI', undefined, false), 'Claude Code CLI takes every task.');
  assert.equal(tasksSaved('Local model (Ollama)', ['scoring', 'screening'], false), 'Local model (Ollama) takes Scoring postings, and nothing else.');
  assert.equal(tasksSaved('Local model (Ollama)', ['scoring', 'screening'], true), 'Local model (Ollama) takes Scoring postings, Screening applicants, and nothing else.');
  // Every visible box unticked while Screening rides along hidden: the user sees an empty row.
  assert.equal(tasksSaved('Claude Code CLI', ['screening'], false), 'Claude Code CLI takes no task now. It answers only one that no other engine takes.');
  assert.equal(tasksSaved('Claude Code CLI', [], true), 'Claude Code CLI takes no task now. It answers only one that no other engine takes.');
});

test('while the page hides Screening, a first list sends it where Resume analysis goes, and a later one keeps it', () => {
  // A local model narrowed to scoring is not handed applicants by a box nobody saw.
  assert.deepEqual(pickedTasks(['scoring'], false, undefined), ['scoring']);
  assert.deepEqual(pickedTasks(['scoring', 'screening'], false, undefined), ['scoring']);
  assert.deepEqual(pickedTasks(['resume-read', 'analysis', 'letters'], false, undefined), ['resume-read', 'analysis', 'letters', 'screening']);
  // A choice made with the box in sight survives a save made without it, either way.
  assert.deepEqual(pickedTasks(['scoring', 'analysis'], false, ['scoring', 'analysis']), ['scoring', 'analysis']);
  assert.deepEqual(pickedTasks(['scoring'], false, ['screening']), ['scoring', 'screening']);
  // With its own box on the page, the box decides.
  assert.deepEqual(pickedTasks(['analysis'], true, ['screening']), ['analysis']);
  assert.deepEqual(pickedTasks(['scoring', 'screening'], true, undefined), ['scoring', 'screening']);
});

test('the plan in a sentence: one engine for everything, and who stands behind it', () => {
  const one = resolveAiEngine({ order: ['claude_code', 'local_api'] }, ENV);
  const summary = planSummary(aiPlanRows(one, (id) => (id === 'local_api' ? 'local' : 'plan'), false));
  assert.equal(summary?.lead, 'Claude Code CLI answers every task, on your subscription.');
  assert.equal(summary?.fallback, 'If it fails, Local model (Ollama) steps in.');
});

test('the plan in a sentence: tasks split between engines send the reader to the table', () => {
  const split = resolveAiEngine({ order: ['local_api', 'claude_code'], tasks: { local_api: ['scoring'] } }, ENV);
  const summary = planSummary(aiPlanRows(split, (id) => (id === 'local_api' ? 'local' : 'plan'), false));
  assert.equal(summary?.lead, '2 engines share the tasks; the table below says which does what.');
  assert.equal(summary?.fallback, null);
});

test('the plan in a sentence: nothing to say when a task has no engine', () => {
  assert.equal(planSummary([]), null);
});
