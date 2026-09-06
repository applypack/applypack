import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileGroups } from './keyword-group';
import { BriefSchema, readKeywords, type MatchKeyword, type PostingBrief } from './prompts';

const brief = (): PostingBrief =>
  BriefSchema.parse({
    role: { posted_title: 'Web Developer', family: 'web' },
    requirement_groups: [
      { label: 'front-end framework', level: 'must', satisfy: 'any', options: ['React', 'Next.js', 'Vue.js'] },
    ],
    keywords: [],
  });

/** Through the schema, the way every keyword reaches the pass in production. */
const kw = (over: Partial<MatchKeyword> & { term: string }): MatchKeyword =>
  readKeywords([{ priority: 1, requirement: 'must', primary: false, status: 'present', aliases: [], ...over }])[0]!;

test('a group the brief backs survives, term by term', () => {
  const out = reconcileGroups(
    [kw({ term: 'React', group: 'front-end framework' }), kw({ term: 'Vue.js', group: 'Front-End Framework' })],
    brief(),
  );
  assert.equal(out.dropped, 0);
  assert.deepEqual(out.keywords.map((k) => k.group), ['front-end framework', 'Front-End Framework']);
});

test('an anchored spelling still matches its option', () => {
  // anchorKeywords rewrites a term to the posting's own spelling, which need
  // not be the brief's — "React.js" and "React" are the same requirement.
  const out = reconcileGroups([kw({ term: 'React.js', group: 'front-end framework' })], brief());
  assert.equal(out.dropped, 0);
  assert.equal(out.keywords[0]?.group, 'front-end framework');
});

test('a label the brief never wrote is dropped, and so is a term the group never named', () => {
  const out = reconcileGroups(
    [
      kw({ term: 'React', group: 'invented label' }),
      kw({ term: 'PostgreSQL', group: 'front-end framework' }),
      kw({ term: 'SEO' }),
    ],
    brief(),
  );
  assert.equal(out.dropped, 2);
  assert.deepEqual(out.keywords.map((k) => k.group), [null, null, null]);
});

test('without a brief nothing authorises a group, so every label goes', () => {
  const out = reconcileGroups([kw({ term: 'React', group: 'front-end framework' })], null);
  assert.equal(out.dropped, 1);
  assert.equal(out.keywords[0]?.group, null);
});
