import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_LINES, nameFromUrl, normaliseUrl, parseCompanyLines } from './parse-input';

describe('normaliseUrl', () => {
  it('adds https to a bare host', () => {
    assert.equal(normaliseUrl('www.acme.com/careers'), 'https://www.acme.com/careers');
    assert.equal(normaliseUrl('acme.com'), 'https://acme.com/');
  });

  it('keeps an explicit scheme', () => {
    assert.equal(normaliseUrl('http://acme.com/jobs'), 'http://acme.com/jobs');
  });

  it('strips trailing punctuation a paste picks up', () => {
    assert.equal(normaliseUrl('https://acme.com/careers.'), 'https://acme.com/careers');
    assert.equal(normaliseUrl('https://acme.com/careers,'), 'https://acme.com/careers');
  });

  it('refuses a hostname with no dot — "careers" is a typo, not a site', () => {
    assert.equal(normaliseUrl('careers'), null);
    assert.equal(normaliseUrl('open positions'), null);
    assert.equal(normaliseUrl(''), null);
  });
});

describe('parseCompanyLines', () => {
  it('reads one bare URL per line', () => {
    const { rows } = parseCompanyLines('https://vercel.com/careers\nhttps://linear.app/careers');
    assert.deepEqual(rows, [
      { name: null, url: 'https://vercel.com/careers' },
      { name: null, url: 'https://linear.app/careers' },
    ]);
  });

  it('reads every "Name <separator> URL" spelling', () => {
    const text = [
      'Vercel — https://vercel.com/careers',
      'Linear – https://linear.app/careers',
      'Sentry | https://sentry.io/careers/',
      'Fly.io, https://fly.io/jobs/',
      'Deno\thttps://deno.com/jobs',
      'Grafana Labs - https://grafana.com/about/careers',
    ].join('\n');
    assert.deepEqual(
      parseCompanyLines(text).rows.map((r) => r.name),
      ['Vercel', 'Linear', 'Sentry', 'Fly.io', 'Deno', 'Grafana Labs'],
    );
  });

  it('does not split a URL that contains a separator character', () => {
    const { rows } = parseCompanyLines('https://acme.com/careers?a=1,b=2');
    assert.deepEqual(rows, [{ name: null, url: 'https://acme.com/careers?a=1,b=2' }]);
  });

  it('skips blank lines and # comments', () => {
    const { rows } = parseCompanyLines('\n# my list\nhttps://acme.com/careers\n\n');
    assert.equal(rows.length, 1);
  });

  it('keeps lines with no URL apart, so the screen can name them', () => {
    const { rows, rejected } = parseCompanyLines('Acme\nhttps://acme.com/careers');
    assert.equal(rows.length, 1);
    assert.deepEqual(rejected, ['Acme']);
  });

  it('collapses two spellings of one page, keeping the first name', () => {
    const { rows } = parseCompanyLines(
      'Acme — https://www.acme.com/careers/\nSame place — https://acme.com/careers',
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.name, 'Acme');
  });

  it('stops at MAX_LINES and says so', () => {
    const text = Array.from({ length: MAX_LINES + 5 }, (_, i) => `https://acme${i}.com/careers`).join('\n');
    const { rows, truncated } = parseCompanyLines(text);
    assert.equal(rows.length, MAX_LINES);
    assert.equal(truncated, true);
  });
});

describe('nameFromUrl', () => {
  it('takes the first label that is not just "this is the careers site"', () => {
    assert.equal(nameFromUrl('https://www.netlify.com/careers/'), 'Netlify');
    assert.equal(nameFromUrl('https://careers.datadoghq.com/'), 'Datadoghq');
    assert.equal(nameFromUrl('https://jobs.ashbyhq.com/Linear'), 'Ashbyhq');
  });
});
