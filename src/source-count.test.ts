import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sourceFamily } from './web/source-groups';

/*
 * The README and the landing page state how many kinds of job source ApplyPack
 * reads. The number went stale through three releases and was wrong in seven
 * places at once (#160), so it is derived here from the enum, the same way
 * prompt-fence-registry.test.ts derives its rosters: a new source fails CI
 * until the copy says the new number.
 */

const ROOT = join(__dirname, '..');

/** Enum values that are not a kind of source: pasted jobs, and the change watch on a careers page. */
const NOT_A_SOURCE = new Set(['MANUAL', 'CAREER_PAGE']);

function atsTypes(): string[] {
  const schema = readFileSync(join(ROOT, 'prisma', 'schema.prisma'), 'utf8');
  const block = /enum AtsType \{([^}]*)\}/.exec(schema)?.[1] ?? '';
  return block.split('\n').map((l) => l.trim()).filter((l) => /^[A-Z][A-Z_0-9]*$/.test(l));
}

function sourceKinds(): string[] {
  return atsTypes().filter((v) => !NOT_A_SOURCE.has(v));
}

/*
 * The launch drafts spell their numbers out, and a digits-only reader never
 * saw them: the Show HN draft said "seven more ATS vendors … eleven
 * aggregators" while the code had twelve and twenty. Every count below is
 * read as digits or as English words up to ninety-nine.
 */
const UNITS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/** "33", "twelve", "Thirty-three" → the number; any other word → null. */
function numberValue(token: string): number | null {
  if (/^\d+$/.test(token)) return Number(token);
  const [head = '', unit, ...rest] = token.toLowerCase().split('-');
  if (rest.length > 0) return null;
  if (unit === undefined && UNITS.includes(head)) return UNITS.indexOf(head);
  const tens = TENS[head];
  if (tens === undefined) return null;
  if (unit === undefined) return tens;
  const u = UNITS.indexOf(unit);
  return u >= 1 && u <= 9 ? tens + u : null;
}

const NUMBER = String.raw`(\d+|[a-z]+(?:-[a-z]+)?)`;

/*
 * A count under ten is prose about a subset ("the two sources that need a
 * key") unless it says "more" or "other", which is the shape of the Show HN
 * slip; "N more" is read as N, so the copy states the total.
 */
const SUBSET_BELOW = 10;

/** The count in every match of `noun` after a number; a word that is not a number ("open source", "the aggregators") is skipped. */
function countsBefore(text: string, noun: string): number[] {
  const pattern = new RegExp(String.raw`\b${NUMBER}\s+((?:more|other)\s+)?${noun}\b`, 'gi');
  return [...text.matchAll(pattern)].flatMap((m) => {
    const n = numberValue(m[1] ?? '');
    if (n === null || (n < SUBSET_BELOW && m[2] === undefined)) return [];
    return [n];
  });
}

/** Every "<number> … source(s)" phrase in a document, so a stale number anywhere fails, not only the one place we remembered to check. */
function countedSourcePhrases(text: string): number[] {
  return countsBefore(text, String.raw`(?:kinds\s+of\s+(?:job\s+)?sources?|job\s+sources?|sources?)`);
}

/* The split between the two is the one the Settings grid draws (web/source-groups.ts:sourceFamily). */
function countedVendorPhrases(text: string): number[] {
  return countsBefore(text, String.raw`ATS\s+vendors`);
}

function countedAggregatorPhrases(text: string): number[] {
  return countsBefore(text, String.raw`aggregators`);
}

/*
 * Every public copy of the number. package.json's description is what npm
 * and GitHub tooling show; the launch drafts are what gets posted. The
 * 2026-09-10 audit found 24 and 22 in those while README and the site said 33.
 */
const DOCS = [
  'README.md',
  'site/public/index.html',
  'docs/launch/show-hn.md',
  'docs/launch/reddit-selfhosted.md',
  'docs/launch/awesome-selfhosted-pr.md',
];

function publicCopies(): [string, string][] {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { description?: string };
  return [
    ...DOCS.map((file): [string, string] => [file, readFileSync(join(ROOT, file), 'utf8')]),
    ['package.json description', pkg.description ?? ''],
  ];
}

test('the phrase reader takes digits and number words, and skips words that are not numbers', () => {
  assert.deepEqual(countedSourcePhrases('checks 33 kinds of source, thirty-three\nsources, open source'), [33, 33]);
  assert.deepEqual(countedVendorPhrases('Twelve ATS vendors; Ashby and seven more ATS vendors; nine other ATS vendors'), [12, 7, 9]);
  assert.deepEqual(countedAggregatorPhrases('twenty aggregators; leave the aggregators on; two aggregators need a key'), [20]);
  assert.deepEqual(countedSourcePhrases('the two sources that need a key'), []);
});

test('every public copy states the number of source kinds the enum has', () => {
  const expected = sourceKinds().length;
  assert.ok(expected >= 30, `enum parse looks wrong: ${expected}`);
  for (const [file, text] of publicCopies()) {
    const numbers = countedSourcePhrases(text);
    assert.ok(numbers.length > 0, `${file} no longer states a source count`);
    assert.deepEqual(
      numbers,
      numbers.map(() => expected),
      `${file} says ${[...new Set(numbers)].join('/')} where the enum has ${expected} kinds of source`,
    );
  }
});

test('every public count of ATS vendors and aggregators matches the grouping in code', () => {
  const kinds = sourceKinds();
  const expected = {
    vendors: kinds.filter((k) => sourceFamily(k) === 'vendor').length,
    aggregators: kinds.filter((k) => sourceFamily(k) === 'aggregator').length,
  };
  assert.ok(expected.vendors >= 10 && expected.aggregators >= 10, `grouping looks wrong: ${JSON.stringify(expected)}`);
  for (const [file, text] of publicCopies()) {
    for (const [noun, numbers] of [
      ['vendors', countedVendorPhrases(text)],
      ['aggregators', countedAggregatorPhrases(text)],
    ] as const) {
      const want = expected[noun];
      assert.deepEqual(
        numbers,
        numbers.map(() => want),
        `${file} says ${[...new Set(numbers)].join('/')} ${noun} where the code groups ${want}`,
      );
    }
  }
});

/*
 * SPEC.md's Sources table has a row per AtsType but MANUAL (a pasted job has
 * no fetcher), and its heading counts the kinds of source among them. The
 * heading said 26 while the enum had 35 values, so both are read against the
 * enum here.
 */
test('SPEC.md lists every AtsType but MANUAL and counts the source kinds', () => {
  const spec = readFileSync(join(ROOT, 'SPEC.md'), 'utf8');
  const section = /^## Sources \(([^)]*)\)\n([\s\S]*?)\n\*\*Hard exclusions\*\*/m.exec(spec);
  assert.ok(section, 'SPEC.md has no "## Sources (…)" section');
  const [, heading = '', table = ''] = section;
  assert.deepEqual(countedSourcePhrases(heading), [sourceKinds().length], `SPEC.md heading: "${heading}"`);
  const rows = [...table.matchAll(/^\| ([A-Z][A-Z_0-9]*) +\|/gm)].map((m) => m[1]);
  assert.deepEqual([...rows].sort(), atsTypes().filter((v) => v !== 'MANUAL').sort());
});
