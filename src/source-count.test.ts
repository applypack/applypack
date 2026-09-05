import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

function sourceKindCount(): number {
  const schema = readFileSync(join(ROOT, 'prisma', 'schema.prisma'), 'utf8');
  const block = /enum AtsType \{([^}]*)\}/.exec(schema)?.[1] ?? '';
  const values = block.split('\n').map((l) => l.trim()).filter((l) => /^[A-Z][A-Z_0-9]*$/.test(l));
  return values.filter((v) => !NOT_A_SOURCE.has(v)).length;
}

/** Every "<number> … source(s)" phrase in a document, so a stale number anywhere fails, not only the one place we remembered to check. */
function countedSourcePhrases(text: string): number[] {
  return [...text.matchAll(/\b(\d+) (?:kinds of (?:job )?sources?|job sources?|sources?)\b/g)].map((m) => Number(m[1]));
}

const DOCS = ['README.md', 'site/public/index.html'];

test('the README and the landing page state the number of source kinds the enum has', () => {
  const expected = sourceKindCount();
  assert.ok(expected >= 30, `enum parse looks wrong: ${expected}`);
  for (const file of DOCS) {
    const numbers = countedSourcePhrases(readFileSync(join(ROOT, file), 'utf8'));
    assert.ok(numbers.length > 0, `${file} no longer states a source count`);
    assert.deepEqual(
      numbers,
      numbers.map(() => expected),
      `${file} says ${[...new Set(numbers)].join('/')} where the enum has ${expected} kinds of source`,
    );
  }
});
