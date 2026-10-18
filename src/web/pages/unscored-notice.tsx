/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { ActionForm, Button, Hint, Notice } from '../ui';
import { PAGE_SCORE_BATCH, type UnscoredView } from '../score-run';
import { t } from '../../i18n/t';

/**
 * Jobs stored without a score — by a fetch while paused, by setup's test
 * search, or when the AI did not answer — and one press to score them, the
 * pass setup's last step runs. Nothing scores them by itself.
 */
export const UnscoredNotice: FC<UnscoredView & { class?: string }> = ({ count, cost, runId, class: extra = '' }) => (
  <Notice tone="warn" class={extra}>
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span class="min-w-0 flex-1">{t('jobs.unscored', { n: count })}</span>
      {runId ? (
        <Button href={`/target/runs/${runId}`} variant="secondary" size="sm">
          {t('jobs.unscored.watch')}
        </Button>
      ) : (
        <ActionForm action="/jobs/score-unscored">
          <Button variant="secondary" size="sm">
            {t('jobs.unscored.score')}
          </Button>
        </ActionForm>
      )}
    </div>
    <Hint class="mt-1">
      {t('jobs.unscored.how', { n: PAGE_SCORE_BATCH })} {cost}
    </Hint>
  </Notice>
);
