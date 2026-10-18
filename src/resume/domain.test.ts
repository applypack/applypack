import { test } from 'node:test';
import assert from 'node:assert/strict';
import { domainLean, domainMismatch, domainNotice, domainVocabulary, inDomain } from './domain';
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

test('domainMismatch says "different" only when both sides are known and share no sector word', () => {
  const restaurants = { company: { industry: 'restaurant technology', product: 'AI-enabled order taking for restaurants', audience: 'small brick-and-mortar restaurant owners', stage: null } };
  const mine = ['fitness e-commerce', 'ai tooling', 'public sector'];
  assert.equal(domainMismatch(mine, restaurants).verdict, 'different');
  assert.equal(domainMismatch(['restaurant delivery apps'], restaurants).verdict, 'match', 'a shared sector word, plural or not');
  // An agency serves every sector: nothing for the candidate to lack.
  assert.equal(domainMismatch(mine, BRIEF).verdict, 'match');
  assert.equal(domainMismatch(['fintech'], { company: { industry: 'IT staffing / consulting', product: null, audience: null, stage: null } }).verdict, 'match');
  // Either side unknown: nothing is said.
  assert.equal(domainMismatch([], restaurants).verdict, 'unknown');
  assert.equal(domainMismatch(mine, { company: { industry: null, product: 'something', audience: null, stage: null } }).verdict, 'unknown');
  assert.equal(domainMismatch(mine, null).verdict, 'unknown');
});

const company = (industry: string | null, product: string | null = null, audience: string | null = null) => ({
  company: { industry, product, audience, stage: null },
});

test('one sector spelled two ways is one sector — the vocabulary the screening reads (#207)', () => {
  assert.equal(domainMismatch(['healthcare'], company('healthtech')).verdict, 'match');
  assert.equal(domainMismatch(['retail banking'], company('fintech')).verdict, 'match');
  assert.equal(domainMismatch(['online payments'], company('Fintech / neobank')).verdict, 'match');
  assert.equal(domainMismatch(['e-commerce'], company('retail')).verdict, 'match', 'a shop online is no other sector than a shop');
  assert.equal(domainMismatch(['fashion retail'], company('e-commerce marketplace')).verdict, 'match');
  // Neighbours stay apart.
  assert.equal(domainMismatch(['fitness'], company('healthtech')).verdict, 'different');
  assert.equal(domainMismatch(['gaming'], company('fintech')).verdict, 'different');
  assert.equal(domainMismatch(['insurance'], company('banking')).verdict, 'different');
  assert.equal(domainMismatch(['logistics'], company('e-commerce')).verdict, 'different');
  // The posting's product and audience count as they always did for words.
  assert.equal(domainMismatch(['digital health'], company('B2B SaaS', null, 'hospitals and clinics')).verdict, 'match');
});

test('with no industry, the product names the sector — only when it names one (#207)', () => {
  const restaurants = company(null, 'AI-enabled order taking for restaurants');
  assert.deepEqual(domainMismatch(['fitness e-commerce'], restaurants), {
    verdict: 'different',
    resume: ['fitness e-commerce'],
    posting: 'AI-enabled order taking for restaurants',
  });
  assert.equal(domainMismatch(['food delivery'], restaurants).verdict, 'match');
  assert.equal(domainMismatch(['fintech'], company('', 'telemedicine app for clinics')).verdict, 'different');
  // A product that names no sector is no sector: nothing is said.
  assert.equal(domainMismatch(['fintech'], company(null, 'an analytics dashboard for teams')).verdict, 'unknown');
  // An agency's product serves every sector.
  assert.equal(domainMismatch(['fintech'], company(null, 'outsourced development of e-commerce stores')).verdict, 'match');
  // The industry, when there is one, is what the page names.
  assert.equal(domainMismatch(['fitness'], company('food technology', 'order taking for restaurants')).posting, 'food technology');
});

test('domainNotice is one sentence for a different sector, and nothing otherwise', () => {
  const restaurants = { company: { industry: 'restaurant technology', product: null, audience: null, stage: null } };
  const report = domainMismatch(['fitness e-commerce', 'ai tooling', 'public sector', 'media'], restaurants);
  assert.equal(
    domainNotice(report),
    'This posting is in restaurant technology; your resume shows fitness e-commerce, ai tooling, public sector. The suggestions reframe transferable work in the employer\'s terms — they do not claim experience in restaurant technology.',
  );
  assert.equal(domainNotice(domainMismatch(['restaurant delivery'], restaurants)), null);
  assert.equal(domainNotice(domainMismatch([], restaurants)), null);
  // A sector close to the posting's is never left out of the three it names: it makes the verdict a match (#207).
  assert.equal(domainNotice(domainMismatch(['fitness', 'public sector', 'media', 'online food delivery'], restaurants)), null);
});
