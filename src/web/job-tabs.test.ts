import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JOB_TABS, jobHref, jobTabLabels, resolveJobTab } from './job-tabs';

describe('resolveJobTab', () => {
  it('opens on the posting', () => {
    assert.equal(resolveJobTab({}), 'posting');
    assert.equal(resolveJobTab({ tab: '', match: '', letter: undefined }), 'posting');
  });

  it('takes an explicit tab over everything else', () => {
    for (const tab of JOB_TABS) assert.equal(resolveJobTab({ tab, match: '12', letter: '3' }), tab);
  });

  it('infers the tab of a link written before the tabs existed', () => {
    assert.equal(resolveJobTab({ match: '12' }), 'match');
    assert.equal(resolveJobTab({ letter: '3' }), 'letter');
    assert.equal(resolveJobTab({ match: '12', letter: '3' }), 'match');
  });

  it('never returns what it was not given by name', () => {
    assert.equal(resolveJobTab({ tab: 'https://evil.example' }), 'posting');
    assert.equal(resolveJobTab({ tab: 'MATCH' }), 'posting');
    assert.equal(resolveJobTab({ tab: '../settings', letter: '3' }), 'letter');
  });
});

describe('jobHref', () => {
  it('keeps the default tab out of the address', () => {
    assert.equal(jobHref(12), '/jobs/12');
    assert.equal(jobHref(12, 'posting'), '/jobs/12');
  });

  it('names any other tab, carries its params and lands on an anchor', () => {
    assert.equal(jobHref(12, 'verify'), '/jobs/12?tab=verify');
    assert.equal(jobHref(12, 'verify', {}, 'verification'), '/jobs/12?tab=verify#verification');
    assert.equal(jobHref(12, 'match', { match: 7 }, 'resume-match'), '/jobs/12?tab=match&match=7#resume-match');
  });

  it('round-trips through resolveJobTab', () => {
    for (const tab of JOB_TABS) {
      const url = new URL(jobHref(5, tab), 'http://x');
      assert.equal(resolveJobTab({ tab: url.searchParams.get('tab') }), tab);
    }
  });
});

describe('jobTabLabels', () => {
  it('names the four tabs in order, bare while nothing exists', () => {
    assert.deepEqual(
      jobTabLabels({ matchScore: null, letters: 0, verdict: null }).map((t) => `${t.tab}=${t.label}`),
      ['posting=Posting', 'match=Resume match', 'letter=Cover letter', 'verify=Is it real?'],
    );
  });

  it('carries what exists behind each tab', () => {
    const labels = jobTabLabels({ matchScore: 72, letters: 1, verdict: 'legit' }).map((t) => t.label);
    assert.deepEqual(labels, ['Posting', 'Resume match · 72', 'Cover letter · 1', 'Is it real? · legit']);
  });
});
