import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapWwrItem, type WwrItem } from './weworkremotely';

const COMPANY_ID = 617;

// Recorded from the back-end-programming feed on 2026-09-03.
const item = (overrides: Partial<WwrItem> = {}): WwrItem => ({
  title: 'Collaboration.Ai: Senior Software AI Engineer',
  link: 'https://weworkremotely.com/remote-jobs/collaboration-ai-senior-software-ai-engineer',
  guid: 'https://weworkremotely.com/remote-jobs/collaboration-ai-senior-software-ai-engineer',
  pubDate: 'Tue, 02 Sep 2026 14:03:11 +0000',
  contentSnippet: 'Build agentic workflows.',
  region: 'Anywhere in the World',
  country: '🇺🇸 United States of America',
  ...overrides,
});

const mustMap = (i: WwrItem) => {
  const job = mapWwrItem(i, COMPANY_ID);
  assert.ok(job);
  return job;
};

describe('mapWwrItem', () => {
  it('reads the <country> allow-list into the hints and the string', () => {
    const job = mustMap(item());
    assert.equal(job.location, 'Remote · 🇺🇸 United States of America');
    assert.deepEqual(job.locationHints, { workplace: 'REMOTE', countries: ['US'], regions: [] });
  });

  it('falls back to <region> when the country list is empty', () => {
    const job = mustMap(item({ country: '' }));
    assert.equal(job.location, 'Remote · Anywhere in the World');
    assert.deepEqual(job.locationHints, { workplace: 'REMOTE', countries: [], regions: ['WORLDWIDE'] });
    assert.deepEqual(mustMap(item({ country: '', region: 'USA Only' })).locationHints, {
      workplace: 'REMOTE',
      countries: ['US'],
      regions: [],
    });
  });

  it('keeps a long allow-list in the hints only', () => {
    const country = ['🇵🇱 Poland', '🇷🇴 Romania', '🇺🇦 Ukraine', '🇩🇪 Germany', '🇫🇷 France', '🇪🇸 Spain', '🇵🇹 Portugal', '🇮🇹 Italy', '🇳🇱 Netherlands', '🇧🇪 Belgium', '🇨🇿 Czechia']
      .join(', ');
    const job = mustMap(item({ country }));
    assert.equal(job.location, 'Remote · Anywhere in the World');
    assert.deepEqual(job.locationHints?.countries, ['PL', 'RO', 'UA', 'DE', 'FR', 'ES', 'PT', 'IT', 'NL', 'BE', 'CZ']);
  });

  it('is plain "Remote" when the feed says nothing', () => {
    const job = mustMap(item({ country: '', region: '' }));
    assert.equal(job.location, 'Remote');
    assert.deepEqual(job.locationHints, { workplace: 'REMOTE', countries: [], regions: [] });
  });

  it('skips an item nothing identifies', () => {
    assert.equal(mapWwrItem({ title: '' }, COMPANY_ID), null);
  });
});
