import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AlertJob } from '../types';
import {
  DISCORD_MAX_LENGTH,
  escapeDiscord,
  formatDiscordAlert,
  formatDiscordDigest,
  formatDiscordHealthLine,
  formatDiscordPageChanges,
  isDiscordWebhookUrl,
  maskWebhook,
  postDiscord,
} from './discord';
import { describeDestination } from './targets';

const job: AlertJob = {
  title: 'Senior PHP/Laravel Engineer (Test)',
  companyName: 'ACME *Corp*',
  location: 'Remote · United States',
  countries: ['US'],
  url: 'https://example.com/jobs/12345?utm=test&q=1',
  fitScore: 87,
  salaryMin: 140000,
  salaryMax: 180000,
  techMatch: ['php', 'laravel'],
  redFlags: ['no-salary-listed'],
  summary: 'Strong senior remote-US match_with_underscores.',
  matchedProfile: 'PHP/Laravel Backend',
  profileScores: 'PHP/Laravel Backend 87 · QA Automation 41',
};

describe('the Discord channel', () => {
  it('formats an alert in Discord markdown, the posting words escaped, the link kept out of an embed', () => {
    const text = formatDiscordAlert(job);
    assert.equal(
      text,
      [
        '**PHP/Laravel Backend — fit 87/100**',
        '**Senior PHP/Laravel Engineer (Test)** @ ACME \\*Corp\\*',
        '📍 🇺🇸 Remote · United States | 💰 $140k-180k',
        '✅ Tech: php, laravel',
        '⚠️ Flags: no-salary-listed',
        '🎯 PHP/Laravel Backend 87 · QA Automation 41',
        '_Strong senior remote-US match\\_with\\_underscores._',
        'Apply → <https://example.com/jobs/12345?utm=test&q=1>',
      ].join('\n'),
    );
    assert.equal(formatDiscordAlert({ ...job, watched: true, matchedProfile: null }).split('\n')[0], '**★ New posting — fit 87/100**');
  });

  it('escapes what would format, and nothing else', () => {
    assert.equal(escapeDiscord('a*b_c~d`e|f>g#h'), 'a\\*b\\_c\\~d\\`e\\|f\\>g\\#h');
    assert.equal(escapeDiscord('C++ and .NET — fine'), 'C++ and .NET — fine');
  });

  it('packs the digest under 2000 characters and heads it with the quiet sources', () => {
    const quiet = [{ name: 'Acme', atsType: 'GREENHOUSE', status: 'http_error', streak: 3 }];
    const one = formatDiscordDigest([job], quiet, 'Daily digest');
    assert.equal(one.length, 1);
    assert.match(one[0]!, /^\*\*Daily digest — 1 match\*\*\n⚠️ \*\*1 quiet source\*\* — Acme \(GREENHOUSE, [a-z ]+ ×3\)\n\n/);
    const many = formatDiscordDigest(Array.from({ length: 12 }, () => job), [], 'Daily digest');
    assert.ok(many.length > 1);
    for (const m of many) assert.ok(m.length <= DISCORD_MAX_LENGTH, `${m.length} chars`);
    assert.equal(formatDiscordDigest([], [], 'Daily digest')[0], 'No new matches since the last digest.');
    assert.equal(formatDiscordHealthLine([]), '');
  });

  it('names a changed careers page with its link, no embed', () => {
    const text = formatDiscordPageChanges([{ companyName: 'Acme', url: 'https://acme.example/careers' }]);
    assert.equal(text, '**★ A watched careers page changed**\n• **Acme** — <https://acme.example/careers>\nWe cannot read this page for jobs — have a look.');
  });

  it('accepts only Discord webhook URLs and masks the token', () => {
    const url = 'https://discord.com/api/webhooks/123456789012345678/AbC-dEf_ghi';
    assert.equal(isDiscordWebhookUrl(url), true);
    assert.equal(isDiscordWebhookUrl('https://ptb.discord.com/api/webhooks/1/tok'), true);
    assert.equal(isDiscordWebhookUrl('https://evil.example/api/webhooks/1/tok'), false);
    assert.equal(isDiscordWebhookUrl('http://discord.com/api/webhooks/1/tok'), false);
    assert.equal(maskWebhook(url), 'discord.com/api/webhooks/123456789012345678/***_ghi');
    assert.equal(describeDestination({ kind: 'DISCORD', webhookUrl: url, botToken: null, chatId: null }), 'discord.com/api/webhooks/123456789012345678/***_ghi');
    assert.equal(describeDestination({ kind: 'TELEGRAM', webhookUrl: null, botToken: '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ', chatId: '-100' }), '***WXYZ · chat -100');
  });

  it('posts JSON with mentions disabled and reports the status without the URL', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fake: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response(null, { status: 204 });
    };
    const ok = await postDiscord('https://discord.com/api/webhooks/1/secret', 'x'.repeat(2500), fake);
    assert.deepEqual(ok, { ok: true });
    assert.equal(calls[0]?.url, 'https://discord.com/api/webhooks/1/secret');
    assert.deepEqual(calls[0]?.body, { content: 'x'.repeat(2000), allowed_mentions: { parse: [] } });
    const bad = await postDiscord('https://discord.com/api/webhooks/1/secret', 'hi', async () => new Response('{"message":"Unknown Webhook"}', { status: 404 }));
    assert.equal(bad.ok, false);
    assert.match(bad.error ?? '', /^Discord webhook: 404/);
    assert.doesNotMatch(bad.error ?? '', /secret/);
  });
});
