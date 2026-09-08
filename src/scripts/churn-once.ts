/*
 * The tailoring loop as a user runs it, measured:
 *
 *   npm run churn:compare -- 5:2127 3:2115            # 2 rounds each
 *   npm run churn:compare -- 5:2127 --rounds 3 --keep  # keep the rows
 *
 * For each `resumeId:jobId`: a full analysis of the stored text, then, round
 * after round, every action that carries wording is applied the way the
 * editor applies it (a replacement over its quote, an addition after its
 * anchor) and the edited text is analysed again as a draft. Two numbers per
 * round: how many of the previous report's lines the text now carries
 * (`applied`), and how many of the new report's actions quote one of them
 * (`rewritten` — the churn). Before the APPLIED FROM THE LAST RUN rule, one
 * live pair rewrote its own first bullet in seven runs out of seven.
 *
 * Spends AI and writes draft rows, which it deletes at the end unless --keep.
 * Hand-run, never CI.
 */
import { prisma } from '../db';
import { appliedWording, rewritesOfApplied } from '../resume/applied';
import { briefForPosting } from '../resume/brief';
import { loadKeywordMatcher } from '../resume/keyword-matcher';
import { matchResumeToJob } from '../resume/match';
import { readActions, type MatchAction } from '../resume/prompts';
// The editor's own operations, so "applied" means what Apply does.
// @ts-expect-error — plain JS with no declaration file.
import { applyReplacement, insertAfterLine } from '../web/public/text-edits.mjs';

const DEFAULT_ROUNDS = 2;

/** `--rounds 0` is one analysis and no loop — a real request, not an unset flag. */
function flagNumber(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const v = i === -1 ? NaN : Number(process.argv[i + 1]);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
}

/** Every action with wording, applied in order; the ones the text no longer holds are skipped. */
function applyAll(text: string, actions: MatchAction[]): { text: string; applied: number; skipped: number } {
  let out = text;
  let applied = 0;
  let skipped = 0;
  for (const a of actions) {
    if (!a.replacement) continue;
    const result = a.quote
      ? (applyReplacement(out, a.quote, a.replacement) as { text?: string; error?: string })
      : a.insert_after
        ? (insertAfterLine(out, a.insert_after, a.replacement) as { text?: string; error?: string })
        : { error: 'no-anchor' };
    if (result.text === undefined) {
      skipped++;
      continue;
    }
    out = result.text;
    applied++;
  }
  return { text: out, applied, skipped };
}

async function main(): Promise<void> {
  const pairs = process.argv.slice(2).filter((a) => /^\d+:\d+$/.test(a));
  if (pairs.length === 0) {
    console.error('usage: npm run churn:compare -- <resumeId>:<jobId> [...] [--rounds N] [--keep]');
    process.exitCode = 2;
    return;
  }
  const rounds = flagNumber('rounds', DEFAULT_ROUNDS);
  const keep = process.argv.includes('--keep');
  const matcher = await loadKeywordMatcher();
  const written: number[] = [];
  const summary: string[] = [];

  for (const pair of pairs) {
    const [resumeId, jobId] = pair.split(':').map(Number) as [number, number];
    const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId }, include: { company: { select: { name: true } } } });
    const resume = await prisma.resume.findUniqueOrThrow({ where: { id: resumeId } });
    const jobInput = { id: job.id, title: job.title, companyName: job.company.name, location: job.location, description: job.description };
    const briefed = await briefForPosting(jobInput);
    console.log(`\n${pair} · "${job.title}" × "${resume.name}" · ${rounds} rounds`);

    let text = resume.text;
    let previous: MatchAction[] = [];
    for (let round = 0; round <= rounds; round++) {
      const started = Date.now();
      const row = await matchResumeToJob({ id: resume.id, text, version: resume.version }, jobInput, { mode: 'full', brief: briefed, draft: true });
      if (!row) {
        console.log(`  round ${round}: failed`);
        break;
      }
      written.push(row.id);
      const actions = readActions(row.actions);
      const applied = appliedWording(previous, text, matcher.locateQuote);
      const rewritten = rewritesOfApplied(applied, actions, text, matcher.locateQuote);
      const line =
        `  round ${round}: score ${String(row.matchScore).padStart(3)}  actions ${String(actions.length).padStart(2)}  ` +
        `applied ${String(applied.length).padStart(2)}  rewritten ${String(rewritten.length).padStart(2)}  ${Math.round((Date.now() - started) / 1000)}s`;
      console.log(line);
      for (const a of rewritten) console.log(`      ↻ ${a.section} · ${a.what}`);
      summary.push(`${pair} r${round} score ${row.matchScore} actions ${actions.length} applied ${applied.length} rewritten ${rewritten.length}`);
      if (round === rounds) break;
      const next = applyAll(text, actions);
      console.log(`      applied ${next.applied} of ${actions.length} actions to the text (${next.skipped} skipped)`);
      text = next.text;
      previous = actions;
    }
  }

  console.log('\n' + summary.join('\n'));
  if (keep) {
    console.log(`\nkept rows ${written.join(', ')}`);
  } else if (written.length > 0) {
    await prisma.resumeMatch.deleteMany({ where: { id: { in: written } } });
    console.log(`\ndeleted ${written.length} draft rows`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
