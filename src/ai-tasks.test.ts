import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AI_TASKS, AI_TASK_ROLE, isAiTask, taskOf } from './ai-tasks';
import type { AiFeature } from './ai-usage';

test('every task has a feature behind it, and the engine test belongs to none', () => {
  const features = ['classifier', 'prefilter', 'posting-extract', 'posting-brief', 'resume-scan', 'resume-structure', 'resume-match', 'resume-match-fast', 'resume-suggestions', 'resume-rewrite', 'resume-review', 'cover-letter', 'job-verify', 'screening', 'screening-compare', 'screening-bench'] as const;
  assert.deepEqual([...new Set(features.map(taskOf))].sort(), [...AI_TASKS].sort());
  assert.equal(taskOf('engine-test'), null);
});

test('the hourly volume and the writing are different tasks', () => {
  assert.equal(taskOf('classifier'), 'scoring');
  assert.equal(taskOf('prefilter'), 'scoring');
  assert.equal(taskOf('resume-match'), 'analysis');
  assert.equal(taskOf('cover-letter'), 'letters');
  assert.equal(taskOf('job-verify'), 'verify');
});

test('isAiTask knows the six and nothing else', () => {
  assert.ok(isAiTask('scoring'));
  assert.ok(!isAiTask('classifier'));
  assert.ok(!isAiTask(undefined));
});

// The AI tab names a model per task from AI_TASK_ROLE; the call sites are what really pick the slot.
test('every call site reads the model slot its task shows on the AI tab', () => {
  const files = (readdirSync('src', { recursive: true }) as string[]).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  const seen = new Set<string>();
  for (const file of files) {
    const source = readFileSync(join('src', file), 'utf8');
    for (const slot of source.matchAll(/\brole: '(classifier|resume|cover)'/g)) {
      // The label sits just before its role, on the same line or the one above.
      const label = source.slice(0, slot.index).split('label:').pop() ?? '';
      for (const [, name] of label.slice(0, 120).matchAll(/'([a-z-]+)'/g)) {
        const task = taskOf(name as AiFeature);
        if (!task) continue;
        seen.add(name!);
        assert.equal(slot[1], AI_TASK_ROLE[task], `${file}: ${name} runs on the ${slot[1]} slot, and the AI tab shows ${AI_TASK_ROLE[task]}`);
      }
    }
  }
  assert.ok(seen.size >= 15, `found only ${[...seen].join(', ')}`);
});

