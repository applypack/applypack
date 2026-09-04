import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeMarkdownV2,
  escapeMarkdownV2Url,
  formatJobMessage,
  formatPlaceLine,
  formatSalary,
  formatSourceHealthLine,
} from './notifier';

describe('formatSalary', () => {
  it('returns em-dash when both bounds are null', () => {
    assert.equal(formatSalary(null, null), '—');
  });

  it('formats a closed range', () => {
    assert.equal(formatSalary(140000, 180000), '$140k-$180k');
  });

  it('formats min-only as $Nk+', () => {
    assert.equal(formatSalary(150000, null), '$150k+');
  });

  it('formats max-only as "up to $Nk"', () => {
    assert.equal(formatSalary(null, 200000), 'up to $200k');
  });

  it('rounds to nearest thousand', () => {
    assert.equal(formatSalary(149500, 150500), '$150k-$151k');
  });
});

describe('escapeMarkdownV2', () => {
  it('escapes all reserved MarkdownV2 characters', () => {
    const reserved = '_*[]()~`>#+-=|{}.!\\';
    const out = escapeMarkdownV2(reserved);
    // Each reserved char must be preceded by a backslash.
    for (const c of reserved) {
      assert.ok(out.includes(`\\${c}`), `missing escape for "${c}" in "${out}"`);
    }
  });

  it('passes through normal text unchanged', () => {
    assert.equal(escapeMarkdownV2('Senior PHP Engineer'), 'Senior PHP Engineer');
  });

  it('escapes a single dot (common Telegram footgun)', () => {
    assert.equal(escapeMarkdownV2('5.0'), '5\\.0');
  });

  it('handles parentheses correctly', () => {
    assert.equal(escapeMarkdownV2('Square (Block)'), 'Square \\(Block\\)');
  });

  it('escapes pre-existing backslashes', () => {
    assert.equal(escapeMarkdownV2('a\\b'), 'a\\\\b');
  });
});

describe('escapeMarkdownV2Url', () => {
  it('escapes only ) and \\ — not the rest', () => {
    assert.equal(
      escapeMarkdownV2Url('https://example.com/jobs?id=1&q=php'),
      'https://example.com/jobs?id=1&q=php',
    );
  });

  it('escapes a closing parenthesis in a URL', () => {
    assert.equal(
      escapeMarkdownV2Url('https://example.com/jobs/(test)'),
      'https://example.com/jobs/(test\\)',
    );
  });

  it('escapes a backslash in a URL', () => {
    assert.equal(
      escapeMarkdownV2Url('https://example.com/a\\b'),
      'https://example.com/a\\\\b',
    );
  });
});

describe('formatJobMessage', () => {
  const base = {
    title: 'Senior Engineer',
    companyName: 'Acme',
    location: 'Remote',
    url: 'https://example.com/jobs/1',
    fitScore: 88,
    salaryMin: null,
    salaryMax: null,
    techMatch: [],
    redFlags: [],
    summary: '',
  };

  it('omits the cross-listing line when there is none', () => {
    assert.equal(formatJobMessage(base).includes('Also listed at'), false);
    assert.equal(
      formatJobMessage({ ...base, crossListedAt: null }).includes('Also listed at'),
      false,
    );
  });

  it('escapes the hyphens in apply-link flags', () => {
    // Every red flag is kebab-case and MarkdownV2 treats "-" as reserved, so
    // one unescaped hyphen makes Telegram reject the whole alert.
    const msg = formatJobMessage({
      ...base,
      redFlags: ['stack-mismatch', 'apply-url-not-an-application'],
    });
    assert.match(msg, /Flags: stack\\-mismatch, apply\\-url\\-not\\-an\\-application/);
  });

  it('escapes the cross-listed company name', () => {
    // Parentheses, dots and hyphens all need escaping in MarkdownV2 — an
    // unescaped one makes Telegram reject the entire message.
    const msg = formatJobMessage({ ...base, crossListedAt: 'Acme (US) Inc. - Jobs' });
    assert.match(msg, /Also listed at Acme \\\(US\\\) Inc\\\. \\- Jobs/);
    assert.match(msg, /apply through one channel only/);
  });
});

describe('formatSourceHealthLine', () => {
  it('is empty when nothing is quiet, so the digest gains no line', () => {
    assert.equal(formatSourceHealthLine([]), '');
  });

  it('names the source, its vendor and the streak', () => {
    const line = formatSourceHealthLine([
      { name: 'Pleo', atsType: 'GREENHOUSE', status: 'slug_gone', streak: 4 },
    ]);
    assert.match(line, /1 quiet source\*/);
    assert.match(line, /Pleo/);
    assert.match(line, /GREENHOUSE/);
    assert.match(line, /slug not found/);
    assert.match(line, /4/);
  });

  it('pluralises and joins several sources', () => {
    const line = formatSourceHealthLine([
      { name: 'Pleo', atsType: 'GREENHOUSE', status: 'slug_gone', streak: 4 },
      { name: 'Plaid', atsType: 'LEVER', status: 'slug_gone', streak: 3 },
    ]);
    assert.match(line, /2 quiet sources\*/);
    assert.match(line, /Pleo.*Plaid/);
  });

  it('escapes MarkdownV2 in the company name and the parenthesised detail', () => {
    const line = formatSourceHealthLine([
      { name: 'Acme (EU) - Ltd.', atsType: 'LEVER', status: 'rate_limit', streak: 3 },
    ]);
    assert.match(line, /Acme \\\(EU\\\) \\- Ltd\\\./);
    // The literal parens we add around the detail are escaped too.
    assert.ok(!/[^\\]\(GREENHOUSE|[^\\]\(LEVER/.test(line));
  });

  it('never calls a rate limit a dead slug', () => {
    const line = formatSourceHealthLine([
      { name: 'X', atsType: 'WORKABLE', status: 'rate_limit', streak: 3 },
    ]);
    assert.match(line, /rate\\-limited/);
    assert.doesNotMatch(line, /slug not found/);
  });

  it('caps the list so a total outage cannot overflow the message limit', () => {
    const many = Array.from({ length: 71 }, (_, i) => ({
      name: `Company number ${i}`,
      atsType: 'GREENHOUSE',
      status: 'network',
      streak: 3,
    }));
    const line = formatSourceHealthLine(many);
    assert.match(line, /71 quiet sources\*/);
    assert.match(line, /and 63 more/);
    assert.ok(line.length < 1000, `line was ${line.length} chars`);
  });

  it('names every source when there are few enough', () => {
    const few = Array.from({ length: 8 }, (_, i) => ({
      name: `C${i}`,
      atsType: 'LEVER',
      status: 'slug_gone',
      streak: 3,
    }));
    assert.doesNotMatch(formatSourceHealthLine(few), /more/);
  });

  it('renders a status it has never seen without crashing', () => {
    const line = formatSourceHealthLine([
      { name: 'X', atsType: 'ASHBY', status: null, streak: 3 },
    ]);
    assert.match(line, /not fetched yet/);
  });
});

describe('formatPlaceLine', () => {
  const base = {
    title: 't', companyName: 'c', location: '', url: 'u', fitScore: 90,
    salaryMin: null, salaryMax: null, techMatch: [], redFlags: [], summary: '',
  };

  it('carries the flags and adds the arrangement the words do not say (ADR 0033)', () => {
    assert.equal(
      formatPlaceLine({ ...base, location: 'Hybrid · Berlin, Germany', countries: ['DE'], workplace: 'HYBRID' }),
      '🇩🇪 Hybrid · Berlin, Germany',
    );
    assert.equal(
      formatPlaceLine({ ...base, location: 'Kyiv, Ukraine', countries: ['UA'], workplace: 'HYBRID' }),
      '🇺🇦 Kyiv, Ukraine · hybrid',
    );
    assert.equal(
      formatPlaceLine({ ...base, location: 'Remote', countries: ['PL', 'DE'], workplace: 'REMOTE' }),
      '🇵🇱🇩🇪 Remote',
    );
  });

  it('falls back to the arrangement, then to Remote, when the posting names no place', () => {
    assert.equal(formatPlaceLine({ ...base, location: '', countries: [], workplace: 'ONSITE' }), 'On-site');
    assert.equal(formatPlaceLine({ ...base, location: '', countries: [], workplace: 'UNKNOWN' }), 'Remote');
    assert.equal(formatPlaceLine({ ...base, location: 'Anywhere' }), 'Anywhere');
  });
});
