import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JOB_TABS, jobHref, jobTabLabels, resolveJobTab, shownMatch } from './job-tabs';

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
  it('names the five tabs in order, bare while nothing exists', () => {
    assert.deepEqual(
      jobTabLabels({ matchScore: null, letters: 0, verdict: null, pack: null }).map((t) => `${t.tab}=${t.label}`),
      ['posting=Posting', 'match=Resume match', 'letter=Cover letter', 'verify=Is it real?', 'pack=Application pack'],
    );
  });

  it('carries what exists behind each tab', () => {
    const labels = jobTabLabels({ matchScore: 72, letters: 1, verdict: 'legit', pack: 'ready' }).map((t) => t.label);
    assert.deepEqual(labels, ['Posting', 'Resume match · 72', 'Cover letter · 1', 'Is it real? · legit', 'Application pack · ready']);
  });
});

describe('shownMatch — the comparison a job page opens on', () => {
  const row = (id: number, resumeId: number, score: number, over: { draft?: boolean; hidden?: boolean } = {}) => ({
    id,
    resumeId,
    score,
    draft: over.draft ?? false,
    resume: { hidden: over.hidden ?? false },
  });
  // Newest first, as the page lists them: a pack's draft of its tailored text,
  // another person's file compared over resume 2, a one-off file from the
  // Tailor resume page, then resume 2 as saved, then another resume.
  const matches = [
    row(40, 2, 100, { draft: true }),
    row(39, 2, 24, { draft: true }),
    row(38, 9, 78, { hidden: true }),
    row(30, 2, 54),
    row(20, 3, 85),
  ];

  it('is the latest comparison of the resume the job is linked to, as saved (#582, #384)', () => {
    // "Resume match · 24" headed the job, and "marta short" (78) opened the Tailor page.
    assert.equal(shownMatch(matches, NaN, 2)?.score, 54);
    assert.equal(shownMatch(matches, NaN, 3)?.score, 85);
  });

  it('is the latest saved comparison when the job is linked to no resume, or to one never compared', () => {
    assert.equal(shownMatch(matches, NaN, null)?.id, 30);
    assert.equal(shownMatch(matches, NaN, 7)?.id, 30);
  });

  it('is the one asked for, a draft or a one-off included', () => {
    assert.equal(shownMatch(matches, 40, 2)?.id, 40);
    assert.equal(shownMatch(matches, 38, 2)?.id, 38);
    // An id that is not this job's falls back as if none was asked.
    assert.equal(shownMatch(matches, 999, 2)?.id, 30);
  });

  it('is the draft when it is all there is, and nothing when there is nothing', () => {
    assert.equal(shownMatch([row(31, 2, 90, { draft: true })], NaN, 2)?.id, 31);
    assert.equal(shownMatch([], NaN, 2), null);
  });
});
