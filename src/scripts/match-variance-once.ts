/*
 * One pair, N times, and what the spread is made of:
 *
 *   npm run variance:compare -- 1:2117            # 5 runs, as a user sees them
 *   npm run variance:compare -- 1:2117 --runs 8
 *   npm run variance:compare -- 1:2117 --rebuild  # frame withheld each time
 *   npm run variance:compare -- 1:2117 --stored    # re-read the last N rows, no AI
 *   npm run variance:compare -- 1:2117 --discard   # delete the rows it wrote
 *
 * The rubric's own cliffs are fixed (ADR 0044 and its addendum); what is left
 * is the model's judgment, and "the score moved 20 points" is not something a
 * user can act on. This says which part moved it — the keyword statuses, the
 * three alignment grades, the red flags, or the cap — by holding each part at
 * its modal value and measuring what survives.
 *
 * Two modes, and the difference between them is itself the measurement:
 *   default    the keyword frame is carried between runs, which is what the
 *              product does and therefore what a user experiences
 *   --rebuild  the frame is withheld, so every run re-reads the posting's terms
 *              from scratch — the raw judgment, without the stabiliser
 *
 * Spends AI and writes one match row per run, so it is a hand-run measurement,
 * never CI. The rows land under the job's "older runs" like any other.
 */
import { prisma } from '../db';
import { briefForPosting } from '../resume/brief';
import { domainLean } from '../resume/domain';
import { matchResumeToJob } from '../resume/match';
import { readActions, readKeywords } from '../resume/prompts';
import { readBreakdown } from '../resume/score';
import { alignmentDrift, attribute, spreadOf, statusDrift, type VarianceRun } from '../resume/variance';

const DEFAULT_RUNS = 5;

function flagNumber(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const v = i === -1 ? NaN : Number(process.argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

async function main(): Promise<void> {
  const pair = process.argv.slice(2).find((a) => /^\d+:\d+$/.test(a));
  if (!pair) {
    console.error('usage: npm run variance:compare -- <resumeId>:<jobId> [--runs N] [--rebuild]');
    process.exitCode = 2;
    return;
  }
  const [resumeId, jobId] = pair.split(':').map(Number) as [number, number];
  const times = flagNumber('runs', DEFAULT_RUNS);
  const rebuild = process.argv.includes('--rebuild');
  // Re-reading is free, and a measurement worth making is worth looking at twice.
  const stored = process.argv.includes('--stored');
  // A measurement of the prompt, not a comparison the user asked for.
  const discard = process.argv.includes('--discard') && !stored;

  const job = await prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    include: { company: { select: { name: true } } },
  });
  const resume = await prisma.resume.findUniqueOrThrow({ where: { id: resumeId } });
  const jobInput = {
    id: job.id,
    title: job.title,
    companyName: job.company.name,
    location: job.location,
    description: job.description,
  };
  // Written once and reused by every run, exactly as it is in production.
  const briefed = await briefForPosting(jobInput);

  console.log(
    `${times} runs · "${job.title}" × "${resume.name}" · ` +
      (stored ? 'read back from the store' : `frame ${rebuild ? 'withheld' : 'carried'}`) +
      '\n',
  );
  const previous = stored
    ? (await prisma.resumeMatch.findMany({ where: { jobId, resumeId }, orderBy: { id: 'desc' }, take: times })).reverse()
    : [];
  const runs: VarianceRun[] = [];
  const written: number[] = [];
  const leans: string[] = [];
  for (let i = 0; i < times; i++) {
    const started = Date.now();
    const row = stored ? previous[i] : await matchResumeToJob(resume, jobInput, { mode: 'full', brief: briefed, rebuild });
    if (!row) {
      console.log(`run ${i + 1}: ${stored ? 'no stored row' : 'failed'}`);
      continue;
    }
    if (!stored) written.push(row.id);
    const breakdown = readBreakdown(row.breakdown);
    if (!breakdown) {
      console.log(`run ${i + 1}: no readable breakdown`);
      continue;
    }
    // Whether the advice is written in the employer's domain (domain.ts).
    const lean = domainLean(readActions(row.actions), briefed?.brief);
    leans.push(`${lean.high.hits}/${lean.high.total}`);
    runs.push({
      score: row.matchScore,
      breakdown,
      keywords: readKeywords(row.keywords).map((k) => ({ term: k.term, status: k.status })),
      redFlags: row.redFlags.length,
      actions: readActions(row.actions).length,
    });
    console.log(
      `run ${i + 1}: ${String(row.matchScore).padStart(3)}/100  ` +
        `kw ${String(breakdown.keywordPts).padStart(4)}  align ${String(breakdown.alignmentPts).padStart(3)}  ` +
        `pen ${String(breakdown.penalty).padStart(2)}  cap ${String(breakdown.cap ?? '-').padStart(4)}  ` +
        `flags ${row.redFlags.length}  actions ${readActions(row.actions).length}  domain ${lean.high.hits}/${lean.high.total}  ${Math.round((Date.now() - started) / 1000)}s`,
    );
  }
  if (runs.length < 2) {
    console.log('\nnot enough runs to measure a spread');
    process.exitCode = 1;
    return;
  }

  const score = spreadOf(runs.map((r) => r.score));
  console.log(
    `\nscore      ${score.min}–${score.max}   spread ${score.spread}   mean ${score.mean}   sd ${score.sd}`,
  );
  for (const [label, values] of [
    ['keywords ', runs.map((r) => r.breakdown.keywordPts)],
    ['alignment', runs.map((r) => r.breakdown.alignmentPts)],
    ['penalty  ', runs.map((r) => r.breakdown.penalty)],
    ['actions  ', runs.map((r) => r.actions)],
  ] as const) {
    const s = spreadOf([...values]);
    console.log(`${label}  ${s.min}–${s.max}   spread ${s.spread}   mean ${s.mean}   sd ${s.sd}`);
  }

  const { total, parts } = attribute(runs);
  console.log(`\nwhere the ${total}-point spread comes from (one part held at its usual value):`);
  for (const p of parts) {
    // A negative share is real and worth seeing: holding that part still moved
    // other runs across the cap and widened the spread. The bar just stops at 0.
    const bar = '█'.repeat(Math.max(0, Math.round(p.share * 20)));
    console.log(`  ${p.part.padEnd(10)} ${String(Math.round(p.share * 100)).padStart(4)}%  ${bar}  spread left: ${p.spreadWithout}`);
  }

  console.log('\nalignment grades:');
  for (const d of alignmentDrift(runs)) {
    console.log(`  ${d.dimension.padEnd(12)} ${d.grades.join(' ')}${d.differed > 0 ? `   (${d.differed} of ${runs.length} disagreed)` : ''}`);
  }

  const drift = statusDrift(runs);
  const unstable = drift.filter((d) => !d.stable);
  console.log(`\nkeyword statuses: ${drift.length - unstable.length} of ${drift.length} stable across all runs`);
  for (const d of unstable) console.log(`  ${d.term.padEnd(28)} ${d.statuses.join(' → ')}`);

  const vocabulary = domainLean([], briefed?.brief).vocabulary;
  console.log(`\nhigh actions in the employer's domain: ${leans.join('  ')}   (${vocabulary.join(', ') || 'no domain words in the brief'})`);

  if (discard && written.length > 0) {
    await prisma.resumeMatch.deleteMany({ where: { id: { in: written } } });
    console.log(`\ndeleted ${written.length} rows`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
