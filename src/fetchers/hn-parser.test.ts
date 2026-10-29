import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseHnComment } from './hn-parser';
import headers from './hn-headers.json';

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

  it('keeps a salary range whole: a bare en-dash is a range, a spaced one a separator', () => {
    const out = parseHnComment('Acme | Senior Backend Engineer | Remote (EU) | $120–160k | https://acme.example/jobs');
    assert.equal(out?.companyName, 'Acme');
    assert.equal(out?.title, 'Senior Backend Engineer');
    assert.equal(out?.location, 'Remote (EU)');
    const spaced = parseHnComment('Acme – Platform Engineer – Berlin');
    assert.equal(spaced?.title, 'Platform Engineer');
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
    assert.equal(out!.location, 'Remote');
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

  // Regression: real HN comments sometimes omit the leading whitespace
  // around the first pipe, e.g. "SPADE Agriculture| Full Stack Engineer".
  // Splitter must still split on those pipes.
  it('splits "Foo| Bar | Baz" without leading whitespace before the first pipe', () => {
    const out = parseHnComment(
      'SPADE Agriculture| Full Stack Engineer | https://spade.ag | Remote (US Timezones)',
    );
    assert.ok(out !== null);
    assert.equal(out!.companyName, 'SPADE Agriculture');
    assert.equal(out!.title, 'Full Stack Engineer');
    assert.equal(out!.url, 'https://spade.ag');
  });

  // Regression: prose with "Sumble is the newco from … We are hiring …"
  // should NOT capture half-a-paragraph as the company, and the bare
  // pronoun "We" picked up at a later anchor must also be rejected.
  it('refuses to span a sentence boundary or capture a bare pronoun', () => {
    const out = parseHnComment(
      'Sumble is the newco from the founders of Kaggle. We are hiring full stack engineers.',
    );
    // Either null, or company is just "Sumble" — what we MUST NOT see is
    // "Sumble is the newco …" eaten as the company name, nor the bare
    // pronoun "We".
    if (out !== null && out.companyName !== null) {
      assert.ok(
        !out.companyName.includes('newco'),
        `company should not span sentence: got "${out.companyName}"`,
      );
      assert.notEqual(out.companyName, 'We');
    }
  });

  it('still matches "Acme Inc. is hiring …" (period in company name)', () => {
    const out = parseHnComment('Acme Inc. is hiring Senior PHP Engineers.');
    assert.ok(out !== null);
    assert.equal(out!.companyName, 'Acme Inc.');
    assert.match(out!.title, /Senior PHP Engineers/);
  });

  // #541: this comment became a job titled with the whole line, scored by a model.
  it('never takes a link for the title: it takes the next field, or drops the comment', () => {
    assert.equal(
      parseHnComment(
        '3Gimbals | https://www.linkedin.com/jobs/view/4477632187 (US/Remote) Hiring entry / mid-level software engineers to build data products for defense customers.',
      ),
      null,
    );
    const out = parseHnComment('Acme | https://acme.example/jobs | Senior Backend Engineer | Remote (EU)');
    assert.ok(out !== null);
    assert.equal(out!.companyName, 'Acme');
    assert.equal(out!.title, 'Senior Backend Engineer');
    assert.equal(out!.location, 'Remote (EU)');
    assert.equal(out!.url, 'https://acme.example/jobs');
  });

  it('skips URL-shaped fields when picking the location', () => {
    const out = parseHnComment(
      'Foo Corp | Senior PHP | https://foo.example | Remote, US',
    );
    assert.ok(out !== null);
    assert.equal(out!.location, 'Remote, US');
    assert.equal(out!.url, 'https://foo.example');
  });
});

// #660: one month's headers, read by position, made 65 of 240 titles a place
// or "Full Time". Each field is recognised by what it is instead.
describe('parseHnComment — fields in any order (October 2026 thread)', () => {
  for (const row of headers.rows) {
    it(`${row.id}: ${row.text.split('\n')[0]!.slice(0, 60)}`, () => {
      const out = parseHnComment(row.text);
      if (row.expect === null) return assert.equal(out, null);
      assert.ok(out !== null);
      assert.deepEqual({ companyName: out.companyName, title: out.title, location: out.location }, row.expect);
    });
  }
});

describe('parseHnComment — what a field is', () => {
  it('never takes a place, a type or pay for the title, wherever the role stands', () => {
    const out = parseHnComment('OpenRent | London, UK | Full-Time | ONSITE+PART REMOTE | Senior Full-Stack Engineer | £110k+');
    assert.equal(out?.title, 'Senior Full-Stack Engineer');
    assert.equal(out?.location, 'London, UK · ONSITE+PART REMOTE');
  });

  it('drops a header that names no role, with no role listed below it', () => {
    assert.equal(parseHnComment('OpenRent | London, UK | Full-Time | ONSITE\nWhat sucked the last time you rented a flat?'), null);
  });

  it('reads the roles a header leaves out from the lines below it, never from prose', () => {
    const out = parseHnComment(
      [
        'OpenRent | London, UK | Full-Time | ONSITE',
        "We're looking for engineers who care about renters.",
        'Roles currently available:',
        '- Senior Full-Stack Engineer | 110k+ (based on experience)',
        '* Product Designer (Remote): https://example.com/jobs/2',
      ].join('\n'),
    );
    assert.equal(out?.title, 'Senior Full-Stack Engineer · Product Designer');
  });

  it('takes the link and the note in brackets off the company, and keeps a place note as the location', () => {
    const out = parseHnComment('Flowstate (London, UK) — Founding Engineer — TypeScript / React / Postgres / AI');
    assert.equal(out?.companyName, 'Flowstate');
    assert.equal(out?.location, 'London, UK');
    assert.equal(parseHnComment('Snout https://snout.com/ | Software Engineer | Remote US')?.companyName, 'Snout');
  });

  it('reads "engineering" and "a leading firm" as a line of work, not a role', () => {
    const out = parseHnComment('Acme | Senior Backend Engineer | 35 headcount, ~10 in engineering | Relocation Acme is a leading firm');
    assert.equal(out?.title, 'Senior Backend Engineer');
  });

  it('cuts a header the poster ran on into the prose', () => {
    const out = parseHnComment('Acme Labs | Data Engineer | Berlin, Germany Acme builds tools for farmers and has 40 people.');
    assert.equal(out?.location, 'Berlin, Germany');
    const opener = parseHnComment("Acme | Data Engineer | Remote (EU) I'm Ana, the CTO, and I read every email.");
    assert.equal(opener?.location, 'Remote (EU)');
  });
});
