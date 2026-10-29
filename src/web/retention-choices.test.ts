import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retentionChoices, retentionParam } from './retention-choices';

const BOUNDS = { min: 7, max: 365 };

test('the retention select offers its lengths, and the stored one when it is none of them', () => {
  assert.deepEqual(retentionChoices(90, BOUNDS), [30, 60, 90, 180, 365]);
  assert.deepEqual(retentionChoices(45, BOUNDS), [30, 45, 60, 90, 180, 365]);
});

test('a retention the select does not offer changes nothing (#646)', () => {
  assert.equal(retentionParam('180', 90, BOUNDS), 180);
  assert.equal(retentionParam('45', 45, BOUNDS), 45, 'the stored length is offered, so saving the form keeps it');
  for (const sent of ['', '45', '7', '0', '1000', 'abc', undefined, ['90']]) {
    assert.equal(retentionParam(sent, 90, BOUNDS), null, JSON.stringify(sent));
  }
});
