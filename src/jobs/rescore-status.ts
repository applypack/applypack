import { AtsType, JobStatus } from '@prisma/client';
import { readSourceConfig } from '../datasets/map';

/*
 * What a re-score may do to a stored job's status. Pure — the three paths that
 * score a row again (the job page's Re-classify, "Save & re-classify", the
 * wizard's "score what we found") ask here, so they cannot disagree.
 *
 * Dismissed is not a resting place: the weekly cleanup deletes a dismissed
 * row a month after it was found. So a score may dismiss only what a search
 * brought in — never a row that is on Jobs because the person put it there.
 */

/**
 * A posting the user chose themselves: pasted (a MANUAL company's row), or
 * saved as a file into a folder of postings (ADR 0062). The ingest path knows
 * it as `NormalizedJob.handPicked`; a stored row is read off its source.
 */
export function handPickedSource(company: { atsType: AtsType; sourceConfig: unknown }): boolean {
  if (company.atsType === AtsType.MANUAL) return true;
  return company.atsType === AtsType.FOLDER && readSourceConfig(company.sourceConfig)?.holds === 'postings';
}

/**
 * The status after a re-score. `kept` is whether any search still wants the
 * posting (verdict-merge.ts); a row the filter or the prefilter turned away
 * is `kept: false`.
 *  - Applied and Saved are the person's own word and never move.
 *  - A dismissed row a search now wants comes back as New; one no search
 *    wants stays dismissed, hand-picked or not — that dismissal was theirs.
 *  - A row no search wants is dismissed, except a hand-picked one, which is
 *    kept Saved exactly as the ingest stores it.
 */
export function statusAfterRescore(current: JobStatus, kept: boolean, handPicked: boolean): JobStatus {
  if (current === JobStatus.APPLIED || current === JobStatus.SAVED) return current;
  if (kept) return current === JobStatus.DISMISSED ? JobStatus.NEW : current;
  if (current === JobStatus.DISMISSED) return current;
  return handPicked ? JobStatus.SAVED : JobStatus.DISMISSED;
}
