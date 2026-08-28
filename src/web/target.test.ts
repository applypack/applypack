import { test } from 'node:test';
import assert from 'node:assert/strict';

// The matcher ships to the browser as a static ES module; node loads it the same way.
// @ts-expect-error — plain JS with no declaration file; the shape is asserted below.
const matcher = import('./public/target.mjs') as Promise<{
  findTerm: (text: string, term: string, aliases?: string[]) => { start: number; end: number }[];
  scoreKeywords: (
    keywords: { term: string; priority: number; status: string; aliases?: string[] }[],
    text: string,
    opts?: { includeCannotClaim?: boolean },
  ) => { score: number; rows: { term: string; found: boolean; count: number; excluded: boolean }[] };
  locateQuote: (text: string, quote: string | null) => { start: number; end: number } | null;
  highlightHtml: (text: string, spans: { start: number; end: number; cls: string; title?: string }[]) => string;
  resumeSpans: (
    keywords: { term: string; priority: number; status: string; aliases?: string[] }[],
    actions: { quote: string | null; what: string }[],
    removals: { quote: string | null; what: string }[],
    text: string,
  ) => { start: number; end: number; cls: string }[];
}>;

const RESUME = 'Senior PHP/Laravel engineer. Node.js, C++, CI/CD and PostgreSQL. Built .NET tools.';

test('findTerm matches whole tokens, aliases and symbol-heavy tech names', async () => {
  const { findTerm } = await matcher;
  assert.equal(findTerm(RESUME, 'PHP').length, 1);
  assert.equal(findTerm(RESUME, 'Node.js').length, 1);
  assert.equal(findTerm(RESUME, 'C++').length, 1);
  assert.equal(findTerm(RESUME, '.NET').length, 1);
  assert.equal(findTerm(RESUME, 'CI/CD').length, 1);
  assert.equal(findTerm(RESUME, 'Postgres', ['postgresql']).length, 1);
  assert.equal(findTerm(RESUME, 'Java').length, 0, 'no substring hits inside other words');
  assert.equal(findTerm(RESUME, 'C').length, 0, 'C is not C++');
});

test('scoreKeywords weights priorities and excludes cannot_claim by default', async () => {
  const { scoreKeywords } = await matcher;
  const keywords = [
    { term: 'PHP', priority: 1, status: 'present' },
    { term: 'Angular', priority: 1, status: 'cannot_claim' },
    { term: 'Docker', priority: 3, status: 'add' },
    { term: 'Laravel', priority: 2, status: 'present' },
  ];
  const r = scoreKeywords(keywords, RESUME);
  // PHP 3 + Laravel 2 earned of 3 + 1 + 2 = 6 → 83
  assert.equal(r.score, 83);
  assert.equal(r.rows.find((x) => x.term === 'Angular')?.excluded, true);
  assert.equal(scoreKeywords(keywords, RESUME, { includeCannotClaim: true }).score, 56);
  assert.equal(scoreKeywords([], RESUME).score, 0);
});

test('locateQuote finds exact text, then tolerates punctuation and spacing drift', async () => {
  const { locateQuote } = await matcher;
  const text = 'Led the team.\n- Reduced costs by 30% — hundreds of thousands annually.\nDone.';
  assert.deepEqual(locateQuote(text, 'Reduced costs by 30%'), { start: 16, end: 36 });
  const loose = locateQuote(text, 'reduced costs by 30 %, hundreds of thousands annually');
  assert.ok(loose && loose.start === 16);
  assert.equal(locateQuote(text, 'something the model made up entirely'), null);
  assert.equal(locateQuote(text, null), null);
});

test('highlightHtml wraps spans, escapes html and drops overlaps', async () => {
  const { highlightHtml } = await matcher;
  const html = highlightHtml('a <b> c d', [
    { start: 2, end: 5, cls: 'x' },
    { start: 3, end: 7, cls: 'y' },
    { start: 6, end: 7, cls: 'z', title: 'q"t' },
  ]);
  assert.equal(html, 'a <mark class="x">&lt;b&gt;</mark> <mark class="z" title="q&quot;t">c</mark> d'.replace('&quot;', '"'));
});

test('resumeSpans marks keywords and quoted edits, edits first on ties', async () => {
  const { resumeSpans } = await matcher;
  const spans = resumeSpans(
    [{ term: 'PHP', priority: 1, status: 'present' }],
    [{ quote: 'Senior PHP/Laravel engineer', what: 'retitle' }],
    [{ quote: 'Built .NET tools.', what: 'drop' }],
    RESUME,
  );
  assert.deepEqual(
    spans.map((s) => s.cls),
    ['edit-change', 'kw-present', 'edit-remove'],
  );
});
