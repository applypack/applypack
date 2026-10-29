/*
 * Every starter-pack board, asked once (#638): the pinned pair only, never
 * the guesses, one request per entry with a pause between them. Prints what
 * each answered and exits 1 when a board is gone or refused, so a scheduled
 * job can run it between releases. Reads and writes no table, though the
 * config still wants a `DATABASE_URL` set, as for every script.
 *
 *   node dist/scripts/packs-check-once.js
 *
 * A failing board is a lead, not a verdict: re-point or remove it only after
 * reading the company's own careers page (ADR 0017).
 */
import type { AtsType } from '@prisma/client';
import { probeAts } from '../ats-probe';
import { CATALOG } from '../starter-packs/catalog';
import { failureReason, MIN_JOBS_TO_ACCEPT } from '../starter-packs/resolve';

/** One vendor sees one request every so often, never a burst. */
const GAP_MS = 500;

async function main(): Promise<number> {
  let dead = 0;
  for (const c of CATALOG.companies) {
    const answer = await probeAts(c.atsType as AtsType, c.atsToken);
    const jobs = answer.jobsCount ?? 0;
    const verdict = answer.ok ? (jobs >= MIN_JOBS_TO_ACCEPT ? `${jobs} jobs` : 'no open jobs') : failureReason(answer);
    if (verdict === 'gone' || verdict === 'refused') dead++;
    const why = answer.ok ? '' : ` — ${answer.error ?? ''}`;
    process.stdout.write(`${verdict.padEnd(12)} ${c.atsType}:${c.atsToken}  ${c.name}${why}\n`);
    await new Promise((resolve) => setTimeout(resolve, GAP_MS));
  }
  process.stdout.write(`${CATALOG.companies.length} boards, ${dead} gone or refused\n`);
  return dead > 0 ? 1 : 0;
}

void main().then((code) => process.exit(code));
