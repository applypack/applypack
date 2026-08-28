import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVerifyPrompt, parseVerifyResponse, readEvidence } from './prompts';

test('parseVerifyResponse accepts a full verdict after research prose', () => {
  const r = parseVerifyResponse(`I searched the careers page and LinkedIn.

{"verdict":"suspicious","recommendation":"caution","confidence":64,
 "summary":"Role is only on aggregators; company is real.",
 "evidence":[{"check":"careers_page","finding":"not listed on acme.com/careers","url":"https://acme.com/careers","signal":"ghost"},
             {"check":"linkedin","finding":"~120 employees","url":"https://linkedin.com/company/acme","signal":"legit"}],
 "red_flags":["aggregator-only listing (ghost)"],
 "company_snapshot":"Acme builds billing software; Series B."}`);
  assert.ok(r.ok);
  assert.equal(r.data.verdict, 'suspicious');
  assert.equal(r.data.evidence.length, 2);
  assert.equal(r.data.evidence[1]?.signal, 'legit');
});

test('parseVerifyResponse rejects unknown verdicts and tolerates missing optionals', () => {
  assert.equal(parseVerifyResponse('{"verdict":"maybe","recommendation":"apply","confidence":50,"summary":"x"}').ok, false);
  const minimal = parseVerifyResponse('{"verdict":"legit","recommendation":"apply","confidence":90,"summary":"ok"}');
  assert.ok(minimal.ok);
  assert.deepEqual(minimal.data.evidence, []);
  assert.equal(minimal.data.company_snapshot, null);
});

test('buildVerifyPrompt carries the posting facts and marks a missing URL', () => {
  const p = buildVerifyPrompt({
    title: 'Senior PHP Developer',
    companyName: 'Acme',
    location: '',
    url: '',
    description: 'We need PHP.',
    postedAt: new Date('2026-08-28T10:00:00Z'),
  });
  assert.match(p.user, /Company: Acme/);
  assert.match(p.user, /pasted by hand/);
  assert.match(p.user, /Seen on: 2026-08-28/);
  assert.match(p.system, /HARD SCAM FLAGS/);
});

test('readEvidence falls back to an empty list on bad stored data', () => {
  assert.deepEqual(readEvidence({ nope: true }), []);
  assert.equal(readEvidence([{ check: 'salary', finding: 'none listed', url: null, signal: 'ghost' }]).length, 1);
});
