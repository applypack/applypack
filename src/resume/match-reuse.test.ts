import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPromptVersion, reuseDecision, reuseNotice, suggestNotice, type StoredMatch } from './match-reuse';

const TEXT = 'Nazar Boyko\nSenior Software Engineer\n## SKILLS\nPHP, Laravel, React';
const full: StoredMatch = { resumeText: TEXT, promptVersion: 5, mode: 'full' };
const fast: StoredMatch = { ...full, mode: 'fast' };

test('identical text under the same prompt reuses the stored row', () => {
  assert.equal(reuseDecision(full, TEXT, 5, 'fast'), 'reuse');
  assert.equal(reuseDecision(full, TEXT, 5, 'full'), 'reuse', 'a full row answers a full request');
  assert.equal(reuseDecision(fast, TEXT, 5, 'fast'), 'reuse');
});

test('a fast row answers a full request with the suggestions call only', () => {
  assert.equal(reuseDecision(fast, TEXT, 5, 'full'), 'suggest');
});

test('a one-character edit is a new analysis', () => {
  assert.equal(reuseDecision(full, `${TEXT}.`, 5, 'fast'), 'none');
  assert.equal(reuseDecision(full, TEXT.replace('React', 'react'), 5, 'full'), 'none');
});

test('a prompt bump is a new analysis', () => {
  assert.equal(reuseDecision(full, TEXT, 6, 'fast'), 'none');
  assert.equal(reuseDecision(fast, TEXT, 6, 'full'), 'none', 'never suggestions on a stale frame');
});

test('no previous row, or one without a version marker, never reuses', () => {
  assert.equal(reuseDecision(null, TEXT, 5, 'fast'), 'none');
  assert.equal(reuseDecision({ ...full, promptVersion: null }, TEXT, 5, 'fast'), 'none');
});

test('readPromptVersion reads the marker and nothing else', () => {
  assert.equal(readPromptVersion({ v: 3, score: 71, promptVersion: 5 }), 5);
  assert.equal(readPromptVersion({ v: 3, score: 71 }), null, 'pre-marker rows');
  assert.equal(readPromptVersion({ promptVersion: '5' }), null, 'a string is not a version');
  assert.equal(readPromptVersion({}), null);
  assert.equal(readPromptVersion(null), null);
});

test('reuseNotice names the age and says the model was not called', () => {
  const notice = reuseNotice('3m ago');
  assert.match(notice, /3m ago/);
  assert.match(notice, /not called again/);
});

test('suggestNotice keeps the verdicts and never claims the model stayed idle', () => {
  const notice = suggestNotice('3m ago');
  assert.match(notice, /3m ago/);
  assert.match(notice, /verdicts and score/);
  assert.doesNotMatch(notice, /not called/);
});
