import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchorStatuses } from './keyword-anchor';
import { readKeywords, type MatchKeyword } from './prompts';
import type { KeywordMatcher } from './keyword-matcher';

const kw = (term: string, status: MatchKeyword['status'], aliases: string[] = []): MatchKeyword =>
  readKeywords([{ term, priority: 1, requirement: 'must', primary: false, status, aliases }])[0]!;

async function matcher(): Promise<KeywordMatcher> {
  // @ts-expect-error — plain JS with no declaration file.
  return (await import('../web/public/target.mjs')) as KeywordMatcher;
}

const RESUME = 'Senior engineer shipping Go, React and TypeScript systems. Unit, integration & E2E testing.';

test('present vs add is settled by the text, both ways', async () => {
  const m = await matcher();
  const out = anchorStatuses(
    [
      // The model said add, but the word is right there.
      kw('TypeScript', 'add'),
      // The model said present, but this is a paraphrase of what the resume says.
      kw('automated testing', 'present'),
      // Already agreeing with the text — untouched.
      kw('React', 'present'),
      kw('Kubernetes', 'add'),
    ],
    RESUME,
    m,
  );
  assert.deepEqual(out.keywords.map((k) => k.status), ['present', 'add', 'present', 'add']);
  assert.equal(out.upgraded, 1);
  assert.equal(out.downgraded, 1);
});

test('what the candidate HAS is never decided by typing', async () => {
  const m = await matcher();
  // Both words are in the text; neither status is a claim about the text.
  const out = anchorStatuses([kw('Go', 'cannot_claim'), kw('React', 'ask_user')], RESUME, m);
  assert.deepEqual(out.keywords.map((k) => k.status), ['cannot_claim', 'ask_user']);
  assert.equal(out.upgraded, 0);
  assert.equal(out.downgraded, 0);
});

test('aliases count as the word being written', async () => {
  const out = anchorStatuses([kw('Golang', 'add', ['go'])], RESUME, await matcher());
  assert.equal(out.keywords[0]?.status, 'present');
});
