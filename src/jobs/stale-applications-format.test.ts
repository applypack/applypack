import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatStaleMessage,
  type StaleApplicationItem,
} from './stale-applications-format';

const sample: StaleApplicationItem = {
  title: 'Senior PHP Engineer',
  companyName: 'Acme',
  url: 'https://example.com/jobs/1',
  appliedAt: new Date('2026-04-10T10:00:00Z'),
  daysSince: 17,
  recruiterContact: null,
  appliedWith: null,
};

describe('formatStaleMessage', () => {
  it('returns a placeholder for empty input', () => {
    assert.equal(formatStaleMessage([]), '_No stale applications._');
  });

  it('formats a single stale item with no recruiter', () => {
    const out = formatStaleMessage([sample]);
    assert.match(out, /^\*Stale applications — 1 need a follow-up\*/);
    assert.match(out, /Senior PHP Engineer/);
    assert.match(out, /17d ago/);
    assert.doesNotMatch(out, /last contact/);
  });

  it('includes recruiter contact when present', () => {
    const out = formatStaleMessage([
      { ...sample, recruiterContact: 'jane@acme.com' },
    ]);
    assert.match(out, /last contact: jane@acme\.com/);
  });

  it('handles multiple items as bullet list', () => {
    const out = formatStaleMessage([
      sample,
      { ...sample, title: 'Staff Backend Eng', companyName: 'Globex', daysSince: 21 },
    ]);
    assert.match(out, /2 need a follow-up/);
    assert.match(out, /Senior PHP Engineer/);
    assert.match(out, /Staff Backend Eng/);
    assert.match(out, /21d ago/);
  });
});

describe('formatStaleMessage — applied with', () => {
  it('names the resume the application went out with', () => {
    const out = formatStaleMessage([
      { ...sample, appliedWith: 'Senior Backend v3' },
    ]);
    assert.match(out, /applied 17d ago with Senior Backend v3/);
  });

  it('says nothing extra when no resume was recorded', () => {
    assert.match(formatStaleMessage([sample]), /applied 17d ago$/m);
  });

  it('keeps the resume ahead of the recruiter note', () => {
    const out = formatStaleMessage([
      { ...sample, appliedWith: 'Senior Backend v3', recruiterContact: 'jane@acme.com' },
    ]);
    assert.match(out, /with Senior Backend v3 \(last contact: jane@acme\.com\)/);
  });
});
