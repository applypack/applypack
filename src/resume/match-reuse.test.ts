import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canReuseMatch, readPromptVersion, reuseNotice } from './match-reuse';

const TEXT = 'Nazar Boyko\nSenior Software Engineer\n## SKILLS\nPHP, Laravel, React';
const stored = { resumeText: TEXT, promptVersion: 5 };

test('identical text under the same prompt reuses the stored row', () => {
  assert.equal(canReuseMatch(stored, TEXT, 5), true);
});

test('a one-character edit is a new analysis', () => {
  assert.equal(canReuseMatch(stored, `${TEXT}.`, 5), false);
  assert.equal(canReuseMatch(stored, TEXT.replace('React', 'react'), 5), false);
});

test('a prompt bump is a new analysis', () => {
  assert.equal(canReuseMatch(stored, TEXT, 6), false);
});

test('no previous row, or one without a version marker, never reuses', () => {
  assert.equal(canReuseMatch(null, TEXT, 5), false);
  assert.equal(canReuseMatch({ resumeText: TEXT, promptVersion: null }, TEXT, 5), false);
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
