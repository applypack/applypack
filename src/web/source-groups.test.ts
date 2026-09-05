import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AtsType } from '@prisma/client';
import { describeCount, groupSources, sourceFamily } from './source-groups';

const ALL = Object.values(AtsType).filter((t) => t !== AtsType.MANUAL);

test('every source kind lands in exactly one of the three groups', () => {
  const groups = groupSources(ALL, {}, []);
  const placed = groups.flatMap((g) => g.pills.map((p) => p.atsType));
  assert.deepEqual([...placed].sort(), [...ALL].sort());
  assert.deepEqual(groups.map((g) => g.family), ['vendor', 'aggregator', 'own']);
  assert.equal(groups.find((g) => g.family === 'vendor')?.pills.length, 12);
  assert.equal(groups.find((g) => g.family === 'own')?.pills.length, 2);
});

test('pills sort by label, not by enum value, and case does not split the order', () => {
  const labels = groupSources(ALL, {}, []).find((g) => g.family === 'aggregator')?.pills.map((p) => p.label) ?? [];
  assert.equal(labels[0], '4 Day Week');
  const solid = labels.indexOf('solid.jobs');
  const remotive = labels.indexOf('Remotive');
  const weWork = labels.indexOf('We Work Remotely');
  assert.ok(remotive < solid && solid < weWork, labels.join(' | '));
});

test('a pill carries the install fact: how many companies, how many active, whether a key gates it', () => {
  const groups = groupSources(ALL, { GREENHOUSE: { companies: 12, active: 3 } }, ['ADZUNA']);
  const greenhouse = groups[0]?.pills.find((p) => p.atsType === 'GREENHOUSE');
  assert.deepEqual([greenhouse?.companies, greenhouse?.active, greenhouse?.locked], [12, 3, false]);
  const adzuna = groups.find((g) => g.family === 'aggregator')?.pills.find((p) => p.atsType === 'ADZUNA');
  assert.equal(adzuna?.locked, true);
  assert.equal(sourceFamily('DOU'), 'aggregator');
});

test('describeCount says it in words, with the noun the family counts', () => {
  assert.equal(describeCount({ companies: 0, active: 0 }, 'vendor'), 'no companies yet');
  assert.equal(describeCount({ companies: 1, active: 1 }, 'vendor'), '1 company · 1 active');
  assert.equal(describeCount({ companies: 12, active: 3 }, 'vendor'), '12 companies · 3 active');
  assert.equal(describeCount({ companies: 2, active: 2 }, 'aggregator'), '2 feeds · 2 active');
  assert.equal(describeCount({ companies: 1, active: 0 }, 'own'), '1 entry · 0 active');
});
