import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitTone } from './format';

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
  ) => { start: number; end: number; cls: string; title: string }[];
  resumeSpans: (
    keywords: { term: string; priority: number; status: string; aliases?: string[] }[],
    actions: { quote: string | null; what: string }[],
    removals: { quote: string | null; what: string }[],
    text: string,
  ) => { start: number; end: number; cls: string }[];
  keywordRank: (k: { requirement?: string; priority?: number; primary?: boolean }) => number;
  markClass: (k: { requirement?: string; status?: string; primary?: boolean }, found: boolean) => string;
  orderKeywords: <T extends { term: string; aliases?: string[] }>(
    keywords: T[],
    jobText: string,
  ) => (T & { count: number })[];
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

test('scoreKeywords weights requirement levels; every weighted term is in the denominator', async () => {
  const { scoreKeywords } = await matcher;
  const keywords = [
    { term: 'PHP', priority: 1, requirement: 'must', status: 'present' },
    { term: 'Angular', priority: 1, requirement: 'must', status: 'cannot_claim' },
    { term: 'Docker', priority: 3, requirement: 'nice', status: 'add' },
    { term: 'Laravel', priority: 2, requirement: 'preferred', status: 'present' },
  ];
  const r = scoreKeywords(keywords, RESUME);
  // PHP 3 + Laravel 2 earned of 3 + 3 + 1 + 2 = 9 → 56. Angular counts against
  // the resume although nothing backs it: the posting's demand is what it is.
  assert.equal(r.score, 56);
  assert.equal(r.rows.find((x) => x.term === 'Angular')?.excluded, false);
  // Written in, it earns its weight like any other term (ADR 0045): 8 of 9.
  assert.equal(scoreKeywords(keywords, `${RESUME}\nAngular`).score, 89);
  assert.equal(scoreKeywords([], RESUME).score, 0);

  // "context" keywords carry no weight and never count either way.
  const withContext = [...keywords, { term: 'PostgreSQL', priority: 4, requirement: 'context', status: 'present' }];
  assert.equal(scoreKeywords(withContext, RESUME).score, 56);
  assert.equal(scoreKeywords(withContext, RESUME).rows.find((x) => x.term === 'PostgreSQL')?.excluded, true);

  // Rows without a requirement level (pre-ADR-0012 matches) fall back to priority weights.
  assert.equal(scoreKeywords([{ term: 'PHP', priority: 1, status: 'present' }], RESUME).rows[0]?.weight, 3);
});

test('jobSpans colours by the level the posting asks at, not by AI status', async () => {
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
  assert.deepEqual(byCls, [
    'kw-have',
    // A must the resume cannot claim is the loudest gap on the page, never a
    // struck-out grey word: it is exactly what the posting is asking for.
    'kw-gap kw-must kw-unproven',
    'kw-gap kw-preferred',
    'kw-gap kw-preferred kw-unproven',
  ]);
});

test('markClass: a word the resume spells is green, whatever the analysis called it', async () => {
  const { markClass } = await matcher;
  const k = { requirement: 'must', status: 'cannot_claim', primary: true };
  assert.equal(markClass(k, true), 'kw-have');
  // Unwritten, it is the loudest gap on the page — dashed, since nothing backs it yet.
  assert.equal(markClass(k, false), 'kw-gap kw-must kw-core kw-unproven');
  assert.equal(markClass({ requirement: 'must', status: 'ask_user', primary: false }, false), 'kw-gap kw-must kw-unproven');
  assert.equal(markClass({ requirement: 'must', status: 'add', primary: false }, true), 'kw-have');
  assert.equal(markClass({ requirement: 'context', status: 'add', primary: false }, false), 'kw-gap kw-nice');
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
  assert.equal(html, 'a <mark class="x">&lt;b&gt;</mark> <mark class="z" title="q&quot;t">c</mark> d');
});

test('highlightHtml keeps a quote in a term inside the title attribute', async () => {
  // The title is built from a keyword term, which the model reads off the
  // posting: a quote in it must not close the attribute (audit 2026-09-10).
  const { highlightHtml } = await matcher;
  const html = highlightHtml('redis', [{ start: 0, end: 5, cls: 'x', title: 'a" onmouseover="alert(1)' }]);
  assert.equal(html, '<mark class="x" title="a&quot; onmouseover=&quot;alert(1)">redis</mark>');
  assert.doesNotMatch(html, /onmouseover="alert/);
});

test('target-page module imports without a DOM and exposes init', async () => {
  // The page wiring must keep every document/localStorage touch inside init(),
  // or serving it to node:test (and to the browser before DOMContentLoaded) breaks.
  // @ts-expect-error — plain JS with no declaration file.
  const page = (await import('./public/target-page.mjs')) as { init: unknown };
  assert.equal(typeof page.init, 'function');
});

test('the ring\'s live tone agrees with the server\'s fitTone at every cut-off', async () => {
  // The ring is drawn by the server at the stored score and then repainted by
  // target-page.mjs on every edit. Two implementations of the same four steps:
  // if they drift, the colour changes under the user when an analysis lands on
  // a number the live count already showed.
  // @ts-expect-error — plain JS with no declaration file.
  const { ringTone } = (await import('./public/target-page.mjs')) as {
    ringTone: (score: number) => string;
  };
  for (const score of [0, 1, 49, 50, 51, 69, 70, 71, 84, 85, 86, 99, 100]) {
    assert.equal(ringTone(score), fitTone(score), `score ${score}`);
  }
});

test('the gap chips are the weighted terms the text does not spell', async () => {
  // The chips answer "what is between me and a higher score". A word the text
  // carries is earned whatever the last analysis called it (ADR 0045); the
  // row once kept a typed cannot_claim term, and offered a "yes" for it.
  // @ts-expect-error — plain JS with no declaration file.
  const { keywordGaps } = (await import('./public/target-page.mjs')) as {
    keywordGaps: (rows: { term: string; weight: number; found: boolean; status: string }[]) => { term: string }[];
  };
  const rows = [
    { term: 'WordPress', weight: 3, found: false, status: 'cannot_claim' },
    { term: 'SASS', weight: 3, found: true, status: 'cannot_claim' },
    { term: 'Ajax', weight: 3, found: false, status: 'add' },
    { term: 'PHP', weight: 3, found: true, status: 'present' },
    { term: 'JIRA', weight: 0, found: false, status: 'present' },
  ];
  assert.deepEqual(
    keywordGaps(rows).map((r) => r.term),
    // SASS is in the text, PHP is earned, JIRA is context.
    ['WordPress', 'Ajax'],
  );
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

/* ---------- §5: visual weight and the frequency tiebreaker ---------- */

const RANKS: [Record<string, unknown>, number][] = [
  [{ requirement: 'must', primary: true }, 4],
  [{ requirement: 'must', primary: false }, 3],
  [{ requirement: 'preferred', primary: true }, 2], // primary only counts on a must (score.ts v3)
  [{ requirement: 'preferred' }, 2],
  [{ requirement: 'nice' }, 1],
  [{ requirement: 'context' }, 0],
  [{ priority: 1 }, 3], // pre-ADR-0012 rows fall back to the priority weights
  [{ priority: 4 }, 1],
];

test('keywordRank grades how hard the posting asks', async () => {
  const { keywordRank } = await matcher;
  for (const [k, rank] of RANKS) {
    assert.equal(keywordRank(k), rank, JSON.stringify(k));
  }
});

const POSTING = 'Kafka, Kafka, Kafka and Kafka. Also Docker, Docker and Terraform, plus Helm.';

test('orderKeywords sorts by weight first and by posting frequency within a level', async () => {
  const { orderKeywords } = await matcher;
  const rows = orderKeywords(
    [
      { term: 'Helm', priority: 3, requirement: 'nice', primary: false, aliases: [] },
      { term: 'Docker', priority: 2, requirement: 'must', primary: false, aliases: [] },
      { term: 'Terraform', priority: 2, requirement: 'must', primary: false, aliases: [] },
      { term: 'Kafka', priority: 1, requirement: 'must', primary: true, aliases: [] },
    ],
    POSTING,
  );
  assert.deepEqual(
    rows.map((r) => [r.term, r.count]),
    [
      ['Kafka', 4], // primary must outranks every plain must
      ['Docker', 2], // same level as Terraform, said twice as often
      ['Terraform', 1],
      ['Helm', 1],
    ],
  );
});

test('orderKeywords breaks a full tie by priority, then alphabetically — never by input order', async () => {
  const { orderKeywords } = await matcher;
  const same = (term: string, priority: number) => ({ term, priority, requirement: 'nice', primary: false, aliases: [] });
  const rows = orderKeywords([same('Zulu', 3), same('Alpha', 3), same('Bravo', 2)], 'nothing here');
  assert.deepEqual(rows.map((r) => r.term), ['Bravo', 'Alpha', 'Zulu']);
});

test('orderKeywords counts aliases and plurals as the same term', async () => {
  const { orderKeywords } = await matcher;
  const [row] = orderKeywords(
    [{ term: 'Kubernetes', priority: 1, requirement: 'must', primary: false, aliases: ['k8s'] }],
    'We run Kubernetes; the k8s clusters are ours.',
  );
  assert.equal(row?.count, 2);
});

test('jobSpans carries the level class and says how often the posting repeats a term', async () => {
  const { jobSpans, scoreKeywords } = await matcher;
  const keywords = [
    { term: 'Kafka', priority: 1, requirement: 'must', primary: true, status: 'add', aliases: [] },
    { term: 'Helm', priority: 3, requirement: 'nice', primary: false, status: 'add', aliases: [] },
  ];
  const spans = jobSpans(keywords, POSTING, scoreKeywords(keywords, 'a resume with neither'));
  const kafka = spans.filter((s) => s.cls === 'kw-gap kw-must kw-core');
  const helm = spans.filter((s) => s.cls === 'kw-gap kw-nice');
  assert.equal(kafka.length, 4, 'every occurrence is marked as a primary-stack must');
  assert.equal(helm.length, 1);
  assert.equal(kafka[0]?.title, 'Kafka · must · primary stack · not written — your resume evidences it, add the word · ×4 in the posting');
  assert.equal(helm[0]?.title, 'Helm · nice · not written — your resume evidences it, add the word', 'a single mention says nothing extra');
});
