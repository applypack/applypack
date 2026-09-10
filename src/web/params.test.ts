import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idParam, intQuery } from './params';

test('idParam takes a plain positive integer and nothing else', () => {
  assert.equal(idParam('12'), 12);
  assert.equal(idParam('0'), 0);
  for (const bad of ['1.5', '1e2', ' 12 ', '-1', '0x10', '', '1234567890', undefined, null, 12, new File([], 'x')]) {
    assert.ok(Number.isNaN(idParam(bad)), `${String(bad)} must be NaN`);
  }
});

test('intQuery reads a signed integer or says nothing', () => {
  assert.equal(intQuery('70'), 70);
  assert.equal(intQuery('-5'), -5);
  for (const bad of ['1.5', 'abc', '', undefined]) assert.equal(intQuery(bad), null);
});
