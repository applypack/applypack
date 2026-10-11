import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTitleKeyword } from '../resume/title-keyword';

type Keyword = Parameters<typeof isTitleKeyword>[0];
type Rule = (keyword: Keyword, jobTitle: string | null | undefined) => boolean;

/** Each case with what it is; the pairs are the ones stored comparisons carry (#347, measured on two backups). */
const CASES: { keyword: Keyword; title: string | null; is: boolean; why: string }[] = [
  // The title itself, however it is punctuated, at any priority.
  { keyword: { term: 'Senior Software Engineer, Backend', priority: 2 }, title: 'Senior Software Engineer, Backend', is: true, why: 'the title as posted' },
  { keyword: { term: 'sr. software engineer ii', priority: 1 }, title: 'Sr. Software Engineer II', is: true, why: 'same letters, another priority' },
  // The model's shortening of it: priority 2, every word a word of the title.
  { keyword: { term: 'Product Lead', priority: 2 }, title: 'Product Lead (Strategy + Full Stack)', is: true, why: 'the issue\'s job 315' },
  { keyword: { term: 'Backend PHP Developer', priority: 2 }, title: 'Backend PHP Developer – AWS / Serverless', is: true, why: 'the issue\'s job 433' },
  { keyword: { term: 'Backend Software Engineer', priority: 2 }, title: 'Backend Software Engineer | Node.js | AI Builder', is: true, why: 'a title with a tail' },
  { keyword: { term: 'Senior Full-stack Developer', priority: 2 }, title: 'Lemon.io: Senior Full-stack Angular & PHP Developer', is: true, why: 'words left out of the middle' },
  { keyword: { term: 'Full-Stack', priority: 2 }, title: 'Lemon.io: Senior Full-stack Angular & PHP Developer', is: true, why: 'two words of the title' },
  // Priority 2 that is not the title: comparisons stored under earlier prompts keep skills there.
  { keyword: { term: 'Symfony', priority: 2 }, title: 'Lemon.io: Senior Full-stack Angular & PHP Developer', is: false, why: 'a skill at priority 2' },
  { keyword: { term: 'Vue & PHP', priority: 2 }, title: 'Lemon.io: Senior Full-stack Angular & PHP Developer', is: false, why: 'one word is not in the title' },
  { keyword: { term: 'Subscription platform / recurring billing', priority: 2 }, title: 'Software Engineer', is: false, why: 'a domain phrase' },
  // One word of the title is a skill, not a shortening.
  { keyword: { term: 'PHP', priority: 2 }, title: 'Senior PHP Developer', is: false, why: 'a single word' },
  { keyword: { term: 'Laravel', priority: 2 }, title: 'Product Engineer, Core & Connectivity (Laravel - Remote)', is: false, why: 'a single word in brackets' },
  // A shortening at another priority is whatever the model called it.
  { keyword: { term: 'Product Lead', priority: 1 }, title: 'Product Lead (Strategy + Full Stack)', is: false, why: 'priority 1' },
  { keyword: { term: 'Product Lead' }, title: 'Product Lead (Strategy + Full Stack)', is: false, why: 'no priority' },
  // A term the person added at "preferred" is stored with priority 2, and is theirs.
  { keyword: { term: 'Product Lead', priority: 2, override: { added: true } }, title: 'Product Lead (Strategy + Full Stack)', is: false, why: 'added by the person' },
  { keyword: { term: 'Senior Software Engineer', priority: 2, override: { added: true } }, title: 'Senior Software Engineer', is: false, why: 'added by the person, even the title itself' },
  // No title to compare with: nothing is the title.
  { keyword: { term: 'Product Lead', priority: 2 }, title: null, is: false, why: 'no title' },
  { keyword: { term: 'Product Lead', priority: 2 }, title: ' — ', is: false, why: 'a title of punctuation' },
  // Other scripts read the same way.
  { keyword: { term: 'Розробник PHP', priority: 2 }, title: 'Старший розробник PHP (Laravel)', is: true, why: 'Cyrillic' },
];

test('isTitleKeyword: the title, its shortening, and what only looks like one', () => {
  for (const c of CASES) assert.equal(isTitleKeyword(c.keyword, c.title), c.is, `${c.keyword.term} — ${c.why}`);
});

test('the browser module answers the same on every case', async () => {
  // @ts-expect-error — plain JS with no declaration file; parity is what this test asserts.
  const browser = (await import('./public/title-keyword.mjs')) as { isTitleKeyword: Rule };
  for (const c of CASES) assert.equal(browser.isTitleKeyword(c.keyword, c.title), isTitleKeyword(c.keyword, c.title), `${c.keyword.term} — ${c.why}`);
  // And on every pairing of a term with every other case's title, where the two could most easily drift.
  for (const a of CASES) for (const b of CASES) assert.equal(browser.isTitleKeyword(a.keyword, b.title), isTitleKeyword(a.keyword, b.title), `${a.keyword.term} / ${b.title}`);
});
