import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSchedule } from '../user-schedule';
import { placeExtrasSet, searchScheduleIsDefault, splitEngines } from './settings-fold';

test('the schedule a new install runs is the default; any change of cadence, hours or days is not', () => {
  const s = defaultSchedule('Europe/Kyiv');
  assert.equal(searchScheduleIsDefault(s), true);
  assert.equal(searchScheduleIsDefault({ ...s, fetch: { ...s.fetch, every: '4h' } }), false);
  assert.equal(searchScheduleIsDefault({ ...s, fetch: { ...s.fetch, from: 8 } }), false);
  assert.equal(searchScheduleIsDefault({ ...s, fetch: { ...s.fetch, days: [1, 2, 3, 4, 5] } }), false);
});

const engine = (id: string, over: Partial<{ ok: boolean; enabled: boolean; lastResort: boolean }> = {}) => ({ id, ok: false, enabled: false, lastResort: false, ...over });

test('chosen, last-resort and runnable engines stay in sight; the rest fold, in their order', () => {
  const all = [engine('a', { ok: true, enabled: true }), engine('b'), engine('c', { ok: true }), engine('d', { lastResort: true }), engine('e', { enabled: true }), engine('f')];
  const { shown, folded, open } = splitEngines(all);
  assert.deepEqual(shown.map((e) => e.id), ['a', 'c', 'd', 'e']);
  assert.deepEqual(folded.map((e) => e.id), ['b', 'f']);
  assert.equal(open, false);
});

test('with no engine that can run in sight, the folded ones stand open', () => {
  assert.equal(splitEngines([engine('a', { enabled: true }), engine('b')]).open, true);
  assert.equal(splitEngines([engine('a'), engine('b')]).open, true);
});

test('the folded place fields count what they hold; staying put is not a choice to count', () => {
  assert.equal(placeExtrasSet({ regions: [], residence: null, relocation: 'no' }), 0);
  assert.equal(placeExtrasSet({ regions: [], residence: null, relocation: null }), 0);
  assert.equal(placeExtrasSet({ regions: ['EU', 'DACH'], residence: 'UA', relocation: 'yes' }), 4);
});
