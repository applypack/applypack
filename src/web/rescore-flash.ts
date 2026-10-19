/*
 * What the job page says after Re-classify (#414). A press that formed no
 * verdict used to come back as the same page with no word: every engine
 * failing, the two-stage prefilter turning the posting away, and no search
 * running all looked alike. Pure — tested in rescore-flash.test.ts.
 */

import type { JobStatus } from '@prisma/client';
import type { Rescored } from '../jobs/classify-existing';
import { t } from '../i18n/t';
import type { FlashKind } from './flash';
import { runFailure } from './run-failure';

/** The flash for one re-score. `before` is the job as it was when the button was pressed. */
export function rescoreFlash(outcome: Rescored, before: { status: JobStatus; fitScore: number | null }): { kind: FlashKind; text: string } {
  if (outcome.kind === 'scored') {
    // The same number on the same page reads as a press that did nothing (#544).
    const was = before.fitScore === null ? 'none' : before.fitScore === outcome.fitScore ? 'same' : 'other';
    return { kind: 'ok', text: t('job.reclassify.scored', { score: outcome.fitScore, before: before.fitScore ?? 0, was }) };
  }
  if (outcome.kind === 'no-search') return { kind: 'warn', text: t('job.reclassify.noSearch') };
  if (outcome.kind === 'failed') return { kind: 'err', text: runFailure(t('job.reclassify.failed'), outcome.reason, t('job.reclassify.unchanged')) };
  const moved = outcome.status === before.status ? 'kept' : outcome.status === 'DISMISSED' ? 'dismissed' : 'saved';
  return { kind: 'warn', text: t('job.reclassify.prefiltered', { moved }) };
}
