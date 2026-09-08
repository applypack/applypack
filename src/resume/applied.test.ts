import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appliedWording, rewritesOfApplied, type Locate } from './applied';
import { readActions, type MatchAction } from './prompts';

// The real locator: exact, then whitespace- and punctuation-insensitive.
// @ts-expect-error — plain JS with no declaration file.
const matcher = import('../web/public/target.mjs') as Promise<{ locateQuote: Locate }>;

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
