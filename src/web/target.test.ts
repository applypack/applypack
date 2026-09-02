import { test } from 'node:test';
import assert from 'node:assert/strict';

// The matcher ships to the browser as a static ES module; node loads it the same way.
// @ts-expect-error — plain JS with no declaration file; the shape is asserted below.
const matcher = import('./public/target.mjs') as Promise<{
  findTerm: (text: string, term: string, aliases?: string[]) => { start: number; end: number }[];
  scoreKeywords: (
    keywords: { term: string; priority: number; requirement?: string; status: string; aliases?: string[] }[],
    text: string,
    opts?: { includeCannotClaim?: boolean },
  ) => { score: number; rows: { term: string; found: boolean; count: number; weight: number; excluded: boolean }[] };
  locateQuote: (text: string, quote: string | null) => { start: number; end: number } | null;
  highlightHtml: (text: string, spans: { start: number; end: number; cls: string; title?: string }[]) => string;
  jobSpans: (
    keywords: { term: string; priority: number; requirement?: string; status: string; aliases?: string[] }[],
    jobText: string,
    scored: { rows: { term: string; found: boolean }[] },
  ) => { start: number; end: number; cls: string }[];
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

test('findTerm spans index the original text even with tabs, double spaces and curly quotes', async () => {
  const { findTerm } = await matcher;
  const text = 'Headquarters:  New York\t\tAre you a talented Senior Developer? We’re hiring “Go” devs.';
  for (const term of ['Senior Developer', "we're", 'go']) {
    const [span] = findTerm(text, term);
    assert.ok(span, `no span for ${term}`);
    assert.equal(text.slice(span.start, span.end).toLowerCase().replace(/[’“”]/g, (c) => (c === '’' ? "'" : '"')), term.toLowerCase());
  }
  assert.equal(findTerm('continuous   delivery pipeline', 'continuous delivery').length, 1);
});

test('scoreKeywords weights requirement levels and excludes cannot_claim and context', async () => {
  const { scoreKeywords } = await matcher;
  const keywords = [
    { term: 'PHP', priority: 1, requirement: 'must', status: 'present' },
    { term: 'Angular', priority: 1, requirement: 'must', status: 'cannot_claim' },
    { term: 'Docker', priority: 3, requirement: 'nice', status: 'add' },
    { term: 'Laravel', priority: 2, requirement: 'preferred', status: 'present' },
  ];
  const r = scoreKeywords(keywords, RESUME);
  // PHP 3 + Laravel 2 earned of 3 + 1 + 2 = 6 → 83
  assert.equal(r.score, 83);
  assert.equal(r.rows.find((x) => x.term === 'Angular')?.excluded, true);
  assert.equal(scoreKeywords(keywords, RESUME, { includeCannotClaim: true }).score, 56);
  assert.equal(scoreKeywords([], RESUME).score, 0);

  // "context" keywords carry no weight and never count either way.
  const withContext = [...keywords, { term: 'PostgreSQL', priority: 4, requirement: 'context', status: 'present' }];
  assert.equal(scoreKeywords(withContext, RESUME).score, 83);
  assert.equal(scoreKeywords(withContext, RESUME).rows.find((x) => x.term === 'PostgreSQL')?.excluded, true);

  // Rows without a requirement level (pre-ADR-0012 matches) fall back to priority weights.
  assert.equal(scoreKeywords([{ term: 'PHP', priority: 1, status: 'present' }], RESUME).rows[0]?.weight, 3);
});

test('jobSpans classes: found, missing, ask_user and cannot_claim', async () => {
  const { jobSpans, scoreKeywords } = await matcher;
  const jobText = 'We need PHP, Angular, Docker and Terraform.';
  const keywords = [
    { term: 'PHP', priority: 1, requirement: 'must', status: 'present' },
    { term: 'Angular', priority: 1, requirement: 'must', status: 'cannot_claim' },
    { term: 'Docker', priority: 2, requirement: 'preferred', status: 'add' },
    { term: 'Terraform', priority: 2, requirement: 'preferred', status: 'ask_user' },
  ];
  const scored = scoreKeywords(keywords, RESUME);
  const byCls = jobSpans(keywords, jobText, scored).map((s) => s.cls);
  assert.deepEqual(byCls, ['kw-found', 'kw-cannot', 'kw-missing', 'kw-ask']);
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

test('target-page module imports without a DOM and exposes init', async () => {
  // The page wiring must keep every document/localStorage touch inside init(),
  // or serving it to node:test (and to the browser before DOMContentLoaded) breaks.
  // @ts-expect-error — plain JS with no declaration file.
  const page = (await import('./public/target-page.mjs')) as { init: unknown };
  assert.equal(typeof page.init, 'function');
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

// F4 — plural tolerance on the last token, both directions. F5 — separators
// between the tokens of a multi-token term are interchangeable and optional.
// Guards keep the whole-token rule (C ≠ C++, Java ≠ JavaScript) and rule out
// stemming: a Capitalised name ending in s is not a plural.
const TOLERANCE: [term: string, text: string, hits: number][] = [
  // F4: singular term, plural text
  ['microservice', 'microservices architecture', 1],
  ['API', 'REST APIs', 1],
  ['query', 'SQL queries', 1],
  ['class', 'PHP classes', 1],
  ['unit test', 'unit tests', 1],
  ['proxy', 'reverse proxies', 1],
  // F4: plural term, singular text
  ['microservices', 'a microservice', 1],
  ['APIs', 'REST API design', 1],
  ['LLMs', 'an LLM', 1],
  ['queries', 'one query', 1],
  ['patches', 'a security patch', 1],
  ['releases', 'each release', 1],
  ['databases', 'the database', 1],
  ['unit tests', 'unit test coverage', 1],
  // F4 guards
  ['Rails', 'light rail', 0],
  ['rails', 'light rail', 0],
  ['Windows', 'window functions', 0],
  ['Kubernetes', 'Kubernetes', 1],
  ['AWS', 'aw', 0],
  ['Go', 'goes', 0],
  ['Sass', 'SAS', 0],
  ['scaling', 'scale', 0],
  ['Java', 'JavaScript', 0],
  ['C', 'C++', 0],
  ['Node', 'Node.js', 0],
  // F5: separators
  ['CI/CD', 'CI / CD', 1],
  ['CI/CD', 'CI-CD', 1],
  ['CI / CD', 'CI/CD', 1],
  ['Node.js', 'NodeJS', 1],
  ['Node.js', 'Node js', 1],
  ['front-end', 'front end', 1],
  ['front-end', 'frontend', 1],
  ['front end', 'front-end', 1],
  ['docker-compose', 'Docker Compose', 1],
  ['ASP.NET', 'aspnet', 1],
  ['A/B testing', 'AB testing', 1],
  ['test-driven development', 'Test Driven Development', 1],
  // F5 guards: edge symbols stay literal, single tokens stay whole
  ['.NET', 'ASP.NET', 0],
  ['.NET', '.NET Core', 1],
  ['C#', 'C', 0],
  ['C++', 'C++ and C', 1],
  ['PHP', 'x.php', 0],
  ['PHP', 'PHP.', 1],
  ['NodeJS', 'Node.js', 0],
];

test('findTerm tolerates plurals and separators and keeps the whole-token guards', async () => {
  const { findTerm } = await matcher;
  for (const [term, text, hits] of TOLERANCE) {
    assert.equal(findTerm(text, term).length, hits, `${JSON.stringify(term)} in ${JSON.stringify(text)}`);
  }
});

test('findTerm counts a span once when the term and an alias both spell it', async () => {
  const { findTerm } = await matcher;
  assert.deepEqual(findTerm('frontend work', 'front end', ['frontend']), [{ start: 0, end: 8 }]);
});
