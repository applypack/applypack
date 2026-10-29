import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appliedWording, freshActions, rewritesOfApplied, withoutSuggestedWording, type Locate } from './applied';
import { readActions, type MatchAction } from './prompts';
import { titleOverHeadline } from './replacement-gate';
import { structureFromText } from './structure-from-text';

// The real locator: exact, then whitespace- and punctuation-insensitive.
// @ts-expect-error — plain JS with no declaration file.
const matcher = import('../web/public/target.mjs') as Promise<{ locateQuote: Locate; findTerm: (text: string, term: string, aliases?: string[]) => { start: number; end: number }[] }>;

function action(partial: Partial<MatchAction> & Pick<MatchAction, 'what'>): MatchAction {
  return readActions([
    { section: 'experience', where: 'V Shred — first bullet', why: 'WordPress', priority: 'high', quote: null, replacement: null, insert_after: null, ...partial },
  ])[0]!;
}

const RESUME = [
  'WordPress Developer | PHP & E-Commerce Specialist',
  'EXPERIENCE',
  '• Built and maintained WordPress-based e-commerce solutions using PHP and MySQL, powering checkout and payment flows.',
  '• Delivered responsive front-end updates using SASS (BEM methodology) and jQuery/Ajax for client-facing checkout pages.',
  '• Optimized sales-funnel APIs, reducing page load times by 70%.',
].join('\n');

test('appliedWording finds the previous replacements the text now carries, however they wrap', async () => {
  const { locateQuote } = await matcher;
  const previous = [
    // Applied as proposed.
    action({ what: 'lead with WordPress', quote: 'Led backend architecture for Go services', replacement: 'Built and maintained WordPress-based e-commerce solutions using PHP and MySQL, powering checkout and payment flows.' }),
    // Applied, and the editor re-wrapped it — the loose locator still finds it.
    action({ what: 'add a front-end bullet', quote: null, insert_after: 'Built and maintained', replacement: 'Delivered responsive front-end updates using SASS (BEM methodology) and jQuery/Ajax for client-facing checkout pages' }),
    // Not taken.
    action({ what: 'rename the title', quote: 'Senior Software Engineer', replacement: 'Senior WordPress Engineer | PHP' }),
    // No wording at all — a reorder.
    action({ what: 'move the funnel bullet up', quote: 'Optimized sales-funnel APIs', replacement: null }),
    // A bare term is not wording: it recurs on its own.
    action({ what: 'add the word', quote: null, replacement: 'WordPress' }),
  ];
  const applied = appliedWording(previous, RESUME, locateQuote);
  assert.deepEqual(applied.map((a) => a.action.what), ['lead with WordPress', 'add a front-end bullet']);
  assert.equal(RESUME.slice(applied[0]!.span.start, applied[0]!.span.end).startsWith('Built and maintained WordPress'), true);
});

test('rewritesOfApplied counts the next actions that quote applied wording, and nothing else', async () => {
  const { locateQuote } = await matcher;
  const applied = appliedWording(
    [action({ what: 'lead with WordPress', replacement: 'Built and maintained WordPress-based e-commerce solutions using PHP and MySQL, powering checkout and payment flows.' })],
    RESUME,
    locateQuote,
  );
  const next = [
    // The churn: quoting the line the candidate just took, to reword it again.
    action({ what: 'reword the opening bullet', quote: 'Built and maintained WordPress-based e-commerce solutions using PHP and MySQL', replacement: 'Built WordPress e-commerce websites…' }),
    // A partial quote inside the applied line is a rewrite of it too.
    action({ what: 'tighten', quote: 'powering checkout and payment flows', replacement: 'powering checkout' }),
    // A different line — legitimate advice.
    action({ what: 'name MySQL in the funnel bullet', quote: 'Optimized sales-funnel APIs', replacement: 'Optimized MySQL-backed sales-funnel APIs' }),
    // An addition quotes nothing.
    action({ what: 'add a Git bullet', quote: null, insert_after: 'Optimized sales-funnel APIs', replacement: 'Collaborated in a Git-based workflow across 10+ projects.' }),
  ];
  assert.deepEqual(rewritesOfApplied(applied, next, RESUME, locateQuote).map((a) => a.what), ['reword the opening bullet', 'tighten']);
  assert.deepEqual(rewritesOfApplied([], next, RESUME, locateQuote), []);
});

test('freshActions drops a rework of applied wording unless it names a keyword the text lacks', async () => {
  const m = await matcher;
  const applied = appliedWording(
    [action({ what: 'lead with WordPress', replacement: 'Built and maintained WordPress-based e-commerce solutions using PHP and MySQL, powering checkout and payment flows.' })],
    RESUME,
    m.locateQuote,
  );
  const keywords = [
    { term: 'WordPress', aliases: [], status: 'present' as const },
    { term: 'MySQL', aliases: ['mysql'], status: 'present' as const },
    { term: 'Git', aliases: ['github'], status: 'add' as const },
  ];
  const actions = [
    // The churn: the same bullet again, for a keyword it already carries.
    action({ what: 'open the role with WordPress instead of burying it', why: 'WordPress, primary must', quote: 'Built and maintained WordPress-based e-commerce solutions', replacement: 'Delivered WordPress e-commerce…' }),
    // A rework that names a gap the wording lost — kept.
    action({ what: 'name the Git workflow in the opening bullet', why: 'Git is a must the resume never shows', quote: 'powering checkout and payment flows', replacement: 'powering checkout and payment flows in a Git-based workflow' }),
    // Not a rework at all — kept.
    action({ what: 'name MySQL in the funnel bullet', why: 'MySQL', quote: 'Optimized sales-funnel APIs', replacement: 'Optimized MySQL-backed sales-funnel APIs' }),
  ];
  const fresh = freshActions(actions, applied, keywords, RESUME, m);
  assert.deepEqual(fresh.kept.map((a) => a.what), ['name the Git workflow in the opening bullet', 'name MySQL in the funnel bullet']);
  assert.deepEqual(fresh.dropped.map((a) => a.what), ['open the role with WordPress instead of burying it']);
  // Nothing applied yet: nothing is a rework, and the list is untouched.
  assert.equal(freshActions(actions, [], keywords, RESUME, m).kept.length, 3);
});

test('the headline taken from the last report is a rework when the next one retitles again (#588)', async () => {
  const m = await matcher;
  // v2 as Save as vN stores it: the headline the last report proposed now opens the contact line.
  const v2 = [
    '# Alex Rivera',
    'Software Engineer, Backend - Node.js & TypeScript · Austin, TX · alex.rivera@example.com',
    '',
    '## Summary',
    'Backend engineer with 8 years building Node.js and TypeScript services on AWS.',
  ].join('\n');
  const applied = appliedWording(
    [action({ section: 'title', what: 'retitle', quote: 'Senior Backend Engineer', replacement: 'Software Engineer, Backend - Node.js & TypeScript' })],
    v2,
    m.locateQuote,
  );
  assert.equal(applied.length, 1);
  // The next report adds a headline after the name: no quote, so it was never seen as a rework, and the title changed twice.
  const retitle = action({ section: 'title', what: 'add a headline', why: 'the posting title', insert_after: '# Alex Rivera', replacement: 'Backend Software Engineer (Node.js)' });
  const next = titleOverHeadline([retitle], v2, structureFromText(v2).basics.label);
  const keywords = [{ term: 'Node.js', aliases: [], status: 'present' as const }];
  assert.equal(rewritesOfApplied(applied, next, v2, m.locateQuote).length, 1);
  assert.deepEqual(freshActions(next, applied, keywords, v2, m).kept, []);
});

test("a letter's evidence is the candidate's own words: every applied suggestion goes back (#632)", async () => {
  const { locateQuote } = await matcher;
  const original = [
    'Senior Backend Engineer',
    '- Set up structured logging and alerting; median incident resolution fell from 90 to 35 minutes',
    '- Deployed to AWS ECS; wrote the runbooks the on-call rota still uses',
  ].join('\n');
  const summary = action({
    section: 'summary',
    what: 'add a summary',
    quote: null,
    insert_after: 'Senior Backend Engineer',
    replacement: 'Ran on-call rotations that cut incident resolution from 90 to 35 minutes.',
  });
  const bullet = action({
    what: 'lead with on-call',
    quote: 'Deployed to AWS ECS; wrote the runbooks the on-call rota still uses',
    replacement: 'Owned on-call for AWS ECS services and wrote the runbooks the rota still uses',
  });
  // A later report reworded the bullet the first one wrote: both steps go back.
  const again = action({
    what: 'name the pager',
    quote: 'Owned on-call for AWS ECS services and wrote the runbooks the rota still uses',
    replacement: 'Owned the PagerDuty on-call for AWS ECS services; wrote the runbooks the rota still uses',
  });
  const saved = [
    'Senior Backend Engineer',
    'Ran on-call rotations that cut incident resolution from 90 to 35 minutes.',
    '- Set up structured logging and alerting; median incident resolution fell from 90 to 35 minutes',
    '- Owned the PagerDuty on-call for AWS ECS services; wrote the runbooks the rota still uses',
  ].join('\n');
  assert.equal(withoutSuggestedWording(saved, [summary, bullet, again], locateQuote), original);

  // What the person typed in place of a suggestion is theirs, and stays.
  const typed = saved.replace('Owned the PagerDuty on-call', 'Carried the pager');
  assert.match(withoutSuggestedWording(typed, [summary, bullet, again], locateQuote), /Carried the pager/);

  // Two reports retitled the headline, one wording inside the other: the longer is the one applied (the live check).
  const short = action({ section: 'title', what: 'retitle', quote: 'Senior Backend Engineer', replacement: 'Software Engineer, Backend' });
  const long = action({ section: 'title', what: 'retitle', quote: 'Senior Backend Engineer', replacement: 'Senior Software Engineer, Backend' });
  const retitled = original.replace('Senior Backend Engineer', 'Senior Software Engineer, Backend');
  assert.equal(withoutSuggestedWording(retitled, [short, long], locateQuote), original);

  // A trim is part of what it replaced: putting it back must not find it again for ever.
  const trim = action({ what: 'trim', quote: 'Set up structured logging and alerting; median incident resolution fell from 90 to 35 minutes', replacement: 'Set up structured logging and alerting' });
  assert.equal(withoutSuggestedWording(original, [trim], locateQuote), original);
});
