import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  daysSince,
  feedItemKey,
  normalizeTextKey,
  normalizeUrlKey,
  decideStageStrategy,
  extractAtsToken,
  extractJson,
  maskToken,
  parseTagList,
  toStringArray,
} from './text-utils';

describe('parseTagList', () => {
  it('splits by newline', () => {
    assert.deepEqual(parseTagList('php\nlaravel\nsymfony'), [
      'php',
      'laravel',
      'symfony',
    ]);
  });

  it('splits by comma', () => {
    assert.deepEqual(parseTagList('php, laravel, symfony'), [
      'php',
      'laravel',
      'symfony',
    ]);
  });

  it('handles mixed comma + newline', () => {
    assert.deepEqual(parseTagList('php, laravel\nsymfony,backend'), [
      'php',
      'laravel',
      'symfony',
      'backend',
    ]);
  });

  it('trims whitespace and drops empties', () => {
    assert.deepEqual(parseTagList('  php , ,\n   laravel\n  '), [
      'php',
      'laravel',
    ]);
  });

  it('preserves multi-word tags', () => {
    assert.deepEqual(parseTagList('full stack\nfull-stack'), [
      'full stack',
      'full-stack',
    ]);
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(parseTagList(''), []);
    assert.deepEqual(parseTagList('   \n   '), []);
  });
});

describe('toStringArray (form-field normaliser)', () => {
  it('returns [] for undefined', () => {
    assert.deepEqual(toStringArray(undefined), []);
  });

  it('returns [] for null', () => {
    assert.deepEqual(toStringArray(null), []);
  });

  it('returns [] for empty string', () => {
    assert.deepEqual(toStringArray(''), []);
  });

  it('wraps a single string into an array', () => {
    assert.deepEqual(toStringArray('senior'), ['senior']);
  });

  it('returns string[] as-is', () => {
    assert.deepEqual(toStringArray(['senior', 'staff', 'lead']), [
      'senior',
      'staff',
      'lead',
    ]);
  });

  it('filters non-string array entries', () => {
    assert.deepEqual(toStringArray(['ok', 1, true, null, 'fine']), [
      'ok',
      'fine',
    ]);
  });
});

describe('maskToken', () => {
  it('redacts very short tokens fully', () => {
    assert.equal(maskToken('abc'), '***');
    assert.equal(maskToken('123456789012'), '***');
  });

  it('shows only the last 4 for long tokens', () => {
    const t = '123456789012345abcdefghij6789';
    assert.equal(maskToken(t), '***6789');
  });

  it('never leaks the bot-id prefix of a Telegram token', () => {
    const t = '8557299558:AAGuiFakeTokenForTestingPurposesOnly1234XX';
    const masked = maskToken(t);
    assert.equal(masked, '***34XX');
    assert.ok(!masked.includes('8557299558'));
  });
});

describe('extractJson', () => {
  it('parses clean JSON', () => {
    assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  });

  it('strips leading commentary', () => {
    assert.deepEqual(
      extractJson('Here is the result:\n{"fit_score":85}'),
      { fit_score: 85 },
    );
  });

  it('strips trailing commentary', () => {
    assert.deepEqual(
      extractJson('{"a":1}\n\nHope this helps!'),
      { a: 1 },
    );
  });

  it('strips both leading and trailing prose', () => {
    assert.deepEqual(
      extractJson('Sure! {"x":2,"y":[1,2,3]} — let me know'),
      { x: 2, y: [1, 2, 3] },
    );
  });

  it('returns null for no JSON object', () => {
    assert.equal(extractJson('no json here'), null);
  });

  it('returns null for malformed JSON', () => {
    assert.equal(extractJson('{"unclosed": "string'), null);
    assert.equal(extractJson('{ not: "valid", json: 1 }'), null);
  });

  it('handles deeply nested objects', () => {
    assert.deepEqual(
      extractJson('text {"a":{"b":{"c":[1,2]}}} more'),
      { a: { b: { c: [1, 2] } } },
    );
  });
});

describe('decideStageStrategy', () => {
  it('returns run-stage1 for two_stage mode', () => {
    assert.equal(decideStageStrategy('two_stage'), 'run-stage1');
  });

  it('returns skip-stage1 for single mode', () => {
    assert.equal(decideStageStrategy('single'), 'skip-stage1');
  });
});

describe('extractAtsToken', () => {
  it('parses a greenhouse boards URL', () => {
    assert.deepEqual(
      extractAtsToken('https://boards.greenhouse.io/vimeo'),
      { atsType: 'GREENHOUSE', atsToken: 'vimeo' },
    );
  });

  it('parses a greenhouse embed URL', () => {
    assert.deepEqual(
      extractAtsToken('https://boards.greenhouse.io/embed/job_board?for=stripe'),
      { atsType: 'GREENHOUSE', atsToken: 'stripe' },
    );
  });

  it('parses a lever slug URL', () => {
    assert.deepEqual(extractAtsToken('https://jobs.lever.co/pleo/abc-def'), {
      atsType: 'LEVER',
      atsToken: 'pleo',
    });
  });

  it('parses an ashby org URL', () => {
    assert.deepEqual(extractAtsToken('https://jobs.ashbyhq.com/buffer/123-abc'), {
      atsType: 'ASHBY',
      atsToken: 'buffer',
    });
  });

  it('parses an ashby API URL too', () => {
    assert.deepEqual(
      extractAtsToken('https://api.ashbyhq.com/posting-api/job-board/scribdinc'),
      { atsType: 'ASHBY', atsToken: 'scribdinc' },
    );
  });

  it('lowercases the token', () => {
    assert.deepEqual(
      extractAtsToken('https://boards.greenhouse.io/Pantheon'),
      { atsType: 'GREENHOUSE', atsToken: 'pantheon' },
    );
  });

  it('returns null for non-ATS URLs', () => {
    assert.equal(
      extractAtsToken('https://example.com/jobs/senior-php'),
      null,
    );
    assert.equal(extractAtsToken(''), null);
    assert.equal(extractAtsToken('not a url'), null);
  });

  it('parses a Workable apply URL', () => {
    assert.deepEqual(
      extractAtsToken('https://apply.workable.com/thorlabs/'),
      { atsType: 'WORKABLE', atsToken: 'thorlabs' },
    );
  });

  it('parses a Workable job link', () => {
    assert.deepEqual(
      extractAtsToken('https://apply.workable.com/mlabs/j/8B6EA6A472/'),
      { atsType: 'WORKABLE', atsToken: 'mlabs' },
    );
  });

  it('parses a SmartRecruiters jobs URL (preserves case)', () => {
    assert.deepEqual(
      extractAtsToken('https://jobs.smartrecruiters.com/Visa/744000122509268'),
      { atsType: 'SMARTRECRUITERS', atsToken: 'Visa' },
    );
  });

  it('parses a SmartRecruiters careers URL', () => {
    assert.deepEqual(
      extractAtsToken('https://careers.smartrecruiters.com/SAP/'),
      { atsType: 'SMARTRECRUITERS', atsToken: 'SAP' },
    );
  });

  it('parses a SmartRecruiters API URL', () => {
    assert.deepEqual(
      extractAtsToken('https://api.smartrecruiters.com/v1/companies/Bosch/postings'),
      { atsType: 'SMARTRECRUITERS', atsToken: 'Bosch' },
    );
  });

  it('parses a Recruitee board subdomain', () => {
    assert.deepEqual(
      extractAtsToken('https://channable.recruitee.com/o/backend-engineer'),
      { atsType: 'RECRUITEE', atsToken: 'channable' },
    );
    assert.deepEqual(
      extractAtsToken('https://Tylko.recruitee.com/api/offers/'),
      { atsType: 'RECRUITEE', atsToken: 'tylko' },
    );
  });

  it('ignores Recruitee marketing subdomains', () => {
    assert.equal(extractAtsToken('https://www.recruitee.com/pricing'), null);
    assert.equal(
      extractAtsToken('https://careers.recruitee.com/anything'),
      null,
    );
  });

  it('parses a Breezy board URL', () => {
    assert.deepEqual(
      extractAtsToken('https://softwaremill.breezy.hr/p/abc-backend-engineer'),
      { atsType: 'BREEZY', atsToken: 'softwaremill' },
    );
    assert.equal(extractAtsToken('https://www.breezy.hr/hire'), null);
  });

  it('parses a BambooHR careers URL', () => {
    assert.deepEqual(
      extractAtsToken('https://canopy.bamboohr.com/careers/42'),
      { atsType: 'BAMBOOHR', atsToken: 'canopy' },
    );
    // Marketing pages don't have the /careers path.
    assert.equal(extractAtsToken('https://www.bamboohr.com/careers/'), null);
    assert.equal(extractAtsToken('https://canopy.bamboohr.com/jobs'), null);
  });

  it('parses a Pinpoint board URL', () => {
    assert.deepEqual(
      extractAtsToken('https://youlend.pinpointhq.com/en/postings/b03f1c2a'),
      { atsType: 'PINPOINT', atsToken: 'youlend' },
    );
    assert.equal(extractAtsToken('https://www.pinpointhq.com/'), null);
  });

  it('parses a Rippling ATS URL (board page and API)', () => {
    assert.deepEqual(
      extractAtsToken('https://ats.rippling.com/rippling/jobs/2f0674e6'),
      { atsType: 'RIPPLING', atsToken: 'rippling' },
    );
    assert.deepEqual(
      extractAtsToken('https://holidu.jobs.personio.de/job/2777239?language=en'),
      { atsType: 'PERSONIO', atsToken: 'holidu' },
    );
    assert.deepEqual(
      extractAtsToken('https://Ottonova.jobs.personio.com/'),
      { atsType: 'PERSONIO', atsToken: 'ottonova' },
    );
    assert.deepEqual(
      extractAtsToken(
        'https://api.rippling.com/platform/api/ats/v1/board/acme/jobs',
      ),
      { atsType: 'RIPPLING', atsToken: 'acme' },
    );
    assert.equal(extractAtsToken('https://www.rippling.com/careers'), null);
  });
});

describe('daysSince', () => {
  const NOW = new Date('2026-04-27T12:00:00Z');

  it('returns 0 for "right now"', () => {
    assert.equal(daysSince(new Date('2026-04-27T11:30:00Z'), NOW), 0);
  });

  it('returns 13 for 13 days, 12h ago', () => {
    assert.equal(daysSince(new Date('2026-04-13T23:59:00Z'), NOW), 13);
  });

  it('returns 14 for 14 days exactly', () => {
    assert.equal(daysSince(new Date('2026-04-13T12:00:00Z'), NOW), 14);
  });

  it('returns 15 for 15 days', () => {
    assert.equal(daysSince(new Date('2026-04-12T12:00:00Z'), NOW), 15);
  });
});

describe('url and text keys', () => {
  it('normalizeUrlKey strips tracking params but keeps functional ones', () => {
  assert.equal(
    normalizeUrlKey('https://job-boards.greenhouse.io/acme/jobs/42?gh_jid=42&utm_source=x&gh_src=abc'),
    'job-boards.greenhouse.io/acme/jobs/42?gh_jid=42',
  );
  assert.equal(
    normalizeUrlKey('http://block.xyz/careers/jobs/5367290008?gh_jid=5367290008'),
    'block.xyz/careers/jobs/5367290008?gh_jid=5367290008',
  );
  });

  it('normalizeUrlKey folds away differences that do not identify a posting', () => {
  const canonical = normalizeUrlKey('https://Example.com/jobs/7/?b=2&a=1');
  assert.equal(canonical, 'example.com/jobs/7?a=1&b=2');
  // Same posting, different ordering, trailing slash, fragment and campaign.
  assert.equal(normalizeUrlKey('https://example.com/jobs/7?a=1&b=2#apply'), canonical);
  assert.equal(normalizeUrlKey('https://example.com/jobs/7?utm_medium=cpc&b=2&a=1'), canonical);
  });

  it('normalizeUrlKey returns null for junk, never an empty string', () => {
  for (const junk of ['', '   ', 'n/a', 'N/A', 'javascript:alert(1)', null, undefined]) {
    assert.equal(normalizeUrlKey(junk), null, `expected null for ${JSON.stringify(junk)}`);
  }
  });

  it('normalizeTextKey keeps non-Latin names distinct', () => {
  assert.equal(normalizeTextKey('  Acme,  Inc. '), 'acme inc');
  assert.notEqual(normalizeTextKey('Розробник'), normalizeTextKey('Дизайнер'));
  assert.equal(normalizeTextKey('Розробник'), 'розробник');
  assert.equal(normalizeTextKey('株式会社テスト'), '株式会社テスト');
  // Precomposed letters survive: NFKC must not decompose-then-strip.
  assert.equal(normalizeTextKey('Żółć ėė'), 'żółć ėė');
  assert.equal(normalizeTextKey('!!!'), null);
  assert.equal(normalizeTextKey(''), null);
  });

  it('feedItemKey prefers the URL and falls back to text', () => {
  const withUrl = feedItemKey('https://example.com/jobs/7?utm_source=x', 'Title', 'Acme');
  assert.equal(withUrl, feedItemKey('https://example.com/jobs/7', 'Different', 'Names'));
  const fromText = feedItemKey('', 'Backend Engineer', 'Acme');
  assert.equal(fromText, feedItemKey(null, 'backend  engineer!', 'ACME'));
  assert.notEqual(fromText, withUrl);
  });

  it('feedItemKey returns null when nothing identifies the row', () => {
  assert.equal(feedItemKey('', '', ''), null);
  assert.equal(feedItemKey(null, null), null);
  assert.equal(feedItemKey('n/a', '!!!'), null);
  });

});
