import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FETCH_STATUSES, describeStatus } from '../fetchers/source-health';
import { withLocale } from '../i18n/locale';
import { healthLabel, healthStreak } from './health-label';

// Every status there is, so one added later is held to the same two rules without an edit here.
const STATUSES = [...FETCH_STATUSES, null, 'never-heard-of'];

test('healthLabel says in English what describeStatus says, for a board and for a folder', () => {
  for (const atsType of ['GREENHOUSE', 'FOLDER'])
    for (const status of STATUSES) assert.equal(healthLabel(status, atsType), describeStatus(status, atsType).label, `${atsType} ${status}`);
});

test('healthLabel speaks the reader’s language', () => {
  assert.equal(withLocale('uk', () => healthLabel('slug_gone', 'FOLDER')), 'Теку не знайдено');
  assert.equal(withLocale('uk', () => healthLabel('slug_gone')), withLocale('uk', () => healthLabel('slug_gone', 'GREENHOUSE')));
});

test('healthStreak is the label, lowercased in English, and the streak — for every status', () => {
  for (const atsType of ['GREENHOUSE', 'FOLDER'])
    for (const status of STATUSES)
      assert.equal(
        healthStreak(status, atsType, 3),
        `${healthLabel(status, atsType).toLowerCase()} — 3 ticks in a row`,
        `${atsType} ${status}`,
      );
  assert.equal(healthStreak('slug_gone', 'GREENHOUSE', 1), 'slug not found — 1 tick in a row');
});
