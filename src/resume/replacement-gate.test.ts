import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateActions, gateRemovals, hasCheckNote, instructionIn, splitRefusal, type GateSources } from './replacement-gate';
import { readKeywords, readRemovals, type MatchAction, type MatchKeyword, type MatchRemoval } from './prompts';

const RESUME = [
  'Alex Example — Senior Backend Engineer',
  'Skills: PHP 8, Laravel, Docker, MySQL',
  '- Designed Laravel payment workflows processing $4M/month, cutting failed checkouts 18%.',
  '- Led migration of the monolith to services; release time fell from 2 weeks to 2 days.',
].join('\n');

const POSTING = 'Senior Backend Engineer (B2B SaaS)\nNode.js and TypeScript services for a fintech platform, East Coast hours.';

/** Through the schema, the way every keyword reaches the gate in production. */
const keyword = (over: Partial<MatchKeyword> & { term: string }): MatchKeyword =>
  readKeywords([{ priority: 1, requirement: 'must', primary: false, status: 'present', aliases: [], ...over }])[0]!;

const action = (over: Partial<MatchAction>): MatchAction => ({
  section: 'experience',
  where: 'first bullet',
  what: 'Reword it.',
  why: 'serves the posting',
  priority: 'high',
  quote: null,
  replacement: null,
  insert_after: null,
  ...over,
});

/** Through the schema, the way every removal reaches the gate in production. */
const removal = (over: Partial<MatchRemoval>): MatchRemoval =>
  readRemovals([{ section: 'skills', where: 'Skills line', what: 'Drop the noise.', why: 'reads cleaner', quote: null, ...over }])[0]!;

async function sources(over: Partial<GateSources> = {}): Promise<GateSources> {
  // The real browser matcher, loaded the way keyword-matcher.ts loads it.
  // @ts-expect-error — plain JS with no declaration file.
  const matcher = (await import('../web/public/target.mjs')) as GateSources['matcher'];
  return { resumeText: RESUME, posting: POSTING, facts: [], keywords: [], matcher, ...over };
}

test('an invented figure blocks; a figure the resume carries passes', async () => {
  const src = await sources();
  const invented = action({ quote: 'Led migration of the monolith to services', replacement: 'Led migration of the monolith to services, cutting infrastructure cost 40%.' });
  const real = action({ quote: 'Designed Laravel payment workflows', replacement: 'Owned Laravel payment workflows processing $4M/month.' });
  const out = gateActions([invented, real], src);
  assert.equal(out.blocked, 1);
  assert.equal(out.actions[0]!.replacement, null, 'the blocked wording is gone');
  assert.match(out.actions[0]!.why, /not applied — .*40%/);
  assert.equal(out.actions[1]!.replacement, 'Owned Laravel payment workflows processing $4M/month.');
  assert.equal(out.actions[1]!.why, 'serves the posting', 'a clean pass leaves why alone');
});

test('the posting is a source: its vocabulary is not an invented employer', async () => {
  const src = await sources();
  const out = gateActions(
    [action({ quote: 'Senior Backend Engineer', replacement: 'Senior Backend Engineer for B2B SaaS, available for East Coast hours' })],
    src,
  );
  assert.equal(out.blocked, 0, out.actions[0]!.why);
});

test('a replacement may not introduce a keyword the resume has no evidence for', async () => {
  const src = await sources({
    keywords: [keyword({ term: 'Node.js', status: 'cannot_claim', primary: true })],
  });
  const out = gateActions(
    [action({ quote: 'Led migration of the monolith to services', replacement: 'Led migration of the monolith to Node.js services.' })],
    src,
  );
  assert.equal(out.blocked, 1);
  assert.match(out.actions[0]!.why, /claims "Node\.js"/);
});

test('an unconfirmed keyword warns rather than blocks — the confirm flow comes first', async () => {
  const src = await sources({ keywords: [keyword({ term: 'Kubernetes', status: 'ask_user', requirement: 'preferred' })] });
  const out = gateActions(
    [action({ quote: 'Led migration of the monolith to services', replacement: 'Led migration of the monolith to services on Kubernetes.' })],
    src,
  );
  assert.equal(out.blocked, 0);
  assert.equal(out.warned, 1);
  assert.match(out.actions[0]!.why, /check: says "Kubernetes"/);
  assert.equal(out.actions[0]!.replacement, 'Led migration of the monolith to services on Kubernetes.');
});

test('KEEP WANTED KEYWORDS: losing a must-have blocks, losing a nice-to-have warns', async () => {
  const src = await sources({
    keywords: [
      keyword({ term: 'Docker', requirement: 'must' }),
      keyword({ term: 'MySQL', requirement: 'nice', priority: 3 }),
    ],
  });
  const out = gateActions(
    [
      action({ quote: 'Skills: PHP 8, Laravel, Docker, MySQL', replacement: 'Skills: PHP 8, Laravel, MySQL' }),
      action({ quote: 'Skills: PHP 8, Laravel, Docker, MySQL', replacement: 'Skills: PHP 8, Laravel, Docker' }),
    ],
    src,
  );
  assert.equal(out.blocked, 1);
  assert.equal(out.warned, 1);
  assert.equal(out.actions[0]!.replacement, null);
  assert.match(out.actions[0]!.why, /drops "Docker", a must-have/);
  assert.equal(out.actions[1]!.replacement, 'Skills: PHP 8, Laravel, Docker');
  assert.match(out.actions[1]!.why, /check: drops "MySQL"/);
});

test('a pre-ADR-0012 keyword with no level reads as preferred, so losing it warns', async () => {
  // The schema defaults a missing level to "preferred" whatever the priority;
  // the gate never sees an undefined level, and a lost preferred term is a note.
  const src = await sources({ keywords: [keyword({ term: 'Docker', requirement: undefined, priority: 1 })] });
  const out = gateActions([action({ quote: 'Skills: PHP 8, Laravel, Docker, MySQL', replacement: 'Skills: PHP 8, Laravel, MySQL' })], src);
  assert.equal(out.blocked, 0);
  assert.equal(out.warned, 1);
});

test('an addition replaces nothing, so it cannot lose a keyword', async () => {
  const src = await sources({ keywords: [keyword({ term: 'Docker', requirement: 'must' })] });
  const out = gateActions(
    [action({ quote: null, insert_after: 'Skills: PHP 8, Laravel, Docker, MySQL', replacement: 'Ran the Laravel services in Docker on MySQL.' })],
    src,
  );
  assert.equal(out.blocked, 0);
  assert.equal(out.warned, 0);
});

test('actions without a replacement pass through untouched, and the wording is plain-punctuated', async () => {
  const src = await sources();
  const bare = action({ what: 'Cut to four bullets.' });
  const curly = action({ quote: 'Senior Backend Engineer', replacement: 'Senior Backend Engineer — “payments”' });
  const out = gateActions([bare, curly], src);
  assert.deepEqual(out.actions[0], bare);
  assert.equal(out.actions[1]!.replacement, 'Senior Backend Engineer - "payments"');
});

test('a removal quote covering a wanted keyword loses its quote, keeps its advice', async () => {
  // The live failure (match 13): the model advised dropping three of six
  // frameworks and quoted the whole line, React and Vue.js inside it.
  const src = await sources({
    resumeText: 'Skills: Symfony, React, Vue, Laravel, Lumen, Phalcon',
    keywords: [
      keyword({ term: 'React', requirement: 'must', primary: true }),
      keyword({ term: 'Vue.js', requirement: 'must', aliases: ['Vue'] }),
    ],
  });
  const out = gateRemovals([removal({ quote: 'Symfony, React, Vue, Laravel, Lumen, Phalcon' })], src);
  assert.equal(out.blocked, 1);
  assert.equal(out.removals[0]!.quote, null, 'nothing is struck through or deletable in one press');
  assert.match(out.removals[0]!.why, /not applied — .*"React"/);
  assert.match(out.removals[0]!.what, /Drop the noise/, 'the advice survives');
});

test('a removal quote covering a lighter wanted keyword warns but stays applicable', async () => {
  const src = await sources({
    resumeText: 'Skills: Symfony, Phalcon, Memcached',
    keywords: [keyword({ term: 'Memcached', requirement: 'nice' })],
  });
  const out = gateRemovals([removal({ quote: 'Symfony, Phalcon, Memcached' })], src);
  assert.equal(out.blocked, 0);
  assert.equal(out.warned, 1);
  assert.equal(out.removals[0]!.quote, 'Symfony, Phalcon, Memcached');
  assert.match(out.removals[0]!.why, /check: .*"Memcached"/);
});

const AI_LINE = 'OpenAI, Claude, AWS Bedrock, Prompt Engineering, RAG, Vector Search, AI Agents, LLM Integrations, Cursor, Windsurf, AI Security & Code Analysis';

test('a removal may not take the whole line that shows a must-have it never spells (#350)', async () => {
  // The live case: "AI tooling" (must, to add) is shown by the AI line; the report cut that line whole,
  // and Apply all then wrote the term onto "Blade, Twig, Jira, …" with nothing behind it.
  const tooling = keyword({ term: 'AI tooling', status: 'add', where: 'Key Skills AI/LLM Automation section; eleven tools named' });
  for (const line of [`AI / LLM Automation: ${AI_LINE}`, `AI / LLM Automation | ${AI_LINE}`]) {
    const src = await sources({ resumeText: ['Key Skills', line, 'Others: Blade, Twig, Jira, ORM'].join('\n'), keywords: [tooling] });
    const out = gateRemovals([removal({ where: 'Key Skills, AI / LLM Automation line', quote: AI_LINE })], src);
    assert.equal(out.blocked, 1, line);
    assert.equal(out.removals[0]!.quote, null);
    assert.match(out.removals[0]!.why, /not applied — this line is what shows "AI tooling", a must-have/);
    assert.match(out.removals[0]!.what, /Drop the noise/, 'the advice survives');
  }
});

test('the live comparison: a PDF skills table has no label on the line, and the removal names it', async () => {
  // Resume 1 as its PDF reads: the labels in one stack, the value lines in another.
  const resumeText = [
    'Laravel, Symfony, React, Vue, Node, Lumen, Phalcon, Zend Framework 2',
    'MySQL, PostgreSQL, MongoDB, DynamoDB, SQL Server, Redis, Memcached',
    AI_LINE,
    'MVC, MVVM, HMVC, Microservices, EDA, SOA, DDD, Lucid',
  ].join('\n');
  const src = await sources({
    resumeText,
    keywords: [keyword({ term: 'AI tooling', status: 'add', where: 'Key Skills AI/LLM Automation section; V Shred and Vodwork bullets (Cursor, Windsurf, Claude)' })],
  });
  const cut = removal({ where: 'Key Skills, AI / LLM Automation line', quote: AI_LINE, why: "line is dense and duplicative; posting only needs 'AI tooling' evidenced" });
  const out = gateRemovals([cut], src);
  assert.equal(out.blocked, 1);
  assert.equal(out.removals[0]!.quote, null);
  assert.match(out.removals[0]!.why, /not applied — this line is what shows "AI tooling"/);
  // Another line of the same table is nobody's evidence.
  const other = gateRemovals([removal({ where: 'Key Skills, Architecture line', quote: 'MVC, MVVM, HMVC, Microservices, EDA, SOA, DDD, Lucid' })], src);
  assert.equal(other.blocked + other.warned, 0);
});

test('a bullet is not a named line: only what it spells protects it', async () => {
  const bullet = 'Decreased the data logs storing algorithm from quadratic to linear.';
  const src = await sources({
    resumeText: ['Vodwork', `- ${bullet}`].join('\n'),
    keywords: [keyword({ term: 'AI tooling', status: 'add', where: 'V Shred and Vodwork bullets (Cursor, Windsurf, Claude)' })],
  });
  const out = gateRemovals([removal({ section: 'experience', where: 'Vodwork bullet', quote: bullet })], src);
  assert.equal(out.blocked + out.warned, 0);
  assert.equal(out.removals[0]!.quote, bullet);
});

test('part of that line may still go: what is left shows what the line showed', async () => {
  const src = await sources({
    resumeText: `AI / LLM Automation: ${AI_LINE}`,
    keywords: [keyword({ term: 'AI tooling', status: 'add', where: 'Key Skills AI/LLM Automation section' })],
  });
  const out = gateRemovals([removal({ quote: 'Cursor, Windsurf' })], src);
  assert.equal(out.blocked, 0);
  assert.equal(out.warned, 0);
  assert.equal(out.removals[0]!.quote, 'Cursor, Windsurf');
});

test('a whole line nobody points at, or one that shows a lighter term, is not held', async () => {
  const text = ['Legacy: Phalcon, Zend Framework 2, Bower', `AI / LLM Automation: ${AI_LINE}`].join('\n');
  const elsewhere = await sources({
    resumeText: text,
    keywords: [keyword({ term: 'AI tooling', status: 'add', where: 'Key Skills AI/LLM Automation section' })],
  });
  const legacy = gateRemovals([removal({ quote: 'Phalcon, Zend Framework 2, Bower' })], elsewhere);
  assert.equal(legacy.blocked + legacy.warned, 0);
  assert.equal(legacy.removals[0]!.quote, 'Phalcon, Zend Framework 2, Bower');

  const lighter = await sources({
    resumeText: text,
    keywords: [keyword({ term: 'AI tooling', status: 'add', requirement: 'nice', where: 'AI / LLM Automation line' })],
  });
  const warned = gateRemovals([removal({ quote: AI_LINE })], lighter);
  assert.equal(warned.blocked, 0);
  assert.equal(warned.warned, 1);
  assert.match(warned.removals[0]!.why, /check: this line is what shows "AI tooling", which this posting asks for/);
});

test('a label too short to mean anything holds nothing', async () => {
  const src = await sources({
    resumeText: 'CI: Jenkins, CircleCI, Travis',
    keywords: [keyword({ term: 'Deployment automation', status: 'add', where: 'CI/CD pipelines across roles' })],
  });
  assert.equal(gateRemovals([removal({ quote: 'Jenkins, CircleCI, Travis' })], src).blocked, 0);
});

test('a removal quote reaching the contact line is blocked whatever it aimed at', async () => {
  const src = await sources({ keywords: [] });
  const out = gateRemovals(
    [removal({ section: 'format', quote: 'Austin, TX 78701 · alex@example.com · +1 512 555 0134' })],
    src,
  );
  assert.equal(out.blocked, 1);
  assert.equal(out.removals[0]!.quote, null);
  assert.match(out.removals[0]!.why, /keep the email and phone/);
});

test('a removal of genuine noise passes untouched', async () => {
  const src = await sources({ keywords: [keyword({ term: 'React', requirement: 'must', primary: true })] });
  const clean = removal({ section: 'summary', quote: 'References available on request', what: 'Delete it.' });
  const out = gateRemovals([clean, removal({ quote: null })], src);
  assert.equal(out.blocked, 0);
  assert.equal(out.warned, 0);
  assert.deepEqual(out.removals, [clean, removal({ quote: null })]);
});

test('a keyword the resume still carries elsewhere is not lost, so the rewrite stands', async () => {
  // The live case: the bullet's only "SQL" was the phrase "SQL injection", and
  // the skills line carries SQL too — blocking the rewrite protected nothing.
  const src = await sources({
    resumeText: ['Skills: PHP, SQL, PGSQL', '- Combined Snyk with static analysis to prevent SQL injection.'].join('\n'),
    keywords: [keyword({ term: 'SQL', requirement: 'must', primary: true })],
  });
  const out = gateActions(
    [action({ quote: 'Combined Snyk with static analysis to prevent SQL injection.', replacement: 'Hardened the checkout flow against injection and input-handling flaws.' })],
    src,
  );
  assert.equal(out.blocked, 0);
  assert.equal(out.warned, 1);
  assert.match(out.actions[0]!.why, /the resume still has it elsewhere/);
  assert.equal(out.actions[0]!.replacement, 'Hardened the checkout flow against injection and input-handling flaws.');
});

test('the last occurrence of a must-have still blocks', async () => {
  const src = await sources({
    resumeText: '- Built Laravel payment workflows on MySQL.',
    keywords: [keyword({ term: 'MySQL', requirement: 'must', primary: true })],
  });
  const out = gateActions(
    [action({ quote: 'Built Laravel payment workflows on MySQL.', replacement: 'Built Laravel payment workflows.' })],
    src,
  );
  assert.equal(out.blocked, 1);
  assert.match(out.actions[0]!.why, /drops "MySQL", a must-have/);
});

test('the posted title may be written on the headline and in the summary, nowhere else', async () => {
  const src = await sources({
    resumeText: 'Alex Example — Senior Backend Engineer',
    // Priority 2 is the posted job title (RULE_KEYWORDS); it is a label, not a skill.
    keywords: [keyword({ term: 'Web Developer', priority: 2, requirement: 'context', status: 'cannot_claim' })],
  });
  const retitle = { quote: 'Senior Backend Engineer', replacement: 'Web Developer — Full-Stack (PHP, Laravel)' };
  assert.equal(gateActions([action({ section: 'title', ...retitle })], src).blocked, 0);
  assert.equal(gateActions([action({ section: 'summary', ...retitle })], src).blocked, 0);
  const inABullet = gateActions([action({ section: 'experience', ...retitle })], src);
  assert.equal(inABullet.blocked, 1, 'claiming the title inside a role is a different thing');
  assert.match(inABullet.actions[0]!.why, /claims "Web Developer"/);
});

test('a refusal is read back off why, and only off a refused wording', async () => {
  const src = await sources({
    keywords: [keyword({ term: 'PHP' }), keyword({ term: 'Java', requirement: 'context', status: 'cannot_claim' })],
  });
  // The live case: the posting's "PHP and/or Java" mirrored into a PHP resume's summary.
  const [refused] = gateActions(
    [action({ section: 'summary', why: 'summary graded partial', quote: 'Senior Backend Engineer', replacement: 'Senior PHP/Java engineer building payment workflows.' })],
    src,
  ).actions;
  assert.deepEqual(splitRefusal(refused!), {
    why: 'summary graded partial',
    refusal: 'claims "Java", which this resume has no evidence for',
  });
  // A warning keeps its wording, so there is nothing to write again.
  const warned = action({ why: 'serves the posting · check: drops "SQL"', replacement: 'Kept wording.' });
  assert.deepEqual(splitRefusal(warned), { why: warned.why, refusal: null });
  // An instruction with no wording was never refused.
  assert.equal(splitRefusal(action({ why: 'reorder the bullets' })).refusal, null);
});

test('a note to the writer is not resume text: the four wordings stored on real comparisons', () => {
  for (const wording of [
    'Tracked and prioritized work using JIRA in Agile/Scrum sprints (ask the candidate to confirm which role used JIRA)',
    'Personal interest: active follower of crypto markets, investing, and personal finance trends (ask the candidate for the real detail)',
    'Ask the candidate: did any AWS work at V Shred or Vodwork use Lambda or a serverless design (vs. EC2/RDS)? If yes, add a bullet describing it.',
    'Architected an AI-powered RAG chat/voice support bot using vector search and LLM APIs, reducing support workload by 20% - ask the candidate whether Elasticsearch backed the vector store.',
    'Built and maintained Node.js services alongside the Laravel backend to support payment workflows, ask the candidate for the real scope/number.',
  ]) {
    assert.match(instructionIn(wording) ?? '', /ask the candidate/i, wording);
  }
});

test('a slot left to fill in, a placeholder figure and a question are notes too', () => {
  const notes: [string, string][] = [
    ['Cut checkout latency by [add your real number] with Redis caching.', '[add your real number]'],
    ['Reduced deploy time by XX% with GitHub Actions.', 'XX%'],
    ['Cut largest-contentful-paint from Xs to Ys on the storefront.', 'from Xs to Ys'],
    ['Grew revenue to $XXk a month.', '$XXk'],
    ['Led the migration to Kubernetes (confirm the cluster size).', '(confirm the cluster size)'],
    ['Owned the billing roadmap. TBD', 'TBD'],
    ['Owned the cloud bill. Did this role use Terraform? Name it here.', 'Did this role use Terraform?'],
    ['Shipped the payments API; if yes, add the volume it handled.', 'if yes, add'],
  ];
  for (const [wording, span] of notes) assert.equal(instructionIn(wording), span, wording);
});

test('resume text that only looks like a note passes', () => {
  for (const wording of [
    'Fixed N+1 queries across the Laravel API, cutting page load 40%.',
    'Built payments (check processing, ACH) for 12 regional banks.',
    'Wrote CRUD endpoints (insert, update, delete) for the orders API.',
    'Ran the KYC pipeline (verify, screen, onboard) for three banks.',
    'Shipped add-on billing (add to cart, upsell) for the storefront.',
    'Improved the candidate experience for a recruiting platform with 2M users.',
    'Asked to lead the user research guild after six months.',
    'Built a to-do app in React Native; 4.8 stars on the App Store.',
    'Ran X (Twitter) and LinkedIn campaigns for a Y Combinator startup.',
    'Senior Backend Engineer (PHP/Laravel) - Remote',
    'Maintained https://example.com/search?q=php for the docs team.',
  ]) {
    assert.equal(instructionIn(wording), null, wording);
  }
});

test("a span the quoted line already had is the candidate's own text", () => {
  const quote = 'Maintainer of [laravel-queues], a package with 3k stars.';
  assert.equal(instructionIn('Maintainer of [laravel-queues], a Laravel package with 3k stars.', quote), null);
  assert.equal(instructionIn('Maintainer of [laravel-queues] with [X] stars.', quote), '[X]');
  assert.equal(instructionIn('Why PHP? Because it ships.', 'Why PHP? It ships.'), null);
});

test('a wording of brackets and nothing else is read in a blink', () => {
  const started = Date.now();
  assert.equal(instructionIn('['.repeat(40_000) + '?x'.repeat(40_000)) === null, true);
  assert.ok(Date.now() - started < 500);
});

test('the gate refuses a note to the writer and says so first', async () => {
  const src = await sources();
  const out = gateActions(
    [
      action({
        quote: 'Led migration of the monolith to services',
        replacement: 'Led migration of the monolith to services (ask the candidate to confirm the team size).',
      }),
    ],
    src,
  );
  assert.equal(out.blocked, 1);
  assert.equal(out.actions[0]!.replacement, null);
  assert.equal(
    splitRefusal(out.actions[0]!).refusal,
    '"ask the candidate" is a note to the writer, not resume text',
  );
});

test('a check note is read off a wording the gate let through, and only its own', async () => {
  const src = await sources({ keywords: [keyword({ term: 'Kubernetes', status: 'ask_user', requirement: 'preferred' })] });
  const [warned, clean] = gateActions(
    [
      action({ quote: 'Led migration of the monolith to services', replacement: 'Led migration of the monolith to services on Kubernetes.' }),
      action({ quote: 'Designed Laravel payment workflows', replacement: 'Owned Laravel payment workflows processing $4M/month.' }),
    ],
    src,
  ).actions;
  assert.equal(hasCheckNote(warned!), true);
  assert.equal(hasCheckNote(clean!), false);
});
