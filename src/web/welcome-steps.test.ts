import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentStep, isWelcomeStep, needsWelcome, stepDone, summarizeScoreRun, type WelcomeFacts } from './welcome-steps';

const fresh: WelcomeFacts = {
  aiReady: false,
  jobCount: 0,
  profileReady: false,
  scoredCount: 0,
  sourcesWaiting: 0,
  setupCompletedAt: null,
};

test('the wizard walks the steps in order, each derived from data', () => {
  assert.equal(currentStep(fresh), 'ai');
  assert.equal(currentStep({ ...fresh, aiReady: true }), 'search');
  assert.equal(currentStep({ ...fresh, aiReady: true, jobCount: 312 }), 'profile');
  assert.equal(currentStep({ ...fresh, aiReady: true, jobCount: 312, profileReady: true }), 'matches');
  assert.equal(
    currentStep({ ...fresh, aiReady: true, jobCount: 312, profileReady: true, sourcesWaiting: 3 }),
    'sources',
    'the boards for the search\'s countries come before the first matches',
  );
  assert.equal(
    currentStep({ ...fresh, aiReady: true, jobCount: 312, profileReady: true, sourcesWaiting: 3, scoredCount: 18 }),
    null,
    'a user who skipped the sources step and scored matches is not nagged',
  );
  assert.equal(
    currentStep({ ...fresh, aiReady: true, jobCount: 312, profileReady: true, scoredCount: 18 }),
    null,
    'a returning user has nothing left to do',
  );
});

test('a later step can be done before an earlier one — completion is per step', () => {
  const f = { ...fresh, profileReady: true, scoredCount: 3 };
  assert.equal(stepDone('profile', f), true);
  assert.equal(stepDone('matches', f), true);
  assert.equal(currentStep(f), 'ai', 'the first undone step still leads');
});

test('needsWelcome follows the flag alone, not the steps', () => {
  assert.equal(needsWelcome(fresh), true);
  assert.equal(needsWelcome({ setupCompletedAt: new Date() }), false);
  assert.equal(isWelcomeStep('profile'), true);
  assert.equal(isWelcomeStep('nope'), false);
});

test('summarizeScoreRun reads the reclassify stats in plain words', () => {
  const ok = summarizeScoreRun({ reclassified: 100, unchanged: 18, promoted: 0, filterDismissed: 212, remaining: 40 });
  assert.equal(ok.kind, 'ok');
  assert.equal(
    ok.text,
    'Scored 100 jobs — 18 look like a match; 212 set aside as off-topic without AI; 40 more waiting for the next pass.',
  );
  assert.equal(summarizeScoreRun({ aborted: 1, reason: 'blank-profile' }).kind, 'warn');
  assert.equal(summarizeScoreRun({ reclassified: 0, failed: 3 }).kind, 'warn');
});
