import { test } from 'node:test';
import assert from 'node:assert/strict';

// @ts-expect-error — plain JS with no declaration file; the shape is asserted below.
const board = import('./public/board.mjs') as Promise<{
  planMove: (
    jobId: string | undefined,
    fromStage: string | undefined,
    toStage: string | undefined,
  ) => { action: string; body: string } | null;
  initBoard: unknown;
}>;

test('planMove builds the stage-only request', async () => {
  const { planMove } = await board;
  assert.deepEqual(planMove('12', 'applied', 'screen'), {
    action: '/jobs/12/stage',
    body: 'toStage=screen',
  });
});

test('planMove is a no-op for the same stage', async () => {
  const { planMove } = await board;
  assert.equal(planMove('12', 'screen', 'screen'), null);
});

test('planMove refuses incomplete input', async () => {
  const { planMove } = await board;
  assert.equal(planMove(undefined, 'applied', 'screen'), null);
  assert.equal(planMove('12', 'applied', undefined), null);
});

test('planMove url-encodes both values', async () => {
  const { planMove } = await board;
  assert.deepEqual(planMove('1/2', 'applied', 'a b'), {
    action: '/jobs/1%2F2/stage',
    body: 'toStage=a%20b',
  });
});

test('board module imports without a DOM and exposes initBoard', async () => {
  const mod = await board;
  assert.equal(typeof mod.initBoard, 'function');
});
