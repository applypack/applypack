import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postingDepth } from './brief-depth';
import { BriefSchema } from './prompts';

const brief = (over: Record<string, unknown>) =>
  BriefSchema.parse({ role: { posted_title: 'Dev', family: 'web' }, ...over });

const term = (n: number, requirement = 'must') =>
  Array.from({ length: n }, (_, i) => ({ term: `T${i}`, priority: 1, requirement, primary: false, aliases: [] }));

test('a posting that names everything is not hedged', () => {
  const d = postingDepth(
    brief({
      role: { posted_title: 'Dev', family: 'web', seniority: 'senior', years_min: 5 },
      company: { industry: 'fintech' },
      keywords: term(10),
      gates: ['US work authorization'],
      screening: { reader: 'x', scan_for: ['a', 'b', 'c'] },
    }),
  );
  assert.equal(d.depth, 'high');
  assert.equal(d.notice, null, 'nothing to warn about');
});

test('"Golang dev with AI experience" is read as what it is', () => {
  const d = postingDepth(brief({ keywords: term(2) }));
  assert.equal(d.depth, 'low');
  assert.match(d.notice ?? '', /says very little/);
  assert.match(d.notice ?? '', /not from the employer/);
});

test('a half-written posting says where the rest of the advice came from', () => {
  const d = postingDepth(
    brief({
      role: { posted_title: 'Dev', family: 'web', seniority: 'mid' },
      keywords: term(5),
      gates: [],
      // Every real brief carries these; what this posting lacks is requirements.
      screening: { reader: 'x', scan_for: ['a', 'b', 'c'] },
    }),
  );
  assert.equal(d.depth, 'medium');
  assert.match(d.notice ?? '', /not as things the employer demanded/);
});

test('no brief says nothing: unread is not the same as thin', () => {
  // A stale brief version or a failed call must not put a warning about the
  // employer's posting on a page that simply has not read it yet.
  assert.equal(postingDepth(null).notice, null);
  assert.equal(postingDepth(null).depth, 'low');
  assert.equal(postingDepth(undefined).signals, 0);
});

test('context-level mentions do not make a posting look detailed', () => {
  // "we use X" is not a requirement — a posting of nothing but those is thin.
  const d = postingDepth(brief({ keywords: term(12, 'context') }));
  assert.equal(d.depth, 'low');
});
