import { test } from 'node:test';
import assert from 'node:assert/strict';

interface RunState {
  running?: boolean;
  done: number;
  failed: number;
  total: number;
  queued?: number[];
  inFlight?: number[];
  finished?: number[];
}
// The page module ships as a static ES module; node loads it the same way.
// @ts-expect-error — plain JS with no declaration file; the shape is asserted below.
const page = import('./public/screen.mjs') as Promise<{
  progressLine: (state: RunState) => string;
  rowRunState: (number: number, state: RunState | null) => 'queued' | 'scoring' | 'scored' | null;
  selectionLine: (checked: number, total: number) => string;
  pathedFiles: (files: { name: string; webkitRelativePath?: string }[]) => { name: string }[];
  init: unknown;
}>;

test('screen.mjs: progressLine, rowRunState, selectionLine, pathedFiles', async () => {
  const { progressLine, rowRunState, selectionLine, pathedFiles } = await page;
  assert.equal(
    progressLine({ done: 2, failed: 0, total: 5, inFlight: [3, 4], queued: [5] }),
    'Scoring… 2 of 5 — now reading №3, №4; 1 queued. Each row says where it is; scored rows appear on refresh.',
  );
  assert.match(progressLine({ done: 10, failed: 2, total: 40 }), /12 of 40 \(2 failed\)\. Each row/);
  const state = { running: true, done: 1, failed: 0, total: 4, inFlight: [2], queued: [3], finished: [1] };
  assert.equal(rowRunState(2, state), 'scoring');
  assert.equal(rowRunState(3, state), 'queued');
  assert.equal(rowRunState(1, state), 'scored');
  assert.equal(rowRunState(9, state), null);
  assert.equal(rowRunState(2, { ...state, running: false }), null, 'a finished run marks nobody');
  assert.equal(selectionLine(0, 12), 'none of 12 selected');
  assert.equal(selectionLine(3, 12), '3 of 12 selected');
  assert.deepEqual(
    pathedFiles([{ name: 'CV.pdf', webkitRelativePath: 'batch/Ivan Petrenko/CV.pdf' }, { name: 'anna.docx', webkitRelativePath: '' }]).map((f) => f.name),
    ['batch/Ivan Petrenko/CV.pdf', 'anna.docx'],
    'a folder pick keeps its path, a file pick its name',
  );
});
