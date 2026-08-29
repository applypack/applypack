import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExtractPrompt, parseExtractReply } from './posting-extract';

test('buildExtractPrompt truncates the description to the posting head', () => {
  const { system, user } = buildExtractPrompt('x'.repeat(10_000));
  assert.equal(user.length, 3500);
  assert.match(system, /ONLY JSON/);
  assert.match(system, /salary_min/);
  assert.match(system, /"remote"\|"hybrid"\|"onsite"/);
});

test('parseExtractReply reads clean and fenced replies, trims, nulls empties', () => {
  assert.deepEqual(
    parseExtractReply(
      '{"company":" Acme Corp ","title":"Senior PHP Developer","location":null,"salary_min":120000,"salary_max":160000,"workplace":"remote"}',
    ),
    {
      company: 'Acme Corp',
      title: 'Senior PHP Developer',
      location: null,
      salaryMin: 120000,
      salaryMax: 160000,
      workplace: 'remote',
    },
  );
  assert.deepEqual(
    parseExtractReply('Sure! ```json\n{"company":"Acme","title":null,"location":"  "}\n```'),
    { company: 'Acme', title: null, location: null, salaryMin: null, salaryMax: null, workplace: null },
  );
});

test('parseExtractReply rejects garbage instead of guessing', () => {
  assert.equal(parseExtractReply('no json here'), null);
  assert.equal(parseExtractReply('{"company": 42, "title": [], "location": {}}'), null);
});

test('parseExtractReply sanitises salary and workplace', () => {
  const offList = parseExtractReply(
    '{"company":"A","title":"B","location":null,"salary_min":160000,"salary_max":120000,"workplace":"office"}',
  );
  assert.equal(offList?.workplace, null, 'an off-list workplace degrades to null');
  assert.equal(offList?.salaryMin, 120000, 'a reversed range is swapped');
  assert.equal(offList?.salaryMax, 160000);
  const junk = parseExtractReply(
    '{"company":"A","title":"B","location":null,"salary_min":-5,"salary_max":99999999,"workplace":"hybrid"}',
  );
  assert.deepEqual([junk?.salaryMin, junk?.salaryMax, junk?.workplace], [null, null, 'hybrid']);
});

test('parseExtractReply caps runaway field lengths', () => {
  const long = 'A'.repeat(500);
  const facts = parseExtractReply(`{"company":"${long}","title":"ok","location":null}`);
  assert.equal(facts?.company?.length, 200);
});
