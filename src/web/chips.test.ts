import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLineList, parseTagList } from '../text-utils';

// @ts-expect-error — plain JS with no declaration file; the shape is asserted below.
const chips = import('./public/chips.mjs') as Promise<{
  chipValues: (text: string, linesOnly?: boolean) => string[];
  withChips: (list: string[], values: string[]) => string[];
}>;

test('"rust, elixir" and Enter makes two chips, as the save would store them (#572)', async () => {
  const { chipValues, withChips } = await chips;
  assert.deepEqual(chipValues('rust, elixir'), ['rust', 'elixir']);
  assert.deepEqual(chipValues('  go  '), ['go']);
  assert.deepEqual(chipValues(' , '), []);
  for (const typed of ['rust, elixir', 'php,\nlaravel , mysql', 'Austin, TX']) assert.deepEqual(chipValues(typed), parseTagList(typed));
  assert.deepEqual(withChips(['rust'], ['rust', 'elixir']), ['rust', 'elixir'], 'a chip already there is not added twice');
});

test('a field of places makes "Austin, TX" one chip, as the save stores it (#607)', async () => {
  const { chipValues } = await chips;
  assert.deepEqual(chipValues('Austin, TX', true), ['Austin, TX']);
  for (const typed of ['Austin, TX', 'Austin, TX\nBerlin', ' Denver, CO \n\n']) assert.deepEqual(chipValues(typed, true), parseLineList(typed));
});
