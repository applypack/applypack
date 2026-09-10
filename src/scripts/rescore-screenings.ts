import { prisma } from '../db';
import { logger } from '../logger';
import { loadKeywordMatcher } from '../resume/keyword-matcher';
import { anchorScreenReply } from '../screening/anchor';
import { readScreenReply } from '../screening/prompts';
import { scoreScreening } from '../screening/score';
import { listApplicantsWithText, rubricOf, updateVerdictScore } from '../screening/store';

/*
 * Re-anchors and re-scores every current screening verdict with the rules
 * as they are now — no AI call, the stored reply read again against the
 * redacted text. For a rule change that only lowers what a quote can carry
 * (the list cap of 2026-09-09) this gives every applicant a comparable
 * number without spending a call; "Score again" on the page is the other
 * way. Prints old → new per applicant; writes nothing without --write.
 *
 *   docker compose exec web node dist/scripts/rescore-screenings.js [--write] [--screening <id>]
 */

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const only = args.includes('--screening') ? Number(args[args.indexOf('--screening') + 1]) : null;
  const matcher = await loadKeywordMatcher();
  const screenings = await prisma.screening.findMany({ where: only ? { id: only } : {}, orderBy: { id: 'asc' } });
  let changed = 0;
  for (const s of screenings) {
    const rubric = rubricOf(s);
    const rows = await listApplicantsWithText(s.id, s.rubricVersion);
    for (const a of rows) {
      if (!a.verdict || a.stale || a.parseStatus !== 'ok') continue;
      const reply = readScreenReply(a.verdict.facts);
      if (!reply) continue;
      const anchored = anchorScreenReply(reply, a.redactedText, rubric, matcher);
      const bd = scoreScreening({ rubric, reply: anchored.reply, textChars: a.redactedText.length, now: a.verdict.createdAt });
      const moved = bd.score !== a.verdict.score || bd.gateBucket !== a.verdict.gateBucket;
      if (moved) changed++;
      process.stdout.write(
        `screening ${s.id} №${a.number} ${a.sourceFilename}: ${a.verdict.score} → ${bd.score}${moved ? '' : ' (same)'}` +
          `${anchored.report.rungsLowered > 0 ? ` — ${anchored.report.rungsLowered} rung${anchored.report.rungsLowered === 1 ? '' : 's'} lowered` : ''}\n`,
      );
      if (write && moved) {
        await updateVerdictScore(a.verdict.id, { facts: anchored.reply, breakdown: bd, score: bd.score, confidence: bd.confidence.band, gateBucket: bd.gateBucket });
      }
    }
  }
  process.stdout.write(`${changed} verdict${changed === 1 ? '' : 's'} ${write ? 'rewritten' : 'would change — add --write to apply'}.\n`);
}

main()
  .catch((err) => {
    logger.error({ err }, 'rescore-screenings failed');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
