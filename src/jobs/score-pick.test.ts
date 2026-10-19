import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickBatch, rankByProfileFit, SCORE_BATCH, type LinkedJob, type ScorableJob } from './score-pick';

const profile = {
  stackRequired: ['php', 'laravel'],
  roleTypes: ['backend'],
  stackNiceToHave: ['docker'],
};

const job = (id: number, title: string, description: string, day: number): ScorableJob => ({
  id,
  title,
  description,
  fetchedAt: new Date(2026, 0, day),
});

test('a title hit outranks a description hit, required outranks role words', () => {
  const ranked = rankByProfileFit(
    [
      job(1, 'Backend Engineer', 'we use go and kubernetes', 1),
      job(2, 'Senior PHP Engineer', 'laravel, mysql, docker', 1),
      job(3, 'Software Engineer', 'php somewhere in the text', 1),
    ],
    profile,
  );
  assert.deepEqual(
    ranked.map((r) => r.id),
    [2, 1, 3],
  );
  assert.ok(ranked[0]!.hits > ranked[1]!.hits);
});

test('ties keep the newer posting, and a term must stand as a word', () => {
  const ranked = rankByProfileFit(
    [job(1, 'PHP Developer', '', 1), job(2, 'PHP Developer', '', 5)],
    profile,
  );
  assert.deepEqual(ranked.map((r) => r.id), [2, 1]);

  const [only] = rankByProfileFit([job(9, 'Graphphp Wrangler', 'phpstorm user', 1)], profile);
  assert.equal(only!.hits, 0, 'substrings inside other words are not hits');
});

test('a job mentioning nothing still ranks, last, and the batch is small', () => {
  const ranked = rankByProfileFit([job(1, 'Chef', 'cooking', 1)], profile);
  assert.deepEqual(ranked, [{ id: 1, hits: 0 }]);
  assert.ok(SCORE_BATCH <= 25, 'a CLI engine needs 15-30s per job');
});

const linked = (id: number, crossListedOfJobId: number | null = null): LinkedJob => ({ id, crossListedOfJobId });

test('one posting four feeds carry is one row of a batch (#529)', () => {
  // The live check: 22 and its copies 258, 270 and 411 (a copy of 258) ranked first.
  const ranked = [linked(22), linked(258, 22), linked(270, 22), linked(411, 258), ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((id) => linked(id))];
  assert.deepEqual(pickBatch(ranked, ranked, new Set(), SCORE_BATCH), [22, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('a copy of a scored row waits behind every other posting, then is scored on its own', () => {
  const ranked = [linked(258, 22), linked(1)];
  const links = [...ranked, linked(22)];
  assert.deepEqual(pickBatch(ranked, links, new Set([22]), 1), [1]);
  assert.deepEqual(pickBatch(ranked, links, new Set([22]), SCORE_BATCH), [1, 258]);
  // The other way round: the copy was scored, the row it copies waits.
  assert.deepEqual(pickBatch([linked(22), linked(1)], [linked(22), linked(1), linked(258, 22)], new Set([258]), 1), [1]);
  // Nothing else waits: the copies are the batch.
  assert.deepEqual(pickBatch([linked(22), linked(258, 22)], [linked(22), linked(258, 22)], new Set(), SCORE_BATCH), [22, 258]);
});
