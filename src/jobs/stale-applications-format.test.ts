import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatPackNotice } from '../notifier';
import { formatDiscordPackNotice } from '../notify/discord';
import { formatStaleMessage, type StaleApplicationItem } from './stale-applications-format';

/** The live check of 2026-10-18 (#578): one Applied job, `appliedAt` backdated by 20 days. */
const recorded: StaleApplicationItem = {
  jobId: 259,
  title: 'Senior Backend Engineer (Core Team)',
  companyName: 'Playson',
  url: 'https://jobicy.com/jobs/152752-senior-backend-engineer-core-team',
  appliedAt: new Date('2026-09-28T09:30:00Z'),
  daysSince: 20,
  appliedWith: null,
};
const at = { address: null, timeZone: 'UTC' };

describe('formatStaleMessage', () => {
  it('says how many applications have waited, in English that agrees with the count', () => {
    const [header] = formatStaleMessage([recorded], 14, at);
    assert.deepEqual(header, { text: '1 application has had no answer for more than 14 days', link: null });
    assert.equal(formatStaleMessage([recorded, recorded], 14, at)[0]!.text, '2 applications have had no answer for more than 14 days');
  });

  it('lists each application with the day it went out and how long ago', () => {
    const [, line] = formatStaleMessage([recorded], 14, at);
    assert.equal(line!.text, '• Senior Backend Engineer (Core Team) @ Playson — applied Sep 28, 2026 (20 days ago)');
    assert.match(formatStaleMessage([{ ...recorded, daysSince: 1 }], 14, at)[1]!.text, /\(1 day ago\)$/);
  });

  it('writes the day in the schedule’s zone', () => {
    const late = { ...recorded, appliedAt: new Date('2026-09-28T23:30:00Z') };
    assert.match(formatStaleMessage([late], 14, { address: null, timeZone: 'Europe/Kyiv' })[1]!.text, /applied Sep 29, 2026/);
  });

  it('names the resume the application went out with', () => {
    const [, line] = formatStaleMessage([{ ...recorded, appliedWith: 'Senior Backend v3' }], 14, at);
    assert.match(line!.text, /\(20 days ago\) with Senior Backend v3$/);
  });

  it('links to the job on the dashboard when its address is set, else to the posting', () => {
    assert.equal(formatStaleMessage([recorded], 14, { address: 'http://127.0.0.1:4747/', timeZone: 'UTC' })[1]!.link, 'http://127.0.0.1:4747/jobs/259');
    assert.equal(formatStaleMessage([recorded], 14, at)[1]!.link, recorded.url);
    assert.equal(formatStaleMessage([{ ...recorded, url: 'saved-page.html' }], 14, at)[1]!.link, null);
  });

  it('is a reminder of its own on both channels: no match header, no score, no Apply link, nothing that prints as markup', () => {
    const lines = formatStaleMessage([recorded], 14, { address: 'http://127.0.0.1:4747', timeZone: 'UTC' });
    const [telegram] = formatPackNotice(lines);
    const [discord] = formatDiscordPackNotice(lines);
    for (const text of [telegram!, discord!]) {
      assert.doesNotMatch(text, /match|fit|\/100|Apply/i);
      assert.doesNotMatch(text, /\\\*|\*/);
    }
    assert.equal(
      telegram,
      [
        '1 application has had no answer for more than 14 days',
        '• Senior Backend Engineer \\(Core Team\\) @ Playson — applied Sep 28, 2026 \\(20 days ago\\)',
        '  http://127\\.0\\.0\\.1:4747/jobs/259',
      ].join('\n'),
    );
  });
});
