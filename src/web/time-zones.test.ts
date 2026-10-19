import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalZone, readZone, RENAMED_ZONES, timeZoneChoices } from './time-zones';

const sameZone = (a: string, b: string): boolean =>
  new Intl.DateTimeFormat('en-US', { timeZone: a }).resolvedOptions().timeZone === new Intl.DateTimeFormat('en-US', { timeZone: b }).resolvedOptions().timeZone;

// #572: 400 options under names nobody uses any more — Europe/Kiev, Asia/Calcutta.
test('the picker offers the current names, UTC among them, each once', () => {
  const zones = timeZoneChoices();
  for (const name of ['Europe/Kyiv', 'Asia/Kolkata', 'Asia/Ho_Chi_Minh', 'America/Argentina/Buenos_Aires', 'UTC']) assert.ok(zones.includes(name), name);
  for (const old of Object.keys(RENAMED_ZONES)) assert.ok(!zones.includes(old), old);
  assert.equal(new Set(zones).size, zones.length);
  assert.deepEqual(zones, [...zones].sort());
});

test('every renamed zone is the same zone under both names', () => {
  for (const [old, name] of Object.entries(RENAMED_ZONES)) assert.ok(sameZone(old, name), `${old} → ${name}`);
});

test('a stored zone under an old name keeps working and reads under its new one', () => {
  assert.equal(canonicalZone('Europe/Kiev'), 'Europe/Kyiv');
  assert.equal(canonicalZone('Europe/Kyiv'), 'Europe/Kyiv');
  assert.equal(canonicalZone('Asia/Calcutta'), 'Asia/Kolkata');
  assert.equal(canonicalZone('America/Chicago'), 'America/Chicago');
  assert.equal(canonicalZone('Nowhere/Atlantis'), null);
});

test('a typed zone is read in any spelling, or by a city that names one zone', () => {
  assert.equal(readZone('Europe/Kyiv'), 'Europe/Kyiv');
  assert.equal(readZone(' europe/kiev '), 'Europe/Kyiv');
  assert.equal(readZone('Asia/Calcutta'), 'Asia/Kolkata');
  assert.equal(readZone('kyiv'), 'Europe/Kyiv');
  assert.equal(readZone('New York'), 'America/New_York');
  assert.equal(readZone('Indianapolis'), 'America/Indiana/Indianapolis');
  // Not a zone: left as typed, for the schedule's check to refuse in words.
  assert.equal(readZone('Atlantis'), 'Atlantis');
  assert.equal(readZone(''), '');
});
