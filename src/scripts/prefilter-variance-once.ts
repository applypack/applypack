/*
 * The two-stage prefilter, asked about postings single-stage scoring kept:
 *
 *   npm run variance:prefilter                    # up to 50 postings, 3 asks each
 *   npm run variance:prefilter -- --limit 30 --runs 5
 *   npm run variance:prefilter -- --raw           # ask the gate about every one
 *
 * Kept = a stored score at or above its search's threshold
 * (`job_score.fitScore >= minFitScore`), newest first. Each posting meets the
 * gate as the tick sends it: one that names a search's required stack skips
 * it (`prefilterMayJudge`), the rest go through `preClassify` — the product's
 * prompt, model and parser — against every running search, N times. Every
 * "not relevant" here is a match stage 2 would have kept and two-stage scoring
 * would dismiss (issue #441). `--raw` asks the gate about the ones that skip
 * it too: its own error rate, the measurement that put the skip there.
 *
 * Spends AI and stores nothing (the ledger records each call, as it records
 * every call). Hand-run, never CI.
 */
import { prisma } from '../db';
import { config } from '../config';
import { preClassify, prefilterMayJudge, type PrefilterResult } from '../classifier-prefilter';
import { getAiRuntime } from '../ai-runtime';
import { createLimiter } from '../concurrency';
import { companyForPrompt } from '../employer';
import { isBlankProfile } from '../profile-guards';
import { listActiveProfiles } from '../profiles';

const DEFAULT_RUNS = 3;
const DEFAULT_LIMIT = 50;

function flagNumber(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const v = i === -1 ? NaN : Number(process.argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

async function main(): Promise<void> {
  const times = flagNumber('runs', DEFAULT_RUNS);
  const take = flagNumber('limit', DEFAULT_LIMIT);
  const raw = process.argv.includes('--raw');
  const profiles = (await listActiveProfiles()).filter((p) => !isBlankProfile(p));
  if (profiles.length === 0) {
    console.error('no running search with a stack or role types');
    process.exitCode = 2;
    return;
  }
  const scores = await prisma.jobScore.findMany({
    where: { profileId: { in: profiles.map((p) => p.id) } },
    include: { job: { include: { company: { select: { name: true, atsType: true } } } } },
    orderBy: [{ job: { fetchedAt: 'desc' } }, { jobId: 'desc' }],
  });
  const threshold = new Map(profiles.map((p) => [p.id, p.minFitScore]));
  const kept = new Map<number, (typeof scores)[number]>();
  for (const s of scores) {
    if (s.fitScore >= threshold.get(s.profileId)! && !kept.has(s.jobId)) kept.set(s.jobId, s);
  }
  const postings = [...kept.values()].slice(0, take);
  console.log(`${times} asks × ${postings.length} kept postings · ${profiles.map((p) => `"${p.name}"`).join(' · ')}\n`);

  const limit = createLimiter(config.AI_CONCURRENCY);
  const ai = await getAiRuntime();
  let no = 0;
  let unreadable = 0;
  let anyNo = 0;
  let everyNo = 0;
  let skipped = 0;
  const reasons: string[] = [];
  for (const s of postings) {
    const { job } = s;
    const input = {
      title: job.title,
      companyName: companyForPrompt(job.employer, job.company),
      location: job.location,
      place: { workplace: job.workplace, countries: job.countries, regions: job.regions },
      description: job.description,
      postedAt: job.postedAt,
    };
    if (!raw && !prefilterMayJudge(input, profiles)) {
      skipped++;
      console.log(`#${job.id} ${String(s.fitScore).padStart(3)} "${job.title}": names the stack, the gate is not asked`);
      continue;
    }
    const answers: (PrefilterResult | null)[] = await Promise.all(
      Array.from({ length: times }, () => limit(() => preClassify(input, profiles, { ai, subject: { jobId: job.id }, ledgerIds: [] }))),
    );
    const noes = answers.filter((a) => a?.relevant === false);
    no += noes.length;
    unreadable += answers.filter((a) => a === null).length;
    if (noes.length > 0) anyNo++;
    if (noes.length === times) everyNo++;
    reasons.push(...noes.map((a) => `#${job.id} ${a!.reason}`));
    const line = answers.map((a) => (a === null ? 'unreadable' : a.relevant ? 'yes' : `NO (${a.reason})`)).join(' | ');
    console.log(`#${job.id} ${String(s.fitScore).padStart(3)} "${job.title}": ${line}`);
  }

  const asked = (postings.length - skipped) * times;
  console.log(
    `\n${postings.length} kept postings, ${skipped} past the gate on their stack, ${asked} asks: ` +
      `"not relevant" ${no} (${asked > 0 ? Math.round((no / asked) * 100) : 0}%) · ` +
      `unreadable ${unreadable} · turned away at least once ${anyNo} · every time ${everyNo}`,
  );
  if (reasons.length > 0) console.log(`\nreasons:\n${reasons.map((r) => `  ${r}`).join('\n')}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
