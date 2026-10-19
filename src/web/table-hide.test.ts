import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hideCellsClass, hideHeaderClass, shownShares } from './table-hide';
import { WATCHLIST_HIDE, WATCHLIST_WIDTHS } from './pages/watchlist';

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

test('a hidden column gives its share to the columns that show', () => {
  const widths = ['w-[24%]', 'w-[12%]', 'w-[24%]'];
  assert.deepEqual(shownShares(widths, ['', 'md', ''], ''), [0.5, null, 0.5]);
  assert.deepEqual(shownShares(widths, ['', 'md', ''], 'md'), [0.4, 0.2, 0.4]);
  assert.deepEqual(shownShares(widths, undefined, 'sm'), [0.4, 0.2, 0.4]);
});

/*
 * The narrowest box a table has from each breakpoint up: the window's width
 * there, less the menu (a 64 px rail from md, 240 px from lg) and the page's
 * gutters (16 / 24 / 32 px a side) — DESIGN.md "Layout". Below sm, a 320 px phone.
 */
const NARROWEST_BOX = { '': 320 - 2 * 16, sm: 640 - 2 * 24, md: 768 - 64 - 2 * 24, lg: 1024 - 240 - 2 * 32, xl: 1280 - 240 - 2 * 32 } as const;
/** A cell's padding at its widest: 16 px a side from sm; 10 px and the row's 14 px edge below it. */
const CELL_PADDING = { '': 24, sm: 32, md: 32, lg: 32, xl: 32 } as const;
/** The wider of the watchlist's two selects: the alert one's `min-w-[8.75rem]`. */
const SELECT_PX = 140;
/** The widest "Check now" button, measured: the French "Vérifier maintenant". */
const CHECK_NOW_PX = 140;

test('the watchlist keeps both selects, and its buttons, in columns at least as wide as they are, at every width (#537)', () => {
  for (const at of ['', 'sm', 'md', 'lg', 'xl'] as const) {
    const shares = shownShares(WATCHLIST_WIDTHS, WATCHLIST_HIDE, at);
    const room = (share: number | null | undefined): number => (share ?? 0) * NARROWEST_BOX[at] - CELL_PADDING[at];
    assert.ok(typeof shares[1] === 'number', `the selects' column shows from ${at || 'the smallest screen'}`);
    assert.ok(room(shares[1]) >= SELECT_PX, `at ${at || 'phone'} width the selects get ${Math.round(room(shares[1]))} px`);
    if (shares[4] !== null) assert.ok(room(shares[4]) >= CHECK_NOW_PX, `at ${at || 'phone'} width Check now gets ${Math.round(room(shares[4]))} px`);
  }
});
