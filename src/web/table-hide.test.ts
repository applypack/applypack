import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hideCellsClass, hideHeaderClass } from './table-hide';

test('a column hidden below a breakpoint hides its header and its cells from the same declaration', () => {
  const hide = ['', 'xl', 'lg', '', 'sm', 'sm', ''] as const;
  assert.equal(hideHeaderClass(hide, 0), '');
  assert.equal(hideHeaderClass(hide, 1), 'hidden xl:table-cell');
  assert.equal(hideHeaderClass(hide, 4), 'hidden sm:table-cell');
  assert.equal(
    hideCellsClass(hide),
    '[&_td:nth-child(2)]:hidden xl:[&_td:nth-child(2)]:table-cell ' +
      '[&_td:nth-child(3)]:hidden lg:[&_td:nth-child(3)]:table-cell ' +
      '[&_td:nth-child(5)]:hidden sm:[&_td:nth-child(5)]:table-cell ' +
      '[&_td:nth-child(6)]:hidden sm:[&_td:nth-child(6)]:table-cell',
  );
  assert.equal(hideCellsClass(undefined), '');
  assert.equal(hideHeaderClass(undefined, 3), '');
});
