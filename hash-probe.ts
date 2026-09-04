import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { stripHtml } from './src/http';

const UA = 'applypack/1.49 (+https://github.com/applypack/applypack)';
const PAGES: Array<[string, string]> = [
  ['Fly.io', 'https://fly.io/jobs/'],
  ['Doist', 'https://doist.com/careers'],
  ['Storyblok', 'https://www.storyblok.com/careers'],
  ['Datadog', 'https://careers.datadoghq.com/'],
  ['Cloudflare', 'https://www.cloudflare.com/careers/'],
  ['PostHog', 'https://posthog.com/careers'],
  ['Shopify', 'https://www.shopify.com/careers'],
  ['SoftwareMansion', 'https://swmansion.com/careers'],
  ['MacPaw', 'https://macpaw.com/careers'],
  ['Preply', 'https://preply.com/en/careers'],
];

const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/** The candidate normalisations, weakest first. */
const NORMS: Record<string, (html: string) => string> = {
  raw: (h) => h,
  text: (h) => stripHtml(h),
  ws: (h) => stripHtml(h).replace(/\s+/g, ' ').trim(),
  wsDigits: (h) => stripHtml(h).replace(/\s+/g, ' ').replace(/\d+/g, '#').trim(),
  wsDigitsLower: (h) => stripHtml(h).replace(/\s+/g, ' ').replace(/\d+/g, '#').trim().toLowerCase(),
};

async function get(url: string): Promise<string> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctl.signal, redirect: 'follow' });
    return await r.text();
  } catch { return ''; } finally { clearTimeout(t); }
}

async function main() {
  const rounds: Array<Record<string, string>> = [];
  const texts: Record<string, string[]> = {};
  for (let round = 0; round < 3; round++) {
    const bag: Record<string, string> = {};
    for (const [name, url] of PAGES) {
      const html = await get(url);
      bag[name] = html;
      (texts[name] ??= []).push(NORMS.ws!(html));
      await new Promise((s) => setTimeout(s, 800));
    }
    rounds.push(bag);
    console.error(`round ${round + 1} done`);
    if (round < 2) await new Promise((s) => setTimeout(s, 45_000));
  }

  const header = ['page'.padEnd(17), ...Object.keys(NORMS).map((n) => n.padEnd(15))].join('');
  console.log(header);
  const unstable: Record<string, string[]> = {};
  for (const [name] of PAGES) {
    const cells: string[] = [];
    for (const [norm, fn] of Object.entries(NORMS)) {
      const hashes = new Set(rounds.map((r) => sha(fn(r[name] ?? ''))));
      const ok = hashes.size === 1;
      if (!ok) (unstable[norm] ??= []).push(name);
      cells.push((ok ? 'stable' : `CHANGED x${hashes.size}`).padEnd(15));
    }
    console.log(name.padEnd(17) + cells.join(''));
  }
  console.log('\nfalse positives per normalisation:');
  for (const norm of Object.keys(NORMS)) {
    const bad = unstable[norm] ?? [];
    console.log(`  ${norm.padEnd(15)} ${bad.length}/${PAGES.length}  ${bad.join(', ')}`);
  }
  writeFileSync('/private/tmp/claude-501/-Users-nazarboyko-main-job-hunter/088692f2-5823-4354-bd84-f69e8f22d5be/scratchpad/hash-texts.json', JSON.stringify(texts));
  process.exit(0);
}
void main();
