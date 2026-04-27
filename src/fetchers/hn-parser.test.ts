import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseHnComment } from './hn-parser';

describe('parseHnComment — pipe format (most common)', () => {
  it('parses Company | Role | Location | URL', () => {
    const out = parseHnComment(
      'Stripe | Senior PHP Engineer | SF, Remote-US | https://stripe.com/jobs/123',
    );
    assert.ok(out !== null);
    assert.equal(out!.companyName, 'Stripe');
    assert.equal(out!.title, 'Senior PHP Engineer');
    assert.equal(out!.location, 'SF, Remote-US');
    assert.equal(out!.url, 'https://stripe.com/jobs/123');
  });

  it('parses with em-dash separators', () => {
    const out = parseHnComment(
      'PrairieLearn — Full-Stack Software Engineer — TypeScript / Postgres / React / AI',
    );
    assert.ok(out !== null);
    assert.equal(out!.companyName, 'PrairieLearn');
    assert.equal(out!.title, 'Full-Stack Software Engineer');
  });

  it('treats leading role-like field as title with no company', () => {
    const out = parseHnComment(
      'Head of Engineering & Infrastructure | Full-Time | Remote | $182k - $272k USD - https://fetlife.com/jobs/x',
    );
    assert.ok(out !== null);
    assert.equal(out!.companyName, null);
    assert.equal(out!.title, 'Head of Engineering & Infrastructure');
    assert.equal(out!.location, 'Full-Time');
  });

  it('extracts URL from anywhere in the text', () => {
    const out = parseHnComment(
      'WireScreen | Senior Product Manager | NYC - hybrid | $175k-$215k base + equity | https://jobs.ashbyhq.com/wirescreen/abc123',
    );
    assert.ok(out !== null);
    assert.equal(out!.url, 'https://jobs.ashbyhq.com/wirescreen/abc123');
  });

  it('strips trailing punctuation from URL', () => {
    const out = parseHnComment(
      'Acme | Engineer | Remote | https://example.com/jobs/1.',
    );
    assert.ok(out !== null);
    assert.equal(out!.url, 'https://example.com/jobs/1');
  });
});

describe('parseHnComment — "is hiring" prose format', () => {
  it('extracts company from "Acme is hiring …"', () => {
    const out = parseHnComment(
      'We at Acme Robotics are hiring senior backend engineers. Stack is Laravel/PHP. https://acme.io/jobs',
    );
    assert.ok(out !== null);
    assert.equal(out!.companyName, 'Acme Robotics');
    assert.match(out!.title, /senior backend engineers/i);
    assert.equal(out!.url, 'https://acme.io/jobs');
  });
});

describe('parseHnComment — bail-out cases', () => {
  it('returns null on empty input', () => {
    assert.equal(parseHnComment(''), null);
  });

  it('returns null on whitespace-only', () => {
    assert.equal(parseHnComment('   \n  '), null);
  });

  it('returns null on prose with no recognisable structure', () => {
    assert.equal(
      parseHnComment('Just some random thoughts about the job market in 2026.'),
      null,
    );
  });

  it('returns null on a comment that mentions hiring but has no clear company', () => {
    // No capitalized company-like phrase before "are hiring"
    assert.equal(parseHnComment('we are hiring people'), null);
  });
});

describe('parseHnComment — robustness', () => {
  it('keeps the first ~1000 chars in rawText', () => {
    const long = 'Acme | Senior PHP | Remote | ' + 'x'.repeat(5000);
    const out = parseHnComment(long);
    assert.ok(out !== null);
    assert.ok(out!.rawText.length <= 1000);
  });

  it('handles already-cleaned text from stripHtml', () => {
    const out = parseHnComment(
      'Stripe | Senior PHP Engineer | SF Remote-US | https://stripe.com',
    );
    assert.ok(out !== null);
    assert.equal(out!.title, 'Senior PHP Engineer');
  });
});
