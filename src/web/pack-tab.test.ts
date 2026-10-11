import { test } from 'node:test';
import assert from 'node:assert/strict';

interface Field {
  type?: string;
  value?: string;
  defaultValue?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
  options?: { selected: boolean; defaultSelected: boolean }[];
}
interface Move {
  text: string | null;
  reload: boolean;
  again: boolean;
}

// The pack tab's driver ships as a static ES module; node loads it the same way.
// @ts-expect-error — plain JS with no declaration file; the shape is asserted below.
const tab = import('./public/pack-tab.mjs') as Promise<{
  fieldChanged: (field: Field) => boolean;
  unsavedWork: (fields: Field[], active: Field | null) => boolean;
  nextMove: (state: { busy: boolean; line?: string; wait?: string }, unsaved: boolean) => Move;
  init: unknown;
}>;

const notes = (value: string): Field => ({ type: 'textarea', value, defaultValue: '' });

test('a field counts as changed only when it holds something the page did not load with', async () => {
  const { fieldChanged } = await tab;
  assert.equal(fieldChanged(notes('')), false);
  assert.equal(fieldChanged(notes('Recruiter said call me Tuesday')), true);
  assert.equal(fieldChanged({ type: 'date', value: '2026-10-06', defaultValue: '2026-10-06' }), false);
  assert.equal(fieldChanged({ type: 'checkbox', checked: true, defaultChecked: false }), true);
  assert.equal(fieldChanged({ type: 'checkbox', checked: true, defaultChecked: true }), false);
  // A select: the rail's resume picker moved off the option the page chose.
  const options = [{ selected: false, defaultSelected: true }, { selected: true, defaultSelected: false }];
  assert.equal(fieldChanged({ type: 'select-one', options }), true);
  assert.equal(fieldChanged({ type: 'select-one', options: [{ selected: true, defaultSelected: true }] }), false);
  // What the person cannot edit is never their unsaved work.
  assert.equal(fieldChanged({ type: 'hidden', value: 'pack', defaultValue: '' }), false);
  assert.equal(fieldChanged({ type: 'text', value: 'x', defaultValue: '', disabled: true }), false);
});

test('a reload would cost work when a field was edited, or the person is in one', async () => {
  const { unsavedWork } = await tab;
  const clean = notes('');
  assert.equal(unsavedWork([clean, notes('')], null), false);
  assert.equal(unsavedWork([clean, notes('Called Dana')], null), true);
  // Focused and still empty: the next keystroke is theirs.
  assert.equal(unsavedWork([clean], clean), true);
});

test('a pack in flight has its line rewritten; one that finished reloads the page, never over an edit (#378)', async () => {
  const { nextMove, init } = await tab;
  assert.deepEqual(nextMove({ busy: true, line: 'Checking the company…' }, false), { text: 'Checking the company…', reload: false, again: true });
  // Typing into Notes while the company check runs: the line still moves, the page stays.
  assert.deepEqual(nextMove({ busy: true, line: 'Checking the company…' }, true), { text: 'Checking the company…', reload: false, again: true });
  assert.deepEqual(nextMove({ busy: false, wait: 'The pack has finished. Save…' }, false), { text: null, reload: true, again: false });
  assert.deepEqual(nextMove({ busy: false, wait: 'The pack has finished. Save…' }, true), { text: 'The pack has finished. Save…', reload: false, again: false });
  assert.equal(typeof init, 'function');
});
