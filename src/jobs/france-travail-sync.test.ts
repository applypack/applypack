import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JobStatus } from '@prisma/client';
import { anonymisedOffer, dueBefore, planSync } from './france-travail-sync';

describe('planSync', () => {
  const stored = [
    { id: 1, externalId: 'A', status: JobStatus.NEW, pipelineStage: null },
    { id: 2, externalId: 'B', status: JobStatus.ALERTED, pipelineStage: null },
    { id: 3, externalId: 'C', status: JobStatus.APPLIED, pipelineStage: null },
    { id: 4, externalId: 'D', status: JobStatus.DISMISSED, pipelineStage: 'applied' },
    { id: 5, externalId: 'E', status: JobStatus.SAVED, pipelineStage: null },
    { id: 6, externalId: 'F', status: JobStatus.DISMISSED, pipelineStage: null },
  ];

  it('deletes a withdrawn offer unless it is the user\'s own record, which it anonymises', () => {
    const plan = planSync(stored, new Set(['A', 'B', 'C', 'D', 'E', 'F']));
    assert.deepEqual(plan.map((p) => [p.id, p.action]), [
      [1, 'delete'],
      [2, 'delete'],
      [3, 'anonymise'],
      [4, 'anonymise'],
      [5, 'anonymise'],
      [6, 'delete'],
    ]);
  });

  it('keeps everything the board still lists', () => {
    assert.deepEqual(planSync(stored, new Set(['B'])).map((p) => p.action), ['keep', 'delete', 'keep', 'keep', 'keep', 'keep']);
  });
});

describe('anonymisedOffer', () => {
  it('leaves nothing art. 7 names: no employer, contact, description, offer URL or commune', () => {
    const data = anonymisedOffer(new Date('2026-09-05T03:00:00Z'));
    assert.match(String(data.description), /^This offer was withdrawn from France Travail on 2026-09-05\./);
    assert.equal(data.location, 'France');
    assert.equal(data.url, 'https://www.francetravail.fr/');
    assert.equal(data.sourceUpdatedAt, null);
    assert.equal(data.salaryMin, null);
    assert.deepEqual(data.regions, []);
    assert.equal(data.sourceCheckedAt instanceof Date, true);
  });

  it('is due after a day', () => {
    assert.equal(dueBefore(new Date('2026-09-05T03:00:00Z')).toISOString(), '2026-09-04T03:00:00.000Z');
  });
});
