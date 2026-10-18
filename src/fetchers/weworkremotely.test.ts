import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapWwrItem, wwrEmployer, wwrRole, type WwrItem } from './weworkremotely';
import { feedEntryId } from '../text-utils';

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

describe('wwrEmployer', () => {
  it('reads the company off the "Company: Role" title', () => {
    assert.equal(mustMap(item()).employer, 'Collaboration.Ai');
    assert.equal(wwrEmployer('Acme Inc: Staff Engineer'), 'Acme Inc');
    assert.equal(wwrEmployer('Staff Engineer'), null);
    assert.equal(wwrEmployer(': Staff Engineer'), null);
  });
});

describe('wwrRole', () => {
  it('drops the company the title opens with, which the row shows beside it', () => {
    assert.equal(mustMap(item()).title, 'Senior Software AI Engineer');
    assert.equal(wwrRole('Vercel: Software Engineer, Backend'), 'Software Engineer, Backend');
    assert.equal(wwrRole('Acme: Engineer: Payments'), 'Engineer: Payments');
  });

  it('keeps a title that names nobody, and the id the full title made', () => {
    assert.equal(wwrRole('Staff Engineer'), 'Staff Engineer');
    assert.equal(wwrRole(': Staff Engineer'), ': Staff Engineer');
    // A row with no link is keyed by its text: still the feed's own title, so stored rows keep their id.
    assert.equal(mapWwrItem({ title: 'Acme: Engineer' }, COMPANY_ID)?.externalId, feedEntryId(undefined, '', 'Acme: Engineer'));
  });
});
