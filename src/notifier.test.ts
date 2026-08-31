import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeMarkdownV2,
  escapeMarkdownV2Url,
  formatJobMessage,
  formatSalary,
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

  it('escapes the cross-listed company name', () => {
    // Parentheses, dots and hyphens all need escaping in MarkdownV2 — an
    // unescaped one makes Telegram reject the entire message.
    const msg = formatJobMessage({ ...base, crossListedAt: 'Acme (US) Inc. - Jobs' });
    assert.match(msg, /Also listed at Acme \\\(US\\\) Inc\\\. \\- Jobs/);
    assert.match(msg, /apply through one channel only/);
  });
});
