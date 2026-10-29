import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveLocation, mapGolangProjectsItem, splitGolangTitle } from './golangprojects';

// Recorded from rss.xml on 2026-09-03 — no flag emoji in any title any more.
const BASE = 'https://www.golangprojects.com/';

describe('deriveLocation', () => {
  it('reads the region words that precede the title in the slug', () => {
    assert.equal(
      deriveLocation(
        'Senior Backend Engineer - Build AI Agents @ Salesforge',
        `${BASE}golang-remote-job-gmk-Remote-Europe-Senior-Backend-Engineer-Build-AI-Agents-Salesforge-remote-jobs.html`,
      ),
      'Remote · Europe',
    );
    assert.equal(
      deriveLocation(
        'AI Engineer, Data APIs (Go and Python) @ Benzinga',
        `${BASE}golang-go-job-gxi-Remote-AI-Engineer-Data-APIs-Go-Python-Benzinga-remotework.html`,
      ),
      'Remote',
    );
    assert.equal(
      deriveLocation(
        'Senior Software Engineer (Go) - AI Resilience & Security Enhancements (Contract) @ Form3',
        `${BASE}golang-go-job-gxf-Remote-Europe-Senior-Software-Engineer-Go-AI-Resilience-Security-Enhancements-Contract-Form3-remotework.html`,
      ),
      'Remote · Europe',
    );
  });

  it('says nothing for a slug it does not understand', () => {
    assert.equal(deriveLocation('Principal Engineer @ X', `${BASE}about.html`), '');
    assert.equal(deriveLocation('', `${BASE}golang-go-job-gxh-Remote-Principal-Engineer-X-remotework.html`), '');
    assert.equal(
      deriveLocation('Principal Engineer @ X', `${BASE}golang-go-job-gxh-Principal-Engineer-X-remotework.html`),
      '',
    );
  });
});

describe('mapGolangProjectsItem', () => {
  it('maps an item with the slug-derived location', () => {
    const job = mapGolangProjectsItem(
      {
        title: 'Principal Engineer @ The AI Whistleblower Initiative',
        link: `${BASE}golang-go-job-gxh-Remote-Principal-Engineer-London-The-AI-Whistleblower-Initiative-remotework.html`,
        guid: 'gxh',
        contentSnippet: 'Remote - About AIWI',
        pubDate: 'Tue, 02 Sep 2026 10:00:00 +0000',
      },
      619,
    );
    assert.ok(job);
    assert.equal(job.location, 'Remote');
    assert.equal(job.externalId, 'gxh');
  });

  it('takes the role as the title and who hires from after the "@" (#662)', () => {
    // As rss.xml wrote it on 2026-10-29: no-break spaces around the "@".
    const job = mapGolangProjectsItem(
      {
        title: 'Senior Software Engineer\u00a0@\u00a0Sotheby\u2019s',
        link: `${BASE}golang-go-job-gkd-Remote-Senior-Software-Engineer-London-Sotheby-s-remotework.html`,
        guid: 'gkd',
      },
      619,
    );
    assert.deepEqual([job?.title, job?.employer, job?.location], ['Senior Software Engineer', 'Sotheby\u2019s', 'Remote']);
  });

  it('skips an item nothing identifies', () => {
    assert.equal(mapGolangProjectsItem({ title: '' }, 619), null);
  });
});

describe('splitGolangTitle', () => {
  it('splits at the last "@", and names nobody without one', () => {
    assert.deepEqual(splitGolangTitle('Go Engineer @ Remote @ Acme Ltd '), { title: 'Go Engineer @ Remote', employer: 'Acme Ltd' });
    assert.deepEqual(splitGolangTitle('Go Engineer (email jobs@acme.io)'), { title: 'Go Engineer (email jobs@acme.io)', employer: null });
  });
});
