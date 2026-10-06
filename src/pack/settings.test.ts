import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POLICY } from './policy';
import { asksForCoverLetter, packSettingsFromForm, parsePackSettings, wantsCoverLetter } from './settings';

const DEFAULTS = {
  enabled: false,
  minFit: 90,
  dailyLimit: 5,
  maxAgeDays: 7,
  coverLetter: 'never',
  policy: DEFAULT_POLICY,
};

test('nothing stored, or nothing readable, is the feature switched off with its defaults', () => {
  assert.deepEqual(parsePackSettings(null), DEFAULTS);
  assert.deepEqual(parsePackSettings(undefined), DEFAULTS);
  assert.deepEqual(parsePackSettings('on'), DEFAULTS);
  assert.deepEqual(parsePackSettings({ enabled: 'yes', minFit: 'high', coverLetter: 'sometimes', policy: 7 }), DEFAULTS);
});

test('a stored value reads back as stored, and one bad field does not cost the rest', () => {
  const stored = {
    enabled: true,
    minFit: 95,
    dailyLimit: 0,
    maxAgeDays: 3,
    coverLetter: 'asked',
    policy: { sections: ['skills'], maxBullets: 0, removals: true, keywords: false },
  };
  assert.deepEqual(parsePackSettings(stored), stored);
  assert.deepEqual(parsePackSettings({ ...stored, minFit: 400, dailyLimit: -1 }), { ...stored, minFit: 90, dailyLimit: 5 });
  assert.deepEqual(parsePackSettings({ enabled: true }).policy, DEFAULT_POLICY);
});

test('the form: an unticked box is off, no section ticked is no section', () => {
  const form = { enabled: '1', minFit: '92', dailyLimit: '0', maxAgeDays: '14', coverLetter: 'always', sections: ['title', 'skills'], maxBullets: '1', keywords: '1' };
  assert.deepEqual(packSettingsFromForm(form), {
    enabled: true,
    minFit: 92,
    dailyLimit: 0,
    maxAgeDays: 14,
    coverLetter: 'always',
    policy: { sections: ['title', 'skills'], maxBullets: 1, removals: false, keywords: true },
  });
  const bare = packSettingsFromForm({});
  assert.equal(bare.enabled, false);
  assert.deepEqual(bare.policy, { sections: [], maxBullets: 2, removals: false, keywords: false });
  // One ticked box arrives as a string, not a list; a section the form never offered is dropped.
  assert.deepEqual(packSettingsFromForm({ sections: 'experience' }).policy.sections, ['experience']);
  assert.deepEqual(packSettingsFromForm({ sections: ['education', 'summary'] }).policy.sections, ['summary']);
  assert.equal(packSettingsFromForm({ minFit: '', dailyLimit: 'many' }).minFit, 90);
  assert.equal(packSettingsFromForm({ dailyLimit: 'many' }).dailyLimit, 5);
});

test('a letter is asked for only in the posting’s own words', () => {
  assert.equal(asksForCoverLetter('Please include a cover letter with your application.'), true);
  assert.equal(asksForCoverLetter('Send your CV and a motivational letter.'), true);
  assert.equal(asksForCoverLetter('Cover-letter optional'), true);
  assert.equal(asksForCoverLetter('We cover relocation. Let her know.'), false);
  assert.equal(wantsCoverLetter('never', 'A cover letter is required.'), false);
  assert.equal(wantsCoverLetter('asked', 'A cover letter is required.'), true);
  assert.equal(wantsCoverLetter('asked', 'Apply with your resume.'), false);
  assert.equal(wantsCoverLetter('always', 'Apply with your resume.'), true);
});
