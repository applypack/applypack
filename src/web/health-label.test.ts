import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeStatus } from '../fetchers/source-health';
import { withLocale } from '../i18n/locale';
import { healthLabel } from './health-label';

const STATUSES = ['ok', 'empty', 'not_modified', 'slug_gone', 'auth', 'rate_limit', 'server', 'network', 'bad_payload', 'unknown', null, 'never-heard-of'];

test('healthLabel says in English what describeStatus says, for a board and for a folder', () => {
  for (const atsType of ['GREENHOUSE', 'FOLDER'])
    for (const status of STATUSES) assert.equal(healthLabel(status, atsType), describeStatus(status, atsType).label, `${atsType} ${status}`);
});

test('healthLabel speaks the reader’s language', () => {
  assert.equal(withLocale('uk', () => healthLabel('slug_gone', 'FOLDER')), 'Теку не знайдено');
  assert.equal(withLocale('uk', () => healthLabel('slug_gone')), withLocale('uk', () => healthLabel('slug_gone', 'GREENHOUSE')));
});
