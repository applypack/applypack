import { test } from 'node:test';
import assert from 'node:assert/strict';
import { domainLean, domainVocabulary, inDomain } from './domain';
import { readActions, type MatchAction } from './prompts';

const BRIEF = {
  company: {
    industry: 'software house / digital agency',
    product: 'custom mobile and web application development and e-commerce integration services for clients',
    audience: "the agency's business clients in Poland and internationally",
    stage: 'agency',
  },
};

function action(priority: MatchAction['priority'], replacement: string | null): MatchAction {
  return readActions([{ section: 'experience', where: 'x', what: 'x', why: 'x', priority, quote: null, replacement, insert_after: null }])[0]!;
}

test('domainVocabulary keeps the words that name the domain and drops the ones every employer uses', () => {
  assert.deepEqual(domainVocabulary(BRIEF), ['e-commerce', 'integration', 'poland']);
  assert.deepEqual(domainVocabulary({ company: { industry: 'restaurant technology', product: 'AI-enabled order taking', audience: null, stage: null } }), ['restaurant', 'ai-enabled', 'order', 'taking']);
  assert.deepEqual(domainVocabulary({ company: { industry: null, product: null, audience: null, stage: null } }), []);
  assert.deepEqual(domainVocabulary(null), []);
});

test('inDomain matches whole words with their inflections, never a word glued inside another', () => {
  const v = ['restaurant', 'order'];
  assert.equal(inDomain('Built order-taking flows for 200 restaurants', v), true);
  assert.equal(inDomain('Reordered the summary paragraph', v), false, '"reordered" is not "order"');
  assert.equal(inDomain('Built a web application for clients', v), false);
  assert.equal(inDomain(null, v), false);
  assert.equal(inDomain('anything', []), false);
});

test('domainLean counts the worded actions, high-priority ones on their own', () => {
  const lean = domainLean(
    [
      action('high', 'Built e-commerce checkout flows in PHP for international clients'),
      action('high', 'Led migration of legacy services to Go'),
      action('high', null),
      action('medium', 'Delivered e-commerce integrations for agency clients in Poland'),
      action('low', 'Trimmed the tools line'),
    ],
    BRIEF,
  );
  assert.deepEqual(lean.high, { hits: 1, total: 2 });
  assert.deepEqual(lean.all, { hits: 2, total: 4 });
  assert.deepEqual(lean.vocabulary, ['e-commerce', 'integration', 'poland']);
});
