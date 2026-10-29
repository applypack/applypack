import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ScheduleSchema } from '../user-schedule';
import { packSettingsFromForm } from '../pack/settings';
import { firstIssue, refusedField } from './flash';
import { muteFieldLabel, packFieldLabel, scheduleFieldLabel, scheduleInput, watchFieldLabel } from './form-fields';
import { withLocale } from '../i18n/locale';

const SCHEDULE = {
  timezone: 'Europe/Kyiv',
  fetch: { every: 'hour', from: 0, to: 23, days: [1, 2, 3, 4, 5, 6, 7] },
  alerts: { mode: 'instant', from: 8, to: 22, days: [1, 2, 3, 4, 5], digestAt: [9] },
};

const refused = (value: unknown) => {
  const parsed = ScheduleSchema.safeParse(value);
  assert.equal(parsed.success, false);
  return parsed.success ? [] : parsed.error.issues;
};

test('a refused schedule names the field as its form labels it, and marks the input that carries it (#648)', () => {
  const zone = refused({ ...SCHEDULE, timezone: 'Mars/Olympus' });
  assert.equal(firstIssue(zone, scheduleFieldLabel), 'Time zone: unknown time zone');
  assert.deepEqual(refusedField('/settings/schedule', zone, scheduleInput).field?.name, 'timezone');
  const days = refused({ ...SCHEDULE, fetch: { ...SCHEDULE.fetch, days: [9] } });
  assert.equal(firstIssue(days, scheduleFieldLabel), 'Days: Must be 7 or less');
  assert.equal(refusedField('/settings/schedule', days, scheduleInput).field?.name, 'fetchDays');
  const every = refused({ ...SCHEDULE, fetch: { ...SCHEDULE.fetch, every: 'minute' } });
  assert.match(firstIssue(every, scheduleFieldLabel), /^How often: /);
  assert.equal(refusedField('/settings/schedule', every, scheduleInput).field?.name, 'fetchEvery');
  const digest = refused({ ...SCHEDULE, alerts: { ...SCHEDULE.alerts, digestAt: [30] } });
  assert.equal(refusedField('/settings/schedule', digest, scheduleInput).field?.name, 'digestAt');
  // In the reader's language, like every label.
  withLocale('uk', () => assert.doesNotMatch(firstIssue(zone, scheduleFieldLabel), /^timezone/));
});

test('the pack form, the mute and the watchlist row name their fields as their pages do (#648)', () => {
  const pack = packSettingsFromForm({ minFit: '10', dailyLimit: '5', maxAgeDays: '7', coverLetter: 'never', maxBullets: '2' });
  assert.equal(pack.ok, false);
  if (!pack.ok) assert.equal(firstIssue(pack.issues, packFieldLabel), 'Fit at least: Must be 50 or more');
  assert.equal(firstIssue([{ path: ['name'], message: 'At least 1 character' }], muteFieldLabel), 'Company: At least 1 character');
  assert.equal(firstIssue([{ path: ['checkEvery'], message: 'Pick one' }], watchFieldLabel), 'How often this company is checked: Pick one');
});
