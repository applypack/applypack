import { test } from 'node:test';
import assert from 'node:assert/strict';

// Served as a static ES module; node loads it the same way the browser does.
// @ts-expect-error — plain JS with no declaration file; the shape is asserted below.
const mod = import('./public/select-commit.mjs') as Promise<{
  createState: () => { keyboard: boolean; dirty: boolean };
  decide: (state: { keyboard: boolean; dirty: boolean }, kind: string, key?: string) => boolean;
  wireSelectCommits: unknown;
}>;

async function run(events: [string, string?][]): Promise<number> {
  const { createState, decide } = await mod;
  const state = createState();
  return events.filter(([kind, key]) => decide(state, kind, key)).length;
}

test('a pointer pick commits at once', async () => {
  assert.equal(await run([['pointerdown'], ['change']]), 1);
});

test('arrowing through options commits once, when the select loses focus', async () => {
  assert.equal(await run([['keydown', 'ArrowDown'], ['change'], ['keydown', 'ArrowDown'], ['change'], ['blur']]), 1);
});

test('Enter commits a keyboard pick; a bare Enter or blur with nothing new does not', async () => {
  assert.equal(await run([['keydown', 'ArrowDown'], ['change'], ['keydown', 'Enter']]), 1);
  assert.equal(await run([['keydown', 'Enter'], ['blur']]), 0);
});

test('a pointer pick after some arrowing is still a deliberate pick', async () => {
  assert.equal(await run([['keydown', 'ArrowDown'], ['pointerdown'], ['change']]), 1);
});

test('the module imports without a DOM and exposes the wiring', async () => {
  assert.equal(typeof (await mod).wireSelectCommits, 'function');
});
