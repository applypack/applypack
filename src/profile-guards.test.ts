import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  capFitForMissingStack,
  isBlankProfile,
  NO_PROFILE_STACK_FLAG,
  NO_STACK_FIT_CAP,
} from './profile-guards';
import type { ClaudeClassification } from './types';

const classification = (
  over: Partial<ClaudeClassification> = {},
): ClaudeClassification => ({
  fit_score: 93,
  location_match: true,
  salary_min_usd: null,
  salary_max_usd: null,
  tech_match: [],
  red_flags: [],
  summary: 'x',
  ...over,
});

test('isBlankProfile: true only when stack AND roles are both empty', () => {
  assert.equal(isBlankProfile({ stackRequired: [], roleTypes: [] }), true);
  assert.equal(isBlankProfile({ stackRequired: ['php'], roleTypes: [] }), false);
  assert.equal(isBlankProfile({ stackRequired: [], roleTypes: ['backend'] }), false);
  assert.equal(
    isBlankProfile({ stackRequired: ['php'], roleTypes: ['backend'] }),
    false,
  );
});

test('isBlankProfile: whitespace-only entries count as empty', () => {
  assert.equal(isBlankProfile({ stackRequired: ['', '  '], roleTypes: [' '] }), true);
});

test('capFitForMissingStack: empty stack caps fit at 50 and adds the flag', () => {
  const capped = capFitForMissingStack(classification(), { stackRequired: [] });
  assert.equal(capped.fit_score, NO_STACK_FIT_CAP);
  assert.deepEqual(capped.red_flags, [NO_PROFILE_STACK_FLAG]);
});

test('capFitForMissingStack: scores at or under the cap keep their value', () => {
  const capped = capFitForMissingStack(classification({ fit_score: 32 }), {
    stackRequired: [],
  });
  assert.equal(capped.fit_score, 32);
  assert.deepEqual(capped.red_flags, [NO_PROFILE_STACK_FLAG]);
});

test('capFitForMissingStack: non-empty stack returns the input untouched', () => {
  const input = classification();
  const out = capFitForMissingStack(input, { stackRequired: ['php'] });
  assert.equal(out, input);
});

test('capFitForMissingStack: existing flags are kept, ours not duplicated', () => {
  const capped = capFitForMissingStack(
    classification({ red_flags: ['low-pay', NO_PROFILE_STACK_FLAG] }),
    { stackRequired: [] },
  );
  assert.deepEqual(capped.red_flags, ['low-pay', NO_PROFILE_STACK_FLAG]);
});

test('capFitForMissingStack: does not mutate the input', () => {
  const input = classification();
  capFitForMissingStack(input, { stackRequired: [] });
  assert.equal(input.fit_score, 93);
  assert.deepEqual(input.red_flags, []);
});
