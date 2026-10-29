import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appliedDateCorrection, stageChangeEvent } from './stage-events';

const NOW = new Date('2026-08-31T22:15:30.000Z');
const APPLIED = new Date('2026-04-30T09:00:00.000Z');

test('unchanged stage writes nothing', () => {
  assert.equal(stageChangeEvent(1, null, null, null, NOW, 'UTC'), null);
  assert.equal(stageChangeEvent(1, 'applied', 'applied', APPLIED, NOW, 'UTC'), null);
});

test('a move into applied is dated by the backdatable appliedAt', () => {
  const e = stageChangeEvent(1, null, 'applied', APPLIED, NOW, 'UTC');
  assert.deepEqual(e, {
    jobId: 1,
    fromStage: null,
    toStage: 'applied',
    occurredOn: new Date('2026-04-30T00:00:00.000Z'),
    source: 'ui',
  });
});

test('a move into applied without a date falls back to today', () => {
  const e = stageChangeEvent(1, null, 'applied', null, NOW, 'UTC');
  assert.equal(e?.occurredOn.toISOString(), '2026-08-31T00:00:00.000Z');
});

test('other hops are dated today, not by appliedAt', () => {
  const e = stageChangeEvent(2, 'applied', 'tech', APPLIED, NOW, 'UTC');
  assert.equal(e?.toStage, 'tech');
  assert.equal(e?.source, 'ui');
  assert.equal(e?.occurredOn.toISOString(), '2026-08-31T00:00:00.000Z');
});

test('clearing the stage is a correction with toStage null', () => {
  const e = stageChangeEvent(3, 'screen', null, null, NOW, 'UTC');
  assert.equal(e?.toStage, null);
  assert.equal(e?.source, 'correction');
});

test('appliedAt edits correct the apply day only when something changed', () => {
  assert.equal(appliedDateCorrection(1, null, null, APPLIED, 'UTC'), null);
  assert.equal(appliedDateCorrection(1, 'applied', APPLIED, null, 'UTC'), null);
  assert.equal(
    appliedDateCorrection(1, 'applied', APPLIED, new Date('2026-04-30T23:59:00Z'), 'UTC'),
    null,
  );

  const e = appliedDateCorrection(1, 'tech', APPLIED, new Date('2026-05-02T08:00:00Z'), 'UTC');
  assert.deepEqual(e, {
    jobId: 1,
    fromStage: null,
    toStage: 'applied',
    occurredOn: new Date('2026-05-02T00:00:00.000Z'),
    source: 'correction',
  });

  const first = appliedDateCorrection(1, 'applied', null, APPLIED, 'UTC');
  assert.equal(first?.occurredOn.toISOString(), '2026-04-30T00:00:00.000Z');
});

test("the ledger's day is the display zone's, not UTC's (#680)", () => {
  // 22:15 UTC on 08-31 is 08-31 evening in Chicago and 09-01 after midnight in Kyiv.
  assert.equal(stageChangeEvent(2, 'applied', 'tech', APPLIED, NOW, 'America/Chicago')?.occurredOn.toISOString(), '2026-08-31T00:00:00.000Z');
  assert.equal(stageChangeEvent(2, 'applied', 'tech', APPLIED, NOW, 'Europe/Kyiv')?.occurredOn.toISOString(), '2026-09-01T00:00:00.000Z');
  // Two moments of one Kyiv day are one apply day, though their UTC days differ.
  assert.equal(appliedDateCorrection(1, 'applied', new Date('2026-04-29T22:30:00Z'), new Date('2026-04-30T12:00:00Z'), 'Europe/Kyiv'), null);
});
