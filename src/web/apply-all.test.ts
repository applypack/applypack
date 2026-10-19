import { test } from 'node:test';
import assert from 'node:assert/strict';

type Op =
  | { key: string; kind: 'change'; quote: string; wording: string }
  | { key: string; kind: 'add'; anchor: string; wording: string }
  | { key: string; kind: 'remove'; quote: string }
  | { key: string; kind: 'keyword'; term: string; where?: string };
type Result = {
  text: string;
  done: { key: string; kind: string; edit: { start: number; removed: string; inserted: string; lead: string; trail: string } }[];
  failed: { key: string; kind: string; error: string }[];
};

// @ts-expect-error — plain JS with no declaration file; the shape is asserted below.
const mod = import('./public/apply-all.mjs') as Promise<{
  applyAll: (text: string, ops: Op[]) => Result;
  applyAllSummary: (r: Result) => string;
  addKeywords: (text: string, terms: { term: string; where?: string }[]) => Result;
}>;
// @ts-expect-error — plain JS with no declaration file.
const edits = import('./public/text-edits.mjs') as Promise<{
  undoEdit: (text: string, edit: Result['done'][number]['edit']) => { text: string } | { error: string };
}>;

const RESUME = [
  'Nazar Boyko',
  'Senior Full-Stack Engineer',
  'Austin, Texas ∙ boyko.nazar@gmail.com ∙ +1 (612) 267-5544',
  '',
  'KEY SKILLS',
  'Programming: Go, PHP, JavaScript',
  '',
  'EXPERIENCE',
  '• Led backend architecture for PHP services.',
  '• Built a multi-gateway payment platform in Laravel.',
  '• Improved SEO rankings for marketing pages.',
].join('\n');

const OPS: Op[] = [
  { key: 'a', kind: 'change', quote: 'Senior Full-Stack Engineer', wording: 'Senior Backend Engineer' },
  { key: 'b', kind: 'add', anchor: 'Built a multi-gateway payment platform in Laravel.', wording: 'Cut checkout failures 18% with retry queues.' },
  { key: 'c', kind: 'remove', quote: '• Improved SEO rankings for marketing pages.' },
  { key: 'kw:Kafka', kind: 'keyword', term: 'Kafka', where: 'Key Skills, Programming' },
];

test('applyAll lands every operation on the text the one before it left', async () => {
  const { applyAll } = await mod;
  const r = applyAll(RESUME, OPS);
  assert.deepEqual(r.done.map((d) => d.key), ['a', 'b', 'c', 'kw:Kafka']);
  assert.deepEqual(r.failed, []);
  assert.match(r.text, /^Senior Backend Engineer$/m);
  assert.match(r.text, /Laravel\.\n• Cut checkout failures 18% with retry queues\.$/m);
  assert.equal(r.text.includes('SEO'), false);
  assert.match(r.text, /^Programming: Go, PHP, JavaScript, Kafka$/m);
});

test('applyAll skips what it cannot place and keeps going', async () => {
  const { applyAll } = await mod;
  const r = applyAll(RESUME, [
    { key: 'gone', kind: 'change', quote: 'A sentence the resume never had', wording: 'x' },
    { key: 'contact', kind: 'remove', quote: 'boyko.nazar@gmail.com' },
    OPS[0]!,
  ]);
  assert.deepEqual(r.failed.map((f) => [f.key, f.error]), [['gone', 'not-found'], ['contact', 'protected']]);
  assert.deepEqual(r.done.map((d) => d.key), ['a']);
});

test('a keyword an earlier change already wrote in is neither done nor failed', async () => {
  const { applyAll } = await mod;
  const r = applyAll(RESUME, [
    { key: 'a', kind: 'change', quote: 'Led backend architecture for PHP services.', wording: 'Led backend architecture for PHP and Kafka services.' },
    { key: 'kw:Kafka', kind: 'keyword', term: 'Kafka' },
  ]);
  assert.deepEqual(r.done.map((d) => d.key), ['a']);
  assert.deepEqual(r.failed, []);
});

test('every applied operation can be undone on its own, in any order', async () => {
  const { applyAll } = await mod;
  const { undoEdit } = await edits;
  const r = applyAll(RESUME, OPS);
  for (const order of [[0, 1, 2, 3], [3, 2, 1, 0], [2, 0, 3, 1]]) {
    let text = r.text;
    for (const i of order) {
      const back = undoEdit(text, r.done[i]!.edit);
      assert.ok(!('error' in back), `undo of ${r.done[i]!.key} refused in order ${order}`);
      text = (back as { text: string }).text;
    }
    assert.equal(text, RESUME, `order ${order} restores the resume exactly`);
  }
});

test('applyAllSummary says what landed and what did not', async () => {
  const { applyAll, applyAllSummary } = await mod;
  assert.equal(applyAllSummary(applyAll(RESUME, OPS)), 'Applied 1 change, 1 addition, 1 removal, 1 keyword.');
  const partial = applyAll(RESUME, [OPS[0]!, { key: 'x', kind: 'change', quote: 'nope', wording: 'y' }]);
  assert.equal(applyAllSummary(partial), 'Applied 1 change. 1 could not be placed — the card says why.');
  assert.equal(applyAllSummary(applyAll(RESUME, [])), 'Nothing was applied.');
});

test('addKeywords puts each term on the skills line its hint names, and undoes one by one', async () => {
  const { addKeywords } = await mod;
  const { undoEdit } = await edits;
  const text = 'KEY SKILLS\nProgramming: Go, PHP, JavaScript\nData: MySQL, Redis\n\nEXPERIENCE\n• Built things.';
  const r = addKeywords(text, [{ term: 'Kafka', where: 'Data line' }, { term: 'Rust', where: 'Programming' }, { term: 'PHP' }]);
  assert.match(r.text, /^Data: MySQL, Redis, Kafka$/m);
  assert.match(r.text, /^Programming: Go, PHP, JavaScript, Rust$/m);
  assert.deepEqual(r.done.map((d) => d.key), ['kw:Kafka', 'kw:Rust'], 'PHP is already there — neither done nor failed');
  let back = r.text;
  for (const d of [...r.done].reverse()) back = (undoEdit(back, d.edit) as { text: string }).text;
  assert.equal(back, text);
});

test('addKeywords gives terms no list line can take a line of their own', async () => {
  const { addKeywords } = await mod;
  // A skills section written as prose has no list to append to.
  const prose = 'SKILLS\nComfortable across the backend and the browser.\n\nEXPERIENCE\n• Built things.';
  const a = addKeywords(prose, [{ term: 'Kafka' }, { term: 'Redis' }]);
  assert.match(a.text, /^Comfortable across the backend and the browser\.\nAlso: Kafka, Redis$/m);
  // No skills section at all: one goes in before the work history.
  const none = 'Alex\nSUMMARY\nEngineer.\n\nPROFESSIONAL EXPERIENCE\n• Built things.';
  const b = addKeywords(none, [{ term: 'Kafka' }]);
  assert.match(b.text, /Engineer\.\n\nSKILLS\nKafka\n\nPROFESSIONAL EXPERIENCE/);
  assert.deepEqual(b.failed, []);
  // A summary sentence that opens with "Experience" is not the work history,
  // and a title-case "Experience" straight under the skills ends their section.
  const sentence = 'Alex\nExperience with Laravel and Vue across eight years of product work.\n\nEXPERIENCE\n• Built things.';
  assert.match(addKeywords(sentence, [{ term: 'Kafka' }]).text, /product work\.\n\nSKILLS\nKafka\n\nEXPERIENCE/);
  const tight = 'SKILLS\nComfortable across the stack.\nExperience\n• Built things.';
  assert.match(addKeywords(tight, [{ term: 'Kafka' }]).text, /stack\.\nAlso: Kafka\nExperience\n/);
});

test('addKeywords puts each term with no hint on its own family’s line, and the rest on a line of their own (#576)', async () => {
  const { addKeywords } = await mod;
  const text = [
    '## Skills',
    '- Backend: Node.js, TypeScript, NestJS',
    '- Data: PostgreSQL, Redis',
    '- Cloud & DevOps: AWS, Docker',
    '- Testing: Jest, Playwright, contract testing (Pact)',
    '',
    '## Experience',
    '**Engineer — Acme** · 2020 – Present',
  ].join('\n');
  const r = addKeywords(text, ['JSON', 'Kubernetes', 'NoSQL', 'OAuth2', 'Salesforce'].map((term) => ({ term })));
  assert.deepEqual(r.failed, []);
  const lines = r.text.split('\n');
  assert.equal(lines[1], '- Backend: Node.js, TypeScript, NestJS, JSON, OAuth2');
  assert.equal(lines[2], '- Data: PostgreSQL, Redis, NoSQL');
  assert.equal(lines[3], '- Cloud & DevOps: AWS, Docker, Kubernetes');
  assert.equal(lines[4], '- Testing: Jest, Playwright, contract testing (Pact)');
  assert.equal(lines[5], 'Also: Salesforce');
});

// Found by the 2026-09-30 review: a bullet or a title with "stack" in it opened a
// "skills section", and the keyword went into a job's stack line or its dates line.
const WORK_STACK = [
  'Jane Doe',
  'jane@example.com | +1 555 0100',
  '',
  'SKILLS',
  'Languages: PHP, JavaScript, TypeScript',
  'Frameworks: Laravel, Vue.js',
  '',
  'EXPERIENCE',
  'Senior Full-Stack Engineer',
  'Acme Corp | Berlin | 2020 – Present',
  '- Built full-stack checkout features',
  'Technology Stack: PHP, Laravel, MySQL, Redis',
].join('\n');

test('a keyword never lands on a job’s stack line or its dates line', async () => {
  const { addKeywords } = await mod;
  const r = addKeywords(WORK_STACK, [{ term: 'Kafka' }]);
  assert.deepEqual(r.failed, []);
  assert.equal(r.text.split('\n').find((l) => l.includes('Kafka')), 'Frameworks: Laravel, Vue.js, Kafka');
});

test('a role dated any of the usual ways closes the skills section', async () => {
  const { addKeywords } = await mod;
  for (const dates of ['Jan 2020 – Mar 2022', '03/2020 - 05/2022', '2019-Present']) {
    const text = ['Jane Doe', '', 'SKILLS', 'Languages: PHP, Go', 'Where I worked', `Acme Corp, ${dates}`, 'Stack: MySQL, Redis'].join('\n');
    const line = addKeywords(text, [{ term: 'Rust' }]).text.split('\n').find((l) => l.includes('Rust'));
    assert.equal(line, 'Languages: PHP, Go, Rust', dates);
  }
});

test('with no skills section the keywords get one of their own, never a line inside a role', async () => {
  const { addKeywords } = await mod;
  const text = 'Jane Doe\n\nEXPERIENCE\nAcme Corp — Senior Engineer, 2020 – Present\n- Built full-stack checkout features\n- Led migration to AWS';
  const lines = addKeywords(text, [{ term: 'Kafka' }, { term: 'Redis' }]).text.split('\n');
  assert.deepEqual(lines.slice(0, 5), ['Jane Doe', '', 'SKILLS', 'Kafka, Redis', '']);
});

test('two last lines cut in a row come back in their own order, whichever is undone first', async () => {
  const { applyAll, addKeywords } = await mod;
  const { undoEdit } = await edits;
  const text = 'Jane Doe\nSKILLS\nLanguages: PHP, Go\nEXPERIENCE\nAcme | 2020 – Present\n• Built the API\nInterests: chess, hiking\nReferences available on request';
  const cards = applyAll(text, [
    { key: 'refs', kind: 'remove', quote: 'References available on request' },
    { key: 'int', kind: 'remove', quote: 'Interests: chess, hiking' },
  ]);
  const words = addKeywords(cards.text, [{ term: 'Rust', where: 'Skills' }]);
  const done = [...cards.done, ...words.done];
  for (const order of [['refs', 'int', 'kw:Rust'], ['int', 'refs', 'kw:Rust'], ['kw:Rust', 'refs', 'int']]) {
    let t = words.text;
    for (const key of order) {
      const back = undoEdit(t, done.find((d) => d.key === key)!.edit);
      assert.ok(!('error' in back), `${order.join(' → ')}: ${key}`);
      t = back.text;
    }
    assert.equal(t, text, order.join(' → '));
  }
});
