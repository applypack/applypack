/*
 * Stored postings, N classifier runs each, and how often the verdict flips:
 *
 *   npm run variance:classify -- 421              # 5 runs
 *   npm run variance:classify -- 421,418,406 --runs 10
 *
 * Every run is the single-stage call the tick makes, against every running
 * search, through the same thresholds (`buildVerdicts`). Per search it prints
 * the fit and location_match of each run, then the share of runs under the
 * search's threshold, with location_match false, and either — the runs that
 * would dismiss the posting. A posting both kept and dismissed across its runs
 * flipped: application packs trigger on that verdict (issue #386).
 *
 * Spends AI and stores no score (the ledger records each call, as it records
 * every call). Hand-run, never CI.
 */
import { prisma } from '../db';
import { config } from '../config';
import { classifyJob } from '../classifier';
import { createLimiter } from '../concurrency';
import { companyForPrompt } from '../employer';
import { storedPlace } from '../jobs/classify-existing';
import { mergeAiLocation } from '../jobs/location-merge';
import { buildVerdicts } from '../jobs/verdict-merge';
import { isBlankProfile } from '../profile-guards';
import { listActiveProfiles } from '../profiles';

const DEFAULT_RUNS = 5;

function flagNumber(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const v = i === -1 ? NaN : Number(process.argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

/** One run's verdict for one search. */
interface Run {
  fit: number;
  locationMatch: boolean;
  dismissed: string | null;
}

interface Tally {
  runs: number;
  failed: number;
  lowFit: number;
  locationFalse: number;
  dismissed: number;
  /** Postings kept in some runs and dismissed in others. */
  flipped: number;
}

const share = (n: number, of: number): string => `${n}/${of}${of > 0 ? ` (${Math.round((n / of) * 100)}%)` : ''}`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const ids = args
    .filter((a, i) => /^\d+(,\d+)*$/.test(a) && !args[i - 1]?.startsWith('--'))
    .flatMap((a) => a.split(',').map(Number));
  if (ids.length === 0) {
    console.error('usage: npm run variance:classify -- <jobId>[,<jobId>…] [--runs N]');
    process.exitCode = 2;
    return;
  }
  const times = flagNumber('runs', DEFAULT_RUNS);
  const profiles = (await listActiveProfiles()).filter((p) => !isBlankProfile(p));
  if (profiles.length === 0) {
    console.error('no running search with a stack or role types');
    process.exitCode = 2;
    return;
  }
  const jobs = await prisma.job.findMany({
    where: { id: { in: ids } },
    include: { company: { select: { name: true, atsType: true } } },
  });
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) console.log(`not found: ${missing.join(', ')}\n`);

  console.log(
    `${times} runs × ${byId.size} postings · ${profiles.map((p) => `"${p.name}" (≥${p.minFitScore}; ${[...p.countries, ...p.regions].join(', ') || 'anywhere'})`).join(' · ')}\n`,
  );
  const limit = createLimiter(config.AI_CONCURRENCY);
  const totals = new Map<number, Tally>(
    profiles.map((p) => [p.id, { runs: 0, failed: 0, lowFit: 0, locationFalse: 0, dismissed: 0, flipped: 0 }]),
  );

  for (const id of new Set(ids)) {
    const job = byId.get(id);
    if (!job) continue;
    const input = {
      title: job.title,
      companyName: companyForPrompt(job.employer, job.company),
      location: job.location,
      place: { workplace: job.workplace, countries: job.countries, regions: job.regions },
      description: job.description,
      postedAt: job.postedAt,
    };
    const outcomes = await Promise.all(
      Array.from({ length: times }, () => limit(() => classifyJob(input, profiles, 'single'))),
    );
    const place = [job.workplace, job.countries.join(', '), job.regions.join(', ')].filter(Boolean).join(' · ');
    console.log(`#${job.id} "${job.title}" · "${job.location || '(no location)'}" · parsed ${place}`);

    for (const profile of profiles) {
      const runs: (Run | null)[] = outcomes.map((o) => {
        const { verdicts } = buildVerdicts(o.results, [profile], job, mergeAiLocation(storedPlace(job), o.location));
        const v = verdicts[0];
        return v
          ? { fit: v.classification.fit_score, locationMatch: v.classification.location_match, dismissed: v.dismissReason }
          : null;
      });
      const answered = runs.filter((r): r is Run => r !== null);
      const t = totals.get(profile.id)!;
      t.runs += answered.length;
      t.failed += runs.length - answered.length;
      t.lowFit += answered.filter((r) => r.fit < profile.minFitScore).length;
      t.locationFalse += answered.filter((r) => !r.locationMatch).length;
      const dismissed = answered.filter((r) => r.dismissed !== null).length;
      t.dismissed += dismissed;
      const flipped = dismissed > 0 && dismissed < answered.length;
      if (flipped) t.flipped++;

      const line = runs
        .map((r) => (r ? `${String(r.fit).padStart(3)} ${r.locationMatch ? 'loc ✓' : 'loc ✗'}${r.dismissed ? ` ${r.dismissed}` : ''}` : 'failed'))
        .join('  |  ');
      console.log(`  ${profile.name}: ${line}${flipped ? '   ← FLIPPED' : ''}`);
      const summaries = new Set(outcomes.map((o) => o.results.get(profile.id)?.summary).filter(Boolean));
      for (const s of summaries) console.log(`    · ${s}`);
    }
    console.log('');
  }

  for (const profile of profiles) {
    const t = totals.get(profile.id)!;
    console.log(
      `"${profile.name}": ${t.runs} runs${t.failed > 0 ? ` (+${t.failed} failed)` : ''} · ` +
        `under ${profile.minFitScore} ${share(t.lowFit, t.runs)} · location false ${share(t.locationFalse, t.runs)} · ` +
        `dismissed ${share(t.dismissed, t.runs)} · flipped postings ${t.flipped}`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
