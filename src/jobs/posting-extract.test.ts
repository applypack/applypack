import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExtractPrompt, parseExtractReply } from './posting-extract';

test('buildExtractPrompt truncates the description to the posting head', () => {
  const { system, user } = buildExtractPrompt('x'.repeat(10_000));
  assert.equal(user.length, 3500);
  assert.match(system, /ONLY JSON/);
});

test('parseExtractReply reads clean and fenced replies, trims, nulls empties', () => {
  assert.deepEqual(
    parseExtractReply('{"company":" Acme Corp ","title":"Senior PHP Developer","location":null}'),
    { company: 'Acme Corp', title: 'Senior PHP Developer', location: null },
  );
  assert.deepEqual(
    parseExtractReply('Sure! ```json\n{"company":"Acme","title":null,"location":"  "}\n```'),
    { company: 'Acme', title: null, location: null },
  );
});

test('parseExtractReply rejects garbage instead of guessing', () => {
  assert.equal(parseExtractReply('no json here'), null);
  assert.equal(parseExtractReply('{"company": 42, "title": [], "location": {}}'), null);
});

test('parseExtractReply caps runaway field lengths', () => {
  const long = 'A'.repeat(500);
  const facts = parseExtractReply(`{"company":"${long}","title":"ok","location":null}`);
  assert.equal(facts?.company?.length, 200);
});
