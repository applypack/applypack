import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canStartWatch, setupLeft, type SetupLeftFacts } from './setup-left';

const facts = (over: Partial<SetupLeftFacts> = {}): SetupLeftFacts => ({
  aiReady: false,
  hasResume: false,
  searchReady: false,
  fetchingEnabled: false,
  ...over,
});

const state = (f: SetupLeftFacts) => setupLeft(f)?.map((r) => `${r.key}:${r.done ? 'done' : 'open'}`);

test('after Skip setup every row is open, in the order they are done', () => {
  assert.deepEqual(state(facts()), ['ai:open', 'resume:open', 'search:open', 'watch:open']);
});

test('the card goes once an AI, a resume and a search are there — a pause alone does not bring it back', () => {
  assert.equal(setupLeft(facts({ aiReady: true, hasResume: true, searchReady: true, fetchingEnabled: false })), null);
  assert.equal(setupLeft(facts({ aiReady: true, hasResume: true, searchReady: true, fetchingEnabled: true })), null);
});

test('a search from the three questions still asks for the resume, on the Resumes page', () => {
  const rows = setupLeft(facts({ aiReady: true, searchReady: true, fetchingEnabled: true }));
  assert.deepEqual(state(facts({ aiReady: true, searchReady: true, fetchingEnabled: true })), ['ai:done', 'resume:open', 'search:done', 'watch:done']);
  assert.equal(rows?.find((r) => r.key === 'resume')?.href, '/resumes');
});

test('with no search yet the resume row leads to the setup step that drafts one from it', () => {
  assert.equal(setupLeft(facts({ aiReady: true }))?.find((r) => r.key === 'resume')?.href, '/welcome?step=profile');
});

test('the watch is not done while it would search for nothing, and can be started only when it would', () => {
  assert.equal(setupLeft(facts({ fetchingEnabled: true }))?.find((r) => r.key === 'watch')?.done, false);
  assert.equal(canStartWatch(facts({ aiReady: true, searchReady: true })), true);
  assert.equal(canStartWatch(facts({ aiReady: true })), false);
  assert.equal(canStartWatch(facts({ aiReady: true, searchReady: true, fetchingEnabled: true })), false);
});
