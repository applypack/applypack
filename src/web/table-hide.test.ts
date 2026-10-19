import { test } from 'node:test';
import assert from 'node:assert/strict';
import { columnWidths, hideCellsClass, hideHeaderClass, type HideBelow } from './table-hide';
import { WATCHLIST_HIDE, WATCHLIST_WIDTHS } from './pages/watchlist';
import { JOBS_HIDE, JOBS_WIDTHS } from './pages/jobs-list';
import { RUNS_HIDE, RUNS_WIDTHS } from './pages/runs';
import { CANDIDATE_HIDE, CANDIDATE_WIDTHS } from './pages/discovery';

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

test('a hidden column gives its room to the columns that show', () => {
  const widths = ['w-[24%]', 'w-[12%]', 'w-[24%]'];
  assert.deepEqual(columnWidths(widths, ['', 'md', ''], '', 600), [300, null, 300]);
  assert.deepEqual(columnWidths(widths, ['', 'md', ''], 'md', 600), [240, 120, 240]);
  assert.deepEqual(columnWidths(widths, undefined, 'sm', 600), [240, 120, 240]);
});

test('a column given no width takes what the others leave, and a width it cannot read is an error', () => {
  const widths = ['', 'w-[10%]', 'w-[5rem]'];
  assert.deepEqual(columnWidths(widths, ['', '', 'sm'], '', 400), [360, 40, null]);
  assert.deepEqual(columnWidths(widths, ['', '', 'sm'], 'sm', 400), [280, 40, 80]);
  assert.throws(() => columnWidths(['w-24'], undefined, '', 400), /w-24/);
});

/*
 * The narrowest box a table has from each breakpoint up: the window's width
 * there, less the menu (a 64 px rail from md, 240 px from lg) and the page's
 * gutters (16 / 24 / 32 px a side) — DESIGN.md "Layout". Below sm, a 320 px phone.
 */
const NARROWEST_BOX = { '': 320 - 2 * 16, sm: 640 - 2 * 24, md: 768 - 64 - 2 * 24, lg: 1024 - 240 - 2 * 32, xl: 1280 - 240 - 2 * 32 } as const;
/** A cell's padding at its widest: 16 px a side from sm; 10 px and the row's 14 px edge below it. */
const CELL_PADDING = { '': 24, sm: 32, md: 32, lg: 32, xl: 32 } as const;
const BREAKPOINTS = ['', 'sm', 'md', 'lg', 'xl'] as const;

/** Each column's room for its content in the narrowest box from `at` up; null for a hidden one. */
const room = (widths: readonly string[], hide: HideBelow, at: (typeof BREAKPOINTS)[number]): (number | null)[] =>
  columnWidths(widths, hide, at, NARROWEST_BOX[at]).map((w) => (w === null ? null : w - CELL_PADDING[at]));
const where = (at: string): string => at || 'phone';

/** The wider of the watchlist's two selects: the alert one's `min-w-[8.75rem]`. */
const SELECT_PX = 140;
/** The widest "Check now" button, measured: the French "Vérifier maintenant". */
const CHECK_NOW_PX = 140;

/*
 * What a control in a column needs, measured in the dashboard's own fonts in
 * English, Ukrainian, French and Spanish (2026-10-19). A badge, a stamp or a
 * button wider than its column draws over the next one, and past the last
 * one it scrolls the table sideways (#612). A badge breaks between words, so
 * its widest word is what it needs.
 */
/** The fit badge at 100. */
const FIT_BADGE_PX = 45;
/** A job's status badge around its widest word: the French "Candidature" (envoyée). */
const STATUS_WORD_PX = 91;
/** A run's badge around its widest word: the Ukrainian "Виконується". */
const RUN_BADGE_WORD_PX = 96;
/** The widest word in a run's name: the Spanish "Descubrimiento". */
const RUN_NAME_WORD_PX = 97;
/** A run's start, which does not wrap: the Ukrainian "28 жовт., 23:59". */
const STAMP_PX = 106;
/** A run's duration, which does not wrap: the French "123,4 min". */
const DURATION_PX = 71;
/** The widest of a candidate's buttons, which stack: the Ukrainian "Додати до компаній". */
const CANDIDATE_BUTTON_PX = 150;
/** What the column that takes the rest keeps at least: a title, what a run did, a board's name. */
const TITLE_MIN_PX = 180;
const WHAT_HAPPENED_MIN_PX = 120;
const BOARD_MIN_PX = 64;

test('the watchlist keeps both selects, and its buttons, in columns at least as wide as they are, at every width (#537)', () => {
  for (const at of BREAKPOINTS) {
    const [, selects, , , checkNow] = room(WATCHLIST_WIDTHS, WATCHLIST_HIDE, at);
    assert.ok(typeof selects === 'number', `the selects' column shows from ${at || 'the smallest screen'}`);
    assert.ok(selects >= SELECT_PX, `at ${where(at)} width the selects get ${Math.round(selects)} px`);
    if (checkNow !== null) assert.ok(checkNow! >= CHECK_NOW_PX, `at ${where(at)} width Check now gets ${Math.round(checkNow!)} px`);
  }
});

test('the jobs table keeps the title, the fit and the status in its box at every width (#612)', () => {
  for (const at of BREAKPOINTS) {
    const [title, , , fit, , status] = room(JOBS_WIDTHS, JOBS_HIDE, at);
    assert.ok(title! >= TITLE_MIN_PX, `at ${where(at)} width the title gets ${Math.round(title!)} px`);
    assert.ok(fit! >= FIT_BADGE_PX, `at ${where(at)} width the fit gets ${Math.round(fit!)} px`);
    if (at !== '') assert.ok(status! >= STATUS_WORD_PX, `at ${where(at)} width the status gets ${Math.round(status ?? 0)} px`);
  }
});

test('the runs table keeps the job, its status and what happened in its box at every width (#612)', () => {
  for (const at of BREAKPOINTS) {
    const [job, started, duration, status, what] = room(RUNS_WIDTHS, RUNS_HIDE, at);
    assert.ok(job! >= RUN_NAME_WORD_PX, `at ${where(at)} width the job gets ${Math.round(job!)} px`);
    // Below sm the status rides under the job's name.
    assert.ok((status ?? job!) >= RUN_BADGE_WORD_PX, `at ${where(at)} width the status gets ${Math.round(status ?? job!)} px`);
    if (at !== '') assert.ok(status !== null, `the status has a column from ${at}`);
    if (started != null) assert.ok(started >= STAMP_PX, `at ${where(at)} width the start gets ${Math.round(started)} px`);
    if (duration != null) assert.ok(duration >= DURATION_PX, `at ${where(at)} width the duration gets ${Math.round(duration)} px`);
    assert.ok(what! >= WHAT_HAPPENED_MIN_PX, `at ${where(at)} width what happened gets ${Math.round(what!)} px`);
  }
});

test('the discovered boards keep their buttons in their box at every width (#612)', () => {
  for (const at of BREAKPOINTS) {
    const cols = room(CANDIDATE_WIDTHS, CANDIDATE_HIDE, at);
    assert.ok(cols[0]! >= BOARD_MIN_PX, `at ${where(at)} width the board gets ${Math.round(cols[0]!)} px`);
    assert.ok(cols[5]! >= CANDIDATE_BUTTON_PX, `at ${where(at)} width the buttons get ${Math.round(cols[5]!)} px`);
  }
});
