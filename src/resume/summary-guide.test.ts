import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countSentences, findSummary, summaryGuide, type SummaryCheck, type SummaryGuideInput } from './summary-guide';
import { readKeywords, type MatchAction, type MatchKeyword, type PostingBrief } from './prompts';

/* The live case (match 28): a PHP resume against HealthStream's "Sr. PHP Developer", whose posting says "PHP and/or Java". */
const SUMMARY =
  'Senior full-stack engineer (10+ years) shipping production Laravel/Vue systems end-to-end. Operate as an\n' +
  'AI orchestrator, design harnessed workflows, validation gates, and agent services that ship features with judgment at the right checkpoints. Led platforms supporting $10M+ ARR with 99.9% uptime.';
const RESUME = [
  'Alex Example',
  'Senior Full-Stack Engineer',
  'Hopkins, Minnesota ∙ alex@example.com ∙ +1 (612) 555-0100',
  'PROFESSIONAL SUMMARY',
  SUMMARY,
  'KEY SKILLS',
  'Programming: PHP, Go, JavaScript, TypeScript, SQL',
  'Frameworks/Libraries: Laravel, Vue, React, Symfony',
].join('\n');

const keyword = (over: Partial<MatchKeyword> & { term: string }): MatchKeyword =>
  readKeywords([{ priority: 1, requirement: 'must', primary: false, status: 'present', aliases: [], ...over }])[0]!;

const KEYWORDS = [
  keyword({ term: 'PHP', primary: true, group: 'tech stack language', requirement: 'context' }),
  keyword({ term: 'Symfony', primary: true }),
  keyword({ term: 'Java', requirement: 'context', status: 'cannot_claim', group: 'tech stack language' }),
  keyword({ term: 'Sr. PHP Developer', priority: 2, status: 'ask_user', aliases: ['senior php developer', 'php developer'] }),
  keyword({ term: 'CI/CD' }),
  keyword({ term: 'relational databases' }),
  keyword({ term: 'healthcare', priority: 4, requirement: 'context', status: 'cannot_claim' }),
];

const BRIEF = {
  role: { posted_title: 'Sr. PHP Developer', years_min: 5 },
  screening: {
    reader: 'in-house HR/recruiter at an established enterprise',
    scan_for: ['PHP experience', 'Symfony experience', '5+ years as a Developer'],
  },
  requirement_groups: [],
} as unknown as PostingBrief;

async function input(over: Partial<SummaryGuideInput> = {}): Promise<SummaryGuideInput> {
  // @ts-expect-error — plain JS with no declaration file.
  const matcher = (await import('../web/public/target.mjs')) as SummaryGuideInput['matcher'];
  return { resumeText: RESUME, actions: [], keywords: KEYWORDS, brief: BRIEF, jobTitle: 'Sr. PHP Developer', matcher, ...over };
}

const byKey = (checks: SummaryCheck[]) => Object.fromEntries(checks.map((c) => [c.key, c]));

test('the live summary: what it has, what the reader still looks for', async () => {
  const guide = summaryGuide(await input());
  const c = byKey(guide.checks);
  assert.equal(guide.reader, 'in-house HR/recruiter at an established enterprise');
  assert.deepEqual(guide.scanFor, ['PHP experience', 'Symfony experience', '5+ years as a Developer']);
  assert.match(guide.summary ?? '', /^Senior full-stack engineer \(10\+ years\)/);

  assert.equal(c.role!.state, 'todo', 'opens "Senior full-stack engineer", not the posted role');
  assert.match(c.role!.detail, /“Sr\. PHP Developer”/);
  assert.equal(c.years!.state, 'ok');
  assert.equal(c.years!.detail, 'states “10+ years”; the posting asks 5+');
  // Laravel/Vue, but neither PHP nor Symfony by name.
  assert.equal(c.stack!.state, 'todo');
  assert.equal(c.stack!.detail, 'name PHP, Symfony');
  assert.equal(c.musts!.state, 'todo');
  assert.equal(c.musts!.detail, 'none named yet; yours to name: CI/CD, relational databases');
  assert.equal(c.proof!.state, 'ok');
  assert.equal(c.proof!.detail, '“$10M+ ARR”');
  assert.equal(c.length!.state, 'ok');
  assert.equal(c.length!.detail, '3 sentences, 40 words');
  assert.equal(c.voice!.state, 'ok');
  // The either/or the posting offered: Java is not owed, and naming it is a claim.
  assert.equal(c.avoid!.state, 'ok');
  assert.equal(c.avoid!.detail, 'leave out Java; the posting accepts PHP, which you have');
  assert.doesNotMatch(c.avoid!.detail, /healthcare/, 'a context domain is the domain notice’s, not this');
});

test('the suggested summary is held to the same list', async () => {
  const written =
    'Senior PHP Developer with 10+ years building Symfony and Laravel services on relational databases. ' +
    'Led payment platforms supporting $10M+ ARR at 99.9% uptime, shipped through CI/CD.';
  const rewrite: MatchAction = {
    section: 'summary',
    where: 'summary paragraph',
    what: 'Rewrite it.',
    why: 'summary graded partial',
    priority: 'high',
    quote: SUMMARY,
    replacement: written,
    insert_after: null,
  };
  const guide = summaryGuide(await input({ actions: [rewrite] }));
  assert.equal(guide.checks.filter((c) => c.state === 'ok').length, 5, 'the resume’s own summary is still what the checks read');
  assert.equal(guide.proposed, 8);
  // A refused wording has none to hold.
  assert.equal(summaryGuide(await input({ actions: [{ ...rewrite, replacement: null }] })).proposed, null);
});

test('a summary written to the list passes it, and naming the other half of an either/or is caught', async () => {
  const written =
    'Senior PHP Developer with 10+ years building Symfony and Laravel services on relational databases. ' +
    'Led payment platforms supporting $10M+ ARR at 99.9% uptime, shipped through CI/CD. ' +
    'Leads troubleshooting and solution design with minimal oversight.';
  const pass = byKey(summaryGuide(await input({ resumeText: RESUME.replace(SUMMARY, written) })).checks);
  for (const key of ['role', 'years', 'stack', 'musts', 'proof', 'length', 'voice', 'avoid']) {
    assert.equal(pass[key]!.state, 'ok', `${key}: ${pass[key]!.detail}`);
  }
  const claimed = byKey(summaryGuide(await input({ resumeText: RESUME.replace(SUMMARY, `${written} Fluent in PHP and Java.`) })).checks);
  assert.equal(claimed.avoid!.state, 'warn');
  assert.match(claimed.avoid!.detail, /^names Java/);
});

test('the either/or is read off the brief when the keywords label one side only', async () => {
  // The live row: Java carried the group label, PHP did not.
  const keywords = KEYWORDS.map((k) => (k.term === 'PHP' ? { ...k, group: null } : k));
  const brief = {
    ...BRIEF,
    requirement_groups: [{ label: 'tech stack language', level: 'context', satisfy: 'any', options: ['PHP', 'Java'] }],
  } as unknown as PostingBrief;
  assert.equal(byKey(summaryGuide(await input({ keywords, brief })).checks).avoid!.detail, 'leave out Java; the posting accepts PHP, which you have');
  // Without either source of the pairing, a context term is nobody's business here.
  assert.equal(byKey(summaryGuide(await input({ keywords })).checks).avoid, undefined);
});

test('length, voice and years each say what is off', async () => {
  const long = Array.from({ length: 6 }, (_, i) => `I am a passionate engineer number ${i + 1} who builds things.`).join(' ');
  const c = byKey(summaryGuide(await input({ resumeText: RESUME.replace(SUMMARY, `${long} 3 years of PHP.`) })).checks);
  assert.equal(c.length!.state, 'warn');
  assert.match(c.length!.detail, /^7 sentences, \d+ words: a long block gets skipped/);
  assert.equal(c.voice!.state, 'warn');
  assert.equal(c.voice!.detail, 'drop “I”, “passionate”');
  assert.equal(c.years!.state, 'warn', 'three years against a five-year floor');
  // I/O is not a pronoun, and a version number is not a result.
  const plain = byKey(summaryGuide(await input({ resumeText: RESUME.replace(SUMMARY, 'Backend engineer on PHP 8 and I/O-heavy services. Ships features.') })).checks);
  assert.equal(plain.voice!.state, 'ok');
  assert.equal(plain.proof!.state, 'todo');
});

test('no summary: found from the quote when there is no heading, else every check is open', async () => {
  const noHeading = RESUME.replace('PROFESSIONAL SUMMARY\n', '');
  const action: MatchAction = {
    section: 'summary',
    where: 'summary paragraph',
    what: 'Rewrite it.',
    why: 'summary graded partial',
    priority: 'high',
    quote: SUMMARY,
    replacement: null,
    insert_after: null,
  };
  assert.equal(findSummary(noHeading, [action]), SUMMARY);

  const none = summaryGuide(await input({ resumeText: RESUME.replace(`PROFESSIONAL SUMMARY\n${SUMMARY}\n`, '') }));
  assert.equal(none.summary, null);
  const c = byKey(none.checks);
  assert.equal(c.length!.state, 'todo');
  assert.match(c.length!.detail, /^no summary found/);
  assert.equal(c.years!.detail, 'the posting asks 5+; state yours as the resume does');
});

test('without a brief the role is the job title and nobody is named as the reader', async () => {
  const guide = summaryGuide(await input({ brief: null, keywords: KEYWORDS.filter((k) => k.priority !== 2) }));
  assert.equal(guide.reader, null);
  assert.deepEqual(guide.scanFor, []);
  assert.match(byKey(guide.checks).role!.detail, /“Sr\. PHP Developer”/);
  assert.equal(byKey(guide.checks).years!.detail, 'states “10+ years”');
});

test('an abbreviation or a decimal does not end a sentence', () => {
  assert.equal(countSentences('Sr. PHP Developer with 10+ years. Kept 99.9% uptime, e.g. on Node.js services.'), 2);
  assert.equal(countSentences(''), 0);
});

// #348: the list once said "name the role: Sr. PHP Developer" and, three lines down, "leave out Sr. PHP Developer".
test('the posting\'s own title is never among the terms to leave out', async () => {
  const titled = [
    keyword({ term: 'Sr. PHP Developer', priority: 2, requirement: 'must', status: 'cannot_claim' }),
    keyword({ term: 'Kafka', priority: 1, requirement: 'must', status: 'cannot_claim' }),
  ];
  const checks = byKey(summaryGuide(await input({ keywords: titled, brief: null })).checks);
  assert.equal(checks.avoid!.detail, 'leave out Kafka');
  assert.match(checks.role!.detail, /Sr\. PHP Developer/);
  // Written into the summary, the role is the role, not a claim the resume cannot back.
  const named = byKey(summaryGuide(await input({ keywords: titled, brief: null, resumeText: RESUME.replace(SUMMARY, `Sr. PHP Developer with eight years in fintech. ${SUMMARY}`) })).checks);
  assert.equal(named.avoid!.state, 'ok');
  // The title alone unbacked: nothing to leave out at all.
  assert.equal(byKey(summaryGuide(await input({ keywords: [titled[0]!], brief: null })).checks).avoid, undefined);
});
