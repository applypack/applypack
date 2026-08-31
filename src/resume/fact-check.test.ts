import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeAllowEntry, factCheck, normalizeText, TITLE_NOUNS } from './fact-check';
import type { FactLike } from './facts';

/*
 * Fixtures marked REAL are verbatim from our own database (Resume rows 1 and
 * 2, read 2026-08-31) — they are the regression that matters: the gate must
 * never block the letter Nazar actually sent against the resume he actually
 * has.
 */

/** REAL — excerpt of Resume id=1, the numbers and shapes measured for ADR 0020. */
const REAL_RESUME = `Nazar Boyko
Senior Software Engineer
Austin, Texas, 78758 ∙ boyko.nazar@gmail.com ∙ +1 (612) 267-5544 ∙ linkedin.com/in/nazar-boyko

Senior full-stack engineer (10+ years) shipping production Laravel/React systems end-to-end. Led platforms supporting $10M+ ARR with 99.9% uptime.

V Shred | Austin, Texas, US ∙ Remote
Senior Software Engineer | Dec. 2024 – Present
- Combined Snyk/Dependabot with Claude AI to detect vulnerabilities, reducing risks by 40%+.
- Engineered a centralized, multi-gateway payment error-handling platform (Braintree, Adyen), increasing successful transactions by 15–20%.
- Built and deployed a cross-platform notification system that boosted mobile DAU by 200%.
Technology Stack: PHP, Laravel, Phalcon, Typescript, React, Cypress, MySQL, S3, EC2, RDS.

Vodwork (Aylo project) | Hopkins, Minnesota, US ∙ Remote
Senior Full-Stack Engineer | Jan. 2021 – Dec. 2024
- Reduced the complexity of the system, cutting costs by hundreds of thousands of dollars annually.
- Integrated Windsurf (Opus 4.6) and Claude App, reducing development time by 30 - 40%.
- Decreased the data logs storing algorithm (space complexity) from O(N2log2N) to O(N).

PROBEGIN B.V. | Lelystad, Netherlands ∙ Hybrid
Senior PHP Engineer / Team Lead | Sep. 2019 – Jan. 2021
- Led a high-load CRM using PostgreSQL, Lumen and Vue.js, achieving a 40% reduction in response time.
- Guided and mentored four developers, fostering growth and collaborative teamwork.

OGD Solutions | Lviv, Ukraine ∙ On-site
Senior Laravel Developer | Sep. 2018 – Sep. 2019
- Processed data from a global survey of nearly 200 million registered users.
- Divided a substantial database into three parts for different clients.`;

/** REAL — Resume id=2 verbatim: a cover letter Nazar actually sent. */
const REAL_LETTER = `Hi HS GovTech Team,
I’m excited to apply for the Full Stack Developer position. I’ve spent the past several years
building and maintaining large-scale SaaS and data-driven platforms, mainly with PHP,
TypeScript, and React, and I really enjoy turning complex systems into clean, reliable, and
user-friendly solutions.
What I like about HS GovTech is your mission - helping government agencies modernize their
workflows and deliver better public services. I’d love to contribute to that by bringing my
experience in scalable backend design, API development, and modern front-end work to your
team.
Thank you for considering my application - I’d be happy to chat anytime.
Best,
Nazar Boyko
Senior Software Engineer
www.nazarboyko.com
+1 (612) 267 5544
boyko.nazar@gmail.com`;

/** Purpose-built pair for the acceptance criterion: the source has no 40%. */
const FIXTURE_RESUME = `Dana Reyes
Backend Engineer
- Cut checkout latency by 25% by reworking the pricing cache at Northwind Freight.
- Migrated 16,181 legacy invoices to the new billing service with zero downtime.
- Mentored four engineers through the platform rewrite.`;

const LETTER_WITH_INVENTED = `Dear team,
I reworked the pricing cache and cut checkout latency by 40%.
I also migrated 16,181 legacy invoices with zero downtime.`;

const LETTER_WITHOUT_NUMBER = `Dear team,
I reworked the pricing cache and cut checkout latency substantially.
I also migrated 16,181 legacy invoices with zero downtime.`;

const FACTS: FactLike[] = [
  { term: 'nginx', status: 'confirmed', note: null },
  { term: 'stripe', status: 'confirmed', note: null },
  { term: 'varnish', status: 'denied', note: null },
  { term: 'fastly cdn', status: 'denied', note: null },
];

const check = (text: string, sources: string[], extra: Record<string, unknown> = {}) =>
  factCheck({ text, sources, ...extra });

// ------------------------------------------------------------- normalization

test('folds the three non-ASCII characters our resumes actually contain', () => {
  // Measured: NFKC leaves all three alone, so they need explicit folding.
  assert.equal(normalizeText('15–20%'), '15-20%');
  assert.equal(normalizeText('I’m'), "I'm");
  assert.equal(normalizeText('Austin ∙ Texas'), 'Austin ; Texas');
  assert.equal(normalizeText('a   b\nc'), 'a b\nc');
});

test('NFKC still handles what it is good at', () => {
  assert.equal(normalizeText('２M'), '2M');
  assert.equal(normalizeText('16 181'), '16 181');
});

test('block boundaries stop two bullets gluing into one phantom claim', () => {
  // "…by 30\n- Rebuilt 12 pipelines" must not read as a 30-12 range.
  const r = check('- Improved throughput by 30\n- Rebuilt 12 pipelines', ['Improved throughput by 30. Rebuilt 12 pipelines.']);
  assert.equal(r.verdict, 'pass');
});

test('separator variants canonicalize to the same claim', () => {
  for (const written of ['16,181', '16 181', '16181', '16 181']) {
    const r = check(`Migrated ${written} invoices.`, ['Migrated 16181 invoices.']);
    assert.equal(r.verdict, 'pass', written);
  }
});

test('a phone number is not a claim, and yields no ghost thousands', () => {
  // The only separator-shaped match in our corpus is "267 554" inside a phone.
  const r = check('Reach me at +1 (612) 267-5544 or +1 (612) 267 5544.', ['no numbers here']);
  assert.equal(r.verdict, 'pass');
  assert.deepEqual(r.claims, []);
});

test('years, tool versions and big-O are not quantities', () => {
  const r = check(
    'From 2019 to 2022 I shipped PHP 7 and Vue.js 2 on EC2, cutting O(N2log2N) to O(N).',
    ['nothing quantitative at all'],
  );
  assert.equal(r.verdict, 'pass');
});

test('spelled-out numerals match their digits', () => {
  // 7 occurrences in our corpus, versus 0 thousands separators.
  assert.equal(check('I mentored 4 developers.', ['Guided and mentored four developers.']).verdict, 'pass');
  assert.equal(check('Guided three teams.', ['Guided 3 teams.']).verdict, 'pass');
});

test('an article-like "one" is not a count claim', () => {
  // "split one database into three parts" false-blocked until this was fixed.
  assert.equal(check('I split one database into three parts.', [FIXTURE_RESUME + '\nSplit that database into three parts.']).verdict, 'pass');
  assert.equal(check('I led one of the platform teams.', [FIXTURE_RESUME]).verdict, 'pass');
});

test('a captured employer run keeps no dangling connector', () => {
  // "at PROBEGIN and drove" captured "PROBEGIN and" and blocked a true claim.
  const r = check('I mentored four engineers at Northwind Freight and drove the rewrite.', [FIXTURE_RESUME]);
  assert.equal(r.verdict, 'pass', r.reasons.join(' | '));
  assert.ok(r.claims.some((c) => c.kind === 'employer' && c.text === 'Northwind Freight'));
  // "At OGD Solutions I processed …" captured "OGD Solutions I" and blocked.
  const pronoun = check('At Northwind Freight I rebuilt the pricing cache.', [FIXTURE_RESUME]);
  assert.equal(pronoun.verdict, 'pass', pronoun.reasons.join(' | '));
});

test('magnitude suffixes and words resolve to the same value', () => {
  assert.equal(check('Served 2M requests a day.', ['Served 2 million requests a day.']).verdict, 'pass');
  assert.equal(check('Retired 40,000 lines.', ['Retired 40k LOC.']).verdict, 'pass');
});

// ----------------------------------------------------------------- verdicts

test('an invented metric blocks', () => {
  const r = check(LETTER_WITH_INVENTED, [FIXTURE_RESUME]);
  assert.equal(r.verdict, 'block');
  assert.ok(r.reasons.some((x) => x.includes('40%')), r.reasons.join(' | '));
});

test('the same letter without the number passes', () => {
  assert.equal(check(LETTER_WITHOUT_NUMBER, [FIXTURE_RESUME]).verdict, 'pass');
});

test('a supported metric passes', () => {
  assert.equal(check('I cut checkout latency by 25%.', [FIXTURE_RESUME]).verdict, 'pass');
});

test('an employer absent from the resume blocks', () => {
  const r = check('I led the payments platform at Northwind Freight.', [FIXTURE_RESUME]);
  assert.equal(r.verdict, 'pass');
  const bad = check('I led the payments platform at Stripe Financial.', [FIXTURE_RESUME]);
  assert.equal(bad.verdict, 'block');
  assert.ok(bad.reasons.some((x) => x.includes('Stripe Financial')), bad.reasons.join(' | '));
});

test('a title never held blocks, a real one passes', () => {
  assert.equal(check('I worked as a Backend Engineer.', [FIXTURE_RESUME]).verdict, 'pass');
  assert.equal(check('I worked as a Principal Architect.', [FIXTURE_RESUME]).verdict, 'block');
});

test('TITLE_NOUNS is what makes an "as a …" span a claim', () => {
  assert.ok(TITLE_NOUNS.includes('engineer'));
  // "as a result" carries no role noun and must not be read as a claim.
  assert.equal(check('As a result, deploys got faster.', [FIXTURE_RESUME]).verdict, 'pass');
});

test('a sentence-initial trigger is still a history claim', () => {
  // /i on the whole regex would have relaxed [A-Z] too, making every lowercase
  // word after "at" read as a company.
  assert.equal(check('At Stripe Financial I led delivery.', [FIXTURE_RESUME]).verdict, 'block');
  assert.equal(check('As a Principal Architect I owned the rewrite.', [FIXTURE_RESUME]).verdict, 'block');
  assert.equal(check('I tuned the cache for the edge tier.', [FIXTURE_RESUME]).verdict, 'pass');
});

test('a paraphrased title is supported word by word', () => {
  const sources = ['Senior Backend PHP Engineer at Northwind Freight.'];
  assert.equal(check('I worked as a senior backend engineer.', sources).verdict, 'pass');
  // A company name is an identity, so it still has to match as one unit.
  assert.equal(check('I worked at Northwind Airlines.', sources).verdict, 'block');
});

test('REAL letter against REAL resume does not block', () => {
  const r = factCheck({ text: REAL_LETTER, sources: [REAL_RESUME], addressee: 'HS GovTech', facts: FACTS });
  assert.equal(r.verdict, 'pass', r.reasons.join(' | '));
});

test('the addressee is not a claim about the past', () => {
  const named = factCheck({ text: 'I want to build this at HS GovTech.', sources: [FIXTURE_RESUME], addressee: 'HS GovTech' });
  assert.equal(named.verdict, 'pass');
  const unnamed = factCheck({ text: 'I want to build this at HS GovTech.', sources: [FIXTURE_RESUME] });
  assert.equal(unnamed.verdict, 'block');
});

// -------------------------------------------------------------------- facts

test('a denied fact term blocks even though nothing else is wrong', () => {
  const r = factCheck({ text: 'I tuned Varnish for the edge tier.', sources: [FIXTURE_RESUME], facts: FACTS });
  assert.equal(r.verdict, 'block');
  assert.ok(r.reasons.some((x) => x.includes('cannot claim')), r.reasons.join(' | '));
});

test('resume text outranks a stale denial, exactly as applyFacts does', () => {
  const r = factCheck({ text: 'I tuned Varnish for the edge tier.', sources: ['Ran Varnish in front of the API.'], facts: FACTS });
  assert.equal(r.verdict, 'pass');
});

test('a confirmed fact supports a tool the resume never spells out', () => {
  const r = factCheck({ text: 'I wired up Stripe billing.', sources: [FIXTURE_RESUME], facts: FACTS });
  assert.equal(r.verdict, 'pass');
  assert.ok(r.claims.some((c) => c.kind === 'tool' && c.from === 'fact'));
});

test('a fact term with regex metacharacters is matched literally', () => {
  const facts: FactLike[] = [{ term: 'c++', status: 'denied', note: null }];
  assert.equal(factCheck({ text: 'I write C++ daily.', sources: [FIXTURE_RESUME], facts }).verdict, 'block');
  assert.equal(factCheck({ text: 'I write Go daily.', sources: [FIXTURE_RESUME], facts }).verdict, 'pass');
});

// ------------------------------------------------- deliberate non-strictness

test('"10 years" against a resume saying "10+ years" is not a fabrication', () => {
  assert.equal(check('I have 10 years of experience.', [REAL_RESUME]).verdict, 'pass');
});

test('a unitless source figure supports a unit, but two different units do not', () => {
  assert.equal(check('It now takes 4 minutes.', ['cut invoice generation from 40 min to 4']).verdict, 'pass');
  assert.equal(check('I made it 40% faster.', ['cut invoice generation from 40 min to 4']).verdict, 'block');
});

test('a vague magnitude cannot be sharpened into a figure', () => {
  assert.equal(check('Saved hundreds of thousands of dollars.', [REAL_RESUME]).verdict, 'pass');
  assert.equal(check('Saved $400,000 a year.', [REAL_RESUME]).verdict, 'block');
});

// ---------------------------------------------------------------- allowlist

test('an allowlisted metric passes and is labelled as allowed', () => {
  const r = factCheck({ text: LETTER_WITH_INVENTED, sources: [FIXTURE_RESUME], allowMetrics: ['40%'] });
  assert.equal(r.verdict, 'pass');
  assert.ok(r.claims.some((c) => c.status === 'allowed' && c.from === 'allowlist'));
});

test('an allowlist entry written in another surface form still matches', () => {
  // The bug class the gate exists to catch: an entry that never matches.
  for (const entry of ['40 percent', '40%', 'improved conversion by 40%']) {
    const r = factCheck({ text: LETTER_WITH_INVENTED, sources: [FIXTURE_RESUME], allowMetrics: [entry] });
    assert.equal(r.verdict, 'pass', entry);
  }
});

test('an inert allowlist entry is reported, not silently ignored', () => {
  assert.equal(canonicalizeAllowEntry('40%'), 'pct:40');
  assert.equal(canonicalizeAllowEntry('Acme Corp'), 'acme corp');
  assert.equal(canonicalizeAllowEntry('   '), null);
  const r = factCheck({ text: LETTER_WITHOUT_NUMBER, sources: [FIXTURE_RESUME], allowMetrics: ['  '] });
  assert.deepEqual(r.inertAllowlist, ['  ']);
  assert.ok(r.reasons.some((x) => x.includes('can never match')));
  // An allowMetrics entry with no number canonicalizes to a term and looks
  // valid, but nothing in the metric path will ever consult it.
  const noNumber = factCheck({ text: LETTER_WITHOUT_NUMBER, sources: [FIXTURE_RESUME], allowMetrics: ['Acme Corp'] });
  assert.deepEqual(noNumber.inertAllowlist, ['Acme Corp']);
});

test('an allowlisted employer passes', () => {
  const r = factCheck({ text: 'I led delivery at Stripe Financial.', sources: [FIXTURE_RESUME], allowFacts: ['Stripe Financial'] });
  assert.equal(r.verdict, 'pass');
});

// ----------------------------------------------------------------- coverage

test('unreadable count claims downgrade pass to warn, never a silent pass', () => {
  const r = check('Я скоротив час обробки на 30 хвилин і навчив 4 інженерів.', [FIXTURE_RESUME]);
  assert.equal(r.verdict, 'warn');
  assert.equal(r.unchecked, 2);
  assert.ok(r.reasons.some((x) => x.includes('could not be checked')), r.reasons.join(' | '));
});

test('percent survives outside Latin script, so an invented one still blocks', () => {
  const r = check('Я скоротив затримку оформлення на 40%.', [FIXTURE_RESUME]);
  assert.equal(r.verdict, 'block');
});

test('a supported percent in Ukrainian passes', () => {
  const r = check('Я скоротив затримку оформлення на 25%.', [FIXTURE_RESUME]);
  assert.equal(r.verdict, 'pass');
});

// -------------------------------------------------------------- performance

test('a full letter checks well inside the 50ms budget', () => {
  // F8 specifies 250-350 word letters; our largest stored resume is 6004 chars.
  const source = Array.from({ length: 4 }, () => REAL_RESUME).join('\n');
  const letter = Array.from({ length: 14 }, (_, i) =>
    `In my last role I cut latency by 25% and moved 16,181 invoices with zero downtime, mentoring four engineers along the way (${i}).`,
  ).join('\n');
  assert.ok(letter.split(/\s+/).length >= 250, 'fixture letter is letter-sized');
  assert.ok(source.length >= 6000, 'source is our largest-resume sized');

  const runs = 50;
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    factCheck({ text: letter, sources: [source], facts: FACTS, addressee: 'HS GovTech' });
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(runs / 2)] as number;
  assert.ok(median < 50, `median ${median.toFixed(2)}ms exceeds the 50ms budget`);
});

test('an employer followed by a pronoun contraction is still that employer', () => {
  const r = factCheck({
    text: "At V Shred I've built the billing pipeline, and at OGD Solutions We've processed payments.",
    sources: ['V Shred — Senior Engineer. OGD Solutions — Engineer.'],
  });
  assert.equal(r.verdict, 'pass');
  const canonicals = r.claims.filter((c) => c.kind === 'employer').map((c) => c.canonical);
  assert.deepEqual(canonicals.sort(), ['ogd solutions', 'v shred']);
  assert.ok(r.claims.every((c) => c.status === 'supported'));
});

test('a fabricated employer still blocks after the contraction trim', () => {
  const r = factCheck({
    text: "At Globex I've led the platform team.",
    sources: ['V Shred — Senior Engineer.'],
  });
  assert.equal(r.verdict, 'block');
  assert.equal(r.claims.find((c) => c.kind === 'employer')?.canonical, 'globex');
});
