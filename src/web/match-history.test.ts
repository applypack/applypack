import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { groupMatchesByJob, historyLabel, progression } from './match-history';

const job = (id: number, title: string) => ({ id, title });
const run = (id: number, j: { id: number; title: string }, score: number, day: number, version = 1) => ({
  id,
  job: j,
  matchScore: score,
  resumeVersion: version,
  draft: false,
  createdAt: new Date(`2026-09-0${day}T10:00:00Z`),
});

const backend = job(1, 'Backend engineer');
const platform = job(2, 'Platform engineer');

describe('groupMatchesByJob', () => {
  it('three runs against one posting are one story, not three rows', () => {
    const grouped = groupMatchesByJob([
      run(3, backend, 71, 5, 3),
      run(2, backend, 68, 3, 2),
      run(1, backend, 66, 1, 1),
    ]);
    assert.equal(grouped.length, 1);
    assert.deepEqual(grouped[0]?.runs.map((r) => r.matchScore), [71, 68, 66]);
    assert.equal(grouped[0]?.delta, 3);
    assert.equal(grouped[0]?.previous?.matchScore, 68);
  });

  it('orders groups by their newest run, so the page opens on what just happened', () => {
    const grouped = groupMatchesByJob([
      run(1, backend, 66, 1),
      run(2, platform, 80, 4),
      run(3, backend, 71, 2),
    ]);
    assert.deepEqual(grouped.map((g) => g.job.id), [2, 1]);
  });

  it('sorts inside a group by time, not by the order it was handed', () => {
    const grouped = groupMatchesByJob([run(1, backend, 66, 1), run(2, backend, 71, 5)]);
    assert.equal(grouped[0]?.latest.matchScore, 71);
    assert.equal(grouped[0]?.delta, 5);
  });

  it('a posting checked once has no delta to show', () => {
    const grouped = groupMatchesByJob([run(1, backend, 66, 1)]);
    assert.equal(grouped[0]?.previous, null);
    assert.equal(grouped[0]?.delta, null);
  });

  it('reports a fall as a fall', () => {
    const grouped = groupMatchesByJob([run(2, backend, 60, 5), run(1, backend, 66, 1)]);
    assert.equal(grouped[0]?.delta, -6);
  });

  it('handles no comparisons at all', () => {
    assert.deepEqual(groupMatchesByJob([]), []);
  });
});

describe('progression', () => {
  it('runs oldest first — the order the story happened in', () => {
    const [g] = groupMatchesByJob([run(3, backend, 71, 5), run(2, backend, 68, 3), run(1, backend, 66, 1)]);
    assert.deepEqual(progression(g!).map((r) => r.matchScore), [66, 68, 71]);
    assert.equal(historyLabel(g!), '3 runs');
  });

  it('stays silent for a posting checked once — there is no story yet', () => {
    const [g] = groupMatchesByJob([run(1, backend, 66, 1)]);
    assert.deepEqual(progression(g!), []);
    assert.equal(historyLabel(g!), null);
  });

  it('does not reorder the group it was given', () => {
    const [g] = groupMatchesByJob([run(2, backend, 71, 5), run(1, backend, 66, 1)]);
    progression(g!);
    assert.equal(g!.runs[0]?.matchScore, 71);
  });
});
