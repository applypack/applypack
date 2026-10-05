import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AI_TASKS, isAiTask, taskOf } from './ai-tasks';

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
