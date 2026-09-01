import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appliedDateCorrection, dateOnly, stageChangeEvent } from './stage-events';

const NOW = new Date('2026-08-31T22:15:30.000Z');
const APPLIED = new Date('2026-04-30T09:00:00.000Z');

test('dateOnly keeps the UTC day and drops the time', () => {
  assert.equal(dateOnly(NOW).toISOString(), '2026-08-31T00:00:00.000Z');
});

test('unchanged stage writes nothing', () => {
  assert.equal(stageChangeEvent(1, null, null, null, NOW), null);
  assert.equal(stageChangeEvent(1, 'applied', 'applied', APPLIED, NOW), null);
});

test('a move into applied is dated by the backdatable appliedAt', () => {
  const e = stageChangeEvent(1, null, 'applied', APPLIED, NOW);
  assert.deepEqual(e, {
    jobId: 1,
    fromStage: null,
    toStage: 'applied',
    occurredOn: new Date('2026-04-30T00:00:00.000Z'),
    source: 'ui',
  });
});

test('a move into applied without a date falls back to today', () => {
  const e = stageChangeEvent(1, null, 'applied', null, NOW);
  assert.equal(e?.occurredOn.toISOString(), '2026-08-31T00:00:00.000Z');
});

test('other hops are dated today, not by appliedAt', () => {
  const e = stageChangeEvent(2, 'applied', 'tech', APPLIED, NOW);
  assert.equal(e?.toStage, 'tech');
  assert.equal(e?.source, 'ui');
  assert.equal(e?.occurredOn.toISOString(), '2026-08-31T00:00:00.000Z');
});

test('clearing the stage is a correction with toStage null', () => {
  const e = stageChangeEvent(3, 'screen', null, null, NOW);
  assert.equal(e?.toStage, null);
  assert.equal(e?.source, 'correction');
});

test('appliedAt edits correct the apply day only when something changed', () => {
  assert.equal(appliedDateCorrection(1, null, null, APPLIED), null);
  assert.equal(appliedDateCorrection(1, 'applied', APPLIED, null), null);
  assert.equal(
    appliedDateCorrection(1, 'applied', APPLIED, new Date('2026-04-30T23:59:00Z')),
    null,
  );

  const e = appliedDateCorrection(1, 'tech', APPLIED, new Date('2026-05-02T08:00:00Z'));
  assert.deepEqual(e, {
    jobId: 1,
    fromStage: null,
    toStage: 'applied',
    occurredOn: new Date('2026-05-02T00:00:00.000Z'),
    source: 'correction',
  });

  const first = appliedDateCorrection(1, 'applied', null, APPLIED);
  assert.equal(first?.occurredOn.toISOString(), '2026-04-30T00:00:00.000Z');
});
