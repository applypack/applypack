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

/** The flash for one re-score; null for a verdict that was formed — the page shows it. `before` is the job's status when the button was pressed. */
export function rescoreFlash(outcome: Rescored, before: JobStatus): { kind: FlashKind; text: string } | null {
  if (outcome.kind === 'scored') return null;
  if (outcome.kind === 'no-search') return { kind: 'warn', text: t('job.reclassify.noSearch') };
  if (outcome.kind === 'failed') return { kind: 'err', text: runFailure(t('job.reclassify.failed'), outcome.reason, t('job.reclassify.unchanged')) };
  const moved = outcome.status === before ? 'kept' : outcome.status === 'DISMISSED' ? 'dismissed' : 'saved';
  return { kind: 'warn', text: t('job.reclassify.prefiltered', { moved }) };
}
