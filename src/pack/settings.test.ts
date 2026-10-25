import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstIssue, refusedField } from '../web/flash';
import { DEFAULT_POLICY } from './policy';
import { asksForCoverLetter, packSettingsFromForm, packsOnSince, parsePackSettings, switchedOn, wantsCoverLetter, type PackSettings } from './settings';

const DEFAULTS = {
  enabled: false,
  enabledAt: null,
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
    enabledAt: '2026-10-01T08:00:00.000Z',
    minFit: 95,
    dailyLimit: 0,
    maxAgeDays: 3,
    coverLetter: 'asked',
    policy: { sections: ['skills'], maxBullets: 0, removals: true, keywords: false },
  };
  assert.deepEqual(parsePackSettings(stored), stored);
  assert.deepEqual(parsePackSettings({ ...stored, minFit: 400, dailyLimit: -1 }), { ...stored, minFit: 90, dailyLimit: 5 });
  assert.deepEqual(parsePackSettings({ enabled: true }).policy, DEFAULT_POLICY);
  // A value stored before the moment was kept, and one nobody could have written, read as "not recorded".
  assert.equal(parsePackSettings({ enabled: true }).enabledAt, null);
  assert.equal(parsePackSettings({ enabled: true, enabledAt: 'yesterday' }).enabledAt, null);
});

test('a save keeps the moment packs were switched on while they stay on (#380)', () => {
  const at = (iso: string): Date => new Date(iso);
  const off = parsePackSettings(null);
  const typed = (enabled: boolean): PackSettings => ({ ...off, enabled, minFit: 95 });
  // Switched on: stamped. Saved again while on — another threshold, say — the moment stays.
  const first = switchedOn(typed(true), off, at('2026-10-01T08:00:00Z'));
  assert.equal(first.enabledAt, '2026-10-01T08:00:00.000Z');
  assert.equal(switchedOn(typed(true), first, at('2026-10-05T09:00:00Z')).enabledAt, '2026-10-01T08:00:00.000Z');
  // Switched off, the moment goes; on again is a new one — what was stored in between is the backlog.
  const stopped = switchedOn(typed(false), first, at('2026-10-06T09:00:00Z'));
  assert.equal(stopped.enabledAt, null);
  assert.equal(switchedOn(typed(true), stopped, at('2026-10-08T09:00:00Z')).enabledAt, '2026-10-08T09:00:00.000Z');
  // On with no moment recorded (stored by an older version): the save records this one.
  assert.equal(switchedOn(typed(true), parsePackSettings({ enabled: true }), at('2026-10-09T09:00:00Z')).enabledAt, '2026-10-09T09:00:00.000Z');
  // Everything else the form carried is stored as typed.
  assert.equal(first.minFit, 95);

  assert.deepEqual(packsOnSince(first), at('2026-10-01T08:00:00Z'));
  assert.equal(packsOnSince(stopped), null);
  assert.equal(packsOnSince(parsePackSettings({ enabled: true })), null);
});

/** What a browser always sends: the number fields and the select. A box is sent only while ticked. */
const FIELDS = { minFit: '92', dailyLimit: '0', maxAgeDays: '14', coverLetter: 'always', maxBullets: '1' };
const FORM = { ...FIELDS, enabled: '1', sections: ['title', 'skills'], keywords: '1' };

const saved = (form: Record<string, unknown>): PackSettings => {
  const read = packSettingsFromForm(form);
  assert.ok(read.ok, 'the form should have been taken');
  return read.settings;
};
/** The field a form was refused for, and zod's code for why. */
const refused = (form: Record<string, unknown>): string => {
  const read = packSettingsFromForm(form);
  assert.ok(!read.ok, 'the form should have been refused');
  const issue = read.issues[0]!;
  return `${String(issue.path[0])}: ${issue.code}`;
};

test('the form: an unticked box is off, no section ticked is no section', () => {
  assert.deepEqual(saved(FORM), {
    enabled: true,
    enabledAt: null,
    minFit: 92,
    dailyLimit: 0,
    maxAgeDays: 14,
    coverLetter: 'always',
    policy: { sections: ['title', 'skills'], maxBullets: 1, removals: false, keywords: true },
  });
  const bare = saved(FIELDS);
  assert.equal(bare.enabled, false);
  assert.deepEqual(bare.policy, { sections: [], maxBullets: 1, removals: false, keywords: false });
  // One ticked box arrives as a string, not a list.
  assert.deepEqual(saved({ ...FIELDS, sections: 'experience' }).policy.sections, ['experience']);
  assert.deepEqual(saved({ ...FIELDS, sections: ['skills', 'skills'] }).policy.sections, ['skills']);
  // The ends of every range belong to it.
  assert.deepEqual(saved({ ...FIELDS, minFit: '50', dailyLimit: '50', maxAgeDays: '1', maxBullets: '6', coverLetter: 'never', removals: '1' }), {
    enabled: false,
    enabledAt: null,
    minFit: 50,
    dailyLimit: 50,
    maxAgeDays: 1,
    coverLetter: 'never',
    policy: { sections: [], maxBullets: 6, removals: true, keywords: false },
  });
  assert.equal(saved({ ...FIELDS, minFit: '100', maxAgeDays: '60', maxBullets: '0' }).minFit, 100);
  // A browser's number field may hold a number written another way.
  assert.equal(saved({ ...FIELDS, minFit: ' 95 ' }).minFit, 95);
  assert.equal(saved({ ...FIELDS, dailyLimit: '1e1' }).dailyLimit, 10);
});

test('the form: a value it does not offer is refused with its field named, never replaced (#383)', () => {
  // The table of #383: each of these was stored as the default and reported as saved.
  assert.equal(refused({ ...FORM, minFit: '40' }), 'minFit: too_small');
  assert.equal(refused({ ...FORM, dailyLimit: '60' }), 'dailyLimit: too_big');
  assert.equal(refused({ ...FORM, maxAgeDays: '0' }), 'maxAgeDays: too_small');
  assert.equal(refused({ ...FORM, maxBullets: '10' }), 'maxBullets: too_big');
  assert.equal(refused({ ...FORM, minFit: '91.5' }), 'minFit: invalid_type');
  assert.equal(refused({ ...FORM, dailyLimit: '-1' }), 'dailyLimit: too_small');
  assert.equal(refused({ ...FORM, coverLetter: 'bogus' }), 'coverLetter: invalid_value');
  // Text, an emptied field and a field that never arrived are not numbers either.
  assert.equal(refused({ ...FORM, minFit: 'high' }), 'minFit: invalid_type');
  assert.equal(refused({ ...FORM, minFit: '' }), 'minFit: invalid_type');
  assert.equal(refused({ ...FORM, maxAgeDays: undefined }), 'maxAgeDays: invalid_type');
  assert.equal(refused({ ...FORM, coverLetter: undefined }), 'coverLetter: invalid_value');
  assert.equal(refused({}), 'minFit: invalid_type');
  assert.equal(refused({ ...FORM, dailyLimit: 'Infinity' }), 'dailyLimit: invalid_type');
  // A section the form never offered, and a box sent with a value that is not its own.
  assert.equal(refused({ ...FORM, sections: ['summary', 'education'] }), 'sections: invalid_value');
  assert.equal(refused({ ...FORM, enabled: 'true' }), 'enabled: invalid_value');
  assert.equal(refused({ ...FORM, removals: 'on' }), 'removals: invalid_value');
  // Several at once: the one named is the first a person meets on the page.
  assert.equal(refused({ ...FORM, maxBullets: '10', minFit: '40', dailyLimit: '60' }), 'minFit: too_small');
});

test('the form: a refusal says what the field takes, and names the input to mark', () => {
  const said = (form: Record<string, unknown>): string => {
    const read = packSettingsFromForm(form);
    return read.ok ? 'taken' : firstIssue(read.issues);
  };
  assert.equal(said({ ...FORM, minFit: '40' }), 'minFit: Must be 50 or more');
  assert.equal(said({ ...FORM, dailyLimit: '60' }), 'dailyLimit: Must be 50 or less');
  assert.equal(said({ ...FORM, minFit: '91.5' }), 'minFit: Expected a whole number');
  assert.equal(said({ ...FORM, minFit: 'high' }), 'minFit: Expected a number');
  assert.equal(said({ ...FORM, minFit: '' }), 'minFit: Required');
  assert.equal(said({ ...FORM, coverLetter: 'bogus' }), 'coverLetter: Invalid enum value — pick one of the options offered');
  assert.equal(said({ ...FORM, enabled: 'true' }), 'enabled: Invalid value');
  const read = packSettingsFromForm({ ...FORM, sections: ['summary', 'education'] });
  assert.deepEqual(read.ok ? {} : refusedField('/settings/pack', read.issues), { field: { form: '/settings/pack', name: 'sections' } });
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
