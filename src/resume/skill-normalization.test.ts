import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aliasesFor, versionlessAlias, withTableAliases } from './keyword-aliases';
import { readKeywords, type MatchKeyword } from './prompts';
import type { KeywordMatcher } from './keyword-matcher';

/*
 * The regression suite §62 of the Resume ↔ Job Intelligence analysis asks for,
 * written against the two pieces that actually decide a match: the alias table
 * (the same thing spelled differently) and the browser matcher (what the panes
 * and the live score can find). No AI, so it runs on every push.
 *
 * The negative cases matter more than the positive ones: they are the rule
 * gotcha 11 was paid for — a related technology is NOT the same technology,
 * and a platform does not imply its services.
 */

const kw = (term: string): MatchKeyword =>
  readKeywords([{ term, priority: 1, requirement: 'must', primary: false, status: 'present', aliases: [] }])[0]!;

async function matcher(): Promise<Pick<KeywordMatcher, 'findTerm'>> {
  // @ts-expect-error — plain JS with no declaration file.
  return (await import('../web/public/target.mjs')) as Pick<KeywordMatcher, 'findTerm'>;
}

/** Does the resume text satisfy this keyword, table aliases included — the live question. */
async function finds(term: string, text: string): Promise<boolean> {
  const k = withTableAliases(kw(term));
  return (await matcher()).findTerm(text, k.term, k.aliases).length > 0;
}

test('the same thing spelled differently is the same thing', async () => {
  for (const [term, text] of [
    ['PostgreSQL', 'Databases: Postgres, Redis'],
    ['Postgres', 'Databases: PostgreSQL 16'],
    ['JavaScript', 'Languages: JS, TypeScript'],
    ['Amazon Web Services', 'Cloud: AWS, GCP'],
    ['AWS', 'Cloud: Amazon Web Services'],
    ['Go', 'Backend in Golang since 2019'],
    ['Kubernetes', 'Ran the K8s cluster'],
    ['Node.js', 'Services in node and PHP'],
    ['REST API', 'Designed RESTful APIs for the mobile client'],
  ] as const) {
    assert.equal(await finds(term, text), true, `${term} should be found in "${text}"`);
  }
});

test('a related technology is not the same technology', async () => {
  for (const [term, text] of [
    ['PostgreSQL', 'Databases: MySQL, MongoDB'],
    ['React', 'Front end in Vue.js and Nuxt'],
    ['Node.js', 'Backend in PHP and Laravel'],
    ['Rails', 'Django services on Python'],
  ] as const) {
    assert.equal(await finds(term, text), false, `${term} must not be satisfied by "${text}"`);
  }
});

test('a platform does not imply its services (§12: relationships are directional)', async () => {
  assert.equal(await finds('Lambda', 'Cloud: AWS, Terraform'), false);
  assert.equal(await finds('DynamoDB', 'Cloud: AWS'), false);
  // The service does name the platform, though — that is the direction that holds.
  assert.equal(aliasesFor('amazon ecs').includes('ecs'), true);
});

test('the alias table never groups two different things', () => {
  // A guard on the table itself: if one of these ever shares a group, a
  // resume with the first would silently satisfy a posting asking the second.
  for (const [a, b] of [
    ['react', 'vue'],
    ['mysql', 'postgresql'],
    ['php', 'node.js'],
    ['angular', 'react'],
    ['java', 'javascript'],
  ] as const) {
    assert.equal(aliasesFor(a).includes(b), false, `"${a}" must not alias "${b}"`);
    assert.equal(aliasesFor(b).includes(a), false, `"${b}" must not alias "${a}"`);
  }
});

test('a version-pinned requirement is the same technology (§11: highest transferability)', async () => {
  // A live Drupal posting asked for "PHP 8" and the model called a PHP resume
  // cannot_claim — on a primary term, which caps the whole comparison at 30.
  for (const [term, text] of [
    ['PHP 8', 'Languages: PHP, SQL, Bash'],
    ['Java 17', 'Backend in Java and Kotlin'],
    ['Vue 3', 'Front end in Vue and Nuxt'],
    ['Python 3.11', 'Data pipelines in Python'],
  ] as const) {
    assert.equal(await finds(term, text), true, `${term} should be satisfied by "${text}"`);
  }
});

test('a name that merely ends in a number is not a version', () => {
  // These are the names of things, not versions of anything.
  for (const term of ['SOC 2', 'Web 3', 'ISO 27001', 'S3', 'EC2']) {
    assert.equal(versionlessAlias(term), null, `${term} must keep its number`);
  }
  assert.equal(versionlessAlias('PHP 8'), 'php');
  assert.equal(versionlessAlias('.NET 8'), '.net');
});
