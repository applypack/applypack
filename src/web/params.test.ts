import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idParam, intQuery, switchParam } from './params';

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

test('switchParam reads 1 and 0 and refuses everything else', () => {
  assert.equal(switchParam('1'), true);
  assert.equal(switchParam('0'), false);
  for (const bad of [undefined, null, '', 'on', 'true', ' 1', '01', 1, 0, true, ['1'], new File([], 'x')]) {
    assert.equal(switchParam(bad), null, `${String(bad)} must be null`);
  }
});
