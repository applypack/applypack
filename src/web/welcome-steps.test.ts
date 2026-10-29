import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentStep, isWelcomeStep, needsWelcome, setupZone, stepDone, summarizeScoreRun, type WelcomeFacts } from './welcome-steps';

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

test('the boards step is not done before there is a search to fit them to (#643)', () => {
  assert.equal(stepDone('sources', fresh), false, 'a fresh install has nothing waiting because nothing was asked');
  assert.equal(stepDone('sources', { ...fresh, aiReady: true, jobCount: 312 }), false);
  assert.equal(stepDone('sources', { ...fresh, profileReady: true }), true, 'a search with nothing to add is done');
  assert.equal(stepDone('sources', { ...fresh, profileReady: true, sourcesWaiting: 2 }), false);
  assert.equal(stepDone('sources', { ...fresh, sourcesWaiting: 2, scoredCount: 4 }), true, 'scoring passed it');
});

test('a later step can be done before an earlier one — completion is per step', () => {
  const f = { ...fresh, profileReady: true, scoredCount: 3 };
  assert.equal(stepDone('profile', f), true);
  assert.equal(stepDone('matches', f), true);
  assert.equal(currentStep(f), 'ai', 'the first undone step still leads');
});

test('setup keeps the browser zone only when nobody chose one (#643)', () => {
  assert.equal(setupZone(null, 'UTC', 'America/Chicago'), 'America/Chicago', 'a fresh install read every date in UTC');
  assert.equal(setupZone(null, 'Etc/UTC', ' Europe/Kiev '), 'Europe/Kyiv', 'under its current name');
  assert.equal(setupZone({ timezone: 'Europe/Warsaw' }, 'UTC', 'America/Chicago'), null, 'a stored schedule is a choice');
  assert.equal(setupZone(null, 'Europe/Berlin', 'America/Chicago'), null, 'a TZ the install set is a choice');
  assert.equal(setupZone(null, 'UTC', 'UTC'), null, 'nothing to change');
  assert.equal(setupZone(null, 'UTC', ''), null, 'no script, no zone');
  assert.equal(setupZone(null, 'UTC', 'Mars/Olympus'), null);
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
  // N2: the pass says why the rest were set aside, the base filter's gate and the winning search's reason.
  assert.equal(
    summarizeScoreRun({
      reclassified: 10,
      unchanged: 2,
      dismissedLowFit: 6,
      dismissedLocation: 2,
      filterDismissed: 35,
      rejectedTitle: 30,
      rejectedPlace: 5,
    }).text,
    'Scored 10 jobs — 2 look like a match (not a match: 6 under the fit threshold, 2 with a location mismatch); 35 set aside as off-topic without AI — 30 without a title keyword, 5 outside your places.',
  );
  // #539: one gate that took them all is named once, not with the same number twice.
  assert.equal(
    summarizeScoreRun({ reclassified: 0, filterDismissed: 406, rejectedTitle: 406 }).text,
    'Scored 0 jobs — 0 look like a match; 406 set aside as off-topic without AI — all without a title keyword.',
  );
  assert.equal(summarizeScoreRun({ aborted: 1, reason: 'blank-profile' }).kind, 'warn');
  assert.equal(summarizeScoreRun({ reclassified: 0, failed: 3 }).kind, 'warn');
  assert.equal(
    summarizeScoreRun({ reclassified: 0, failed: 10, lastError: 'no API key — paste one on /settings, or set it in .env' }).text,
    'Scored 0 jobs — 0 look like a match; 10 could not be scored — the AI did not answer: no API key — paste one on /settings, or set it in .env.',
  );
});
