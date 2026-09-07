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

test('a denial outranks a word on the page; a question the text answers does not', async () => {
  const m = await matcher();
  const out = anchorStatuses(
    [
      // The user said they do not have it (facts.ts). The text cannot overrule that.
      kw('Go', 'cannot_claim'),
      // "the resume does not evidence it, but they might" — the resume does.
      kw('React', 'ask_user'),
      // Nothing in the text, so the question stands.
      kw('Kubernetes', 'ask_user'),
    ],
    RESUME,
    m,
  );
  assert.deepEqual(out.keywords.map((k) => k.status), ['cannot_claim', 'present', 'ask_user']);
  assert.equal(out.upgraded, 1);
  assert.equal(out.downgraded, 0);
});

test('aliases count as the word being written', async () => {
  const out = anchorStatuses([kw('Golang', 'add', ['go'])], RESUME, await matcher());
  assert.equal(out.keywords[0]?.status, 'present');
});
