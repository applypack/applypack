import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verificationCautions, verificationHint } from './verification-hint';

// The live row from the issue: suspicious / caution / 72 %, one ghost flag.
const LIVE = {
  recommendation: 'caution',
  confidence: 72,
  redFlags: ['the posting cannot be found on any public board'],
  evidence: [
    { check: 'careers_page', finding: 'No careers page lists this role', url: null, signal: 'ghost' },
    { check: 'posting_quality', finding: 'Generic copy-paste text with no team named', url: null, signal: 'ghost' },
    { check: 'reputation', finding: 'Well-reviewed company', url: 'https://example.com', signal: 'legit' },
  ],
};

test('caution reads as "a quick check is enough", with the first flag', () => {
  const h = verificationHint(LIVE);
  assert.equal(h.tone, 'warn');
  assert.equal(h.text, 'Verification says apply with caution (72 %): the posting cannot be found on any public board. A quick check is enough here.');
});

test('skip warns but does not forbid; apply is one short line', () => {
  const skip = verificationHint({ ...LIVE, recommendation: 'skip', redFlags: [], confidence: 88.4 });
  assert.equal(skip.tone, 'danger');
  assert.match(skip.text, /^Verification says skip \(88 %\): No careers page lists this role\./);
  assert.match(skip.text, /Compare still works/);
  assert.deepEqual(verificationHint({ ...LIVE, recommendation: 'apply', redFlags: [], evidence: [], confidence: 92 }), {
    tone: 'ok',
    text: 'Verification says worth applying (92 %).',
  });
});

test('the cautions carry the red flags and a bad reading of the posting text, labelled and capped', () => {
  assert.deepEqual(verificationCautions(LIVE), [
    'From verification: the posting cannot be found on any public board',
    'From verification (posting quality): Generic copy-paste text with no team named',
  ]);
  const many = { ...LIVE, redFlags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] };
  assert.equal(verificationCautions(many).length, 5);
  assert.deepEqual(verificationCautions({ ...LIVE, redFlags: [], evidence: [] }), []);
});
