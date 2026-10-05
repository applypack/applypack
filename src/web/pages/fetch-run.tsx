/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import { ActionForm, Button, Card, Hint, Notice } from '../ui';
import { Icon } from '../icons';
import { RunSteps, type StepView } from './run-steps';
import { FETCH_FAILED, FETCH_RUN_STEPS, type FetchRun } from '../fetch-runs';
import { t } from '../../i18n/t';

function stepView({ classify, scope }: Pick<FetchRun, 'classify' | 'scope'>): Record<string, StepView> {
  return {
    fetch:
      typeof scope === 'object'
        ? { label: t('fetch.step.check', { name: scope.name }), detail: t('fetch.step.check.detail') }
        : scope === 'aggregators'
        ? { label: t('fetch.step.aggregators'), detail: t('fetch.step.aggregators.detail') }
        : { label: t('fetch.step.all'), detail: t('fetch.step.all.detail') },
    store: classify
      ? { label: t('fetch.step.score'), detail: t('fetch.step.score.detail') }
      : { label: t('fetch.step.store'), detail: t('fetch.step.store.detail') },
  };
}

/** "Fetch now" — one form shared by Overview and /runs; a link to the live run while one is in flight. */
export const FetchNowButton: FC<{ run: FetchRun | null }> = ({ run }) =>
  run ? (
    <Button href={`/runs/fetch-now/${run.id}`} variant="secondary">
      <Icon name="activity" size={16} />
      {t('fetch.fetchingWatch')}
    </Button>
  ) : (
    <ActionForm action="/runs/fetch-now">
      <Button title={t('fetch.runTheHourlyFetchNow')}>
        <Icon name="play" size={16} />
        {t('fetch.fetchNow')}
      </Button>
    </ActionForm>
  );

/**
 * Live progress for a "Fetch now" run: target-run.mjs polls the state route
 * with fetch-run.mjs narrating the sources as they answer. Terminal states
 * reload into the server-side redirect (flash on /runs).
 */
export const FetchRunPage: FC<{ run: FetchRun }> = ({ run }) => {
  const failed = run.stage === 'error';
  const currentIdx = FETCH_RUN_STEPS.indexOf(run.stage);
  const elapsed = Math.max(0, Math.round((Date.now() - run.startedAt) / 1000));
  const heading = failed ? t('fetch.failed') : t('fetch.running');
  return (
    <Layout title={failed ? heading : t('fetch.runningTitle')} active="runs">
      <div class="w-full pt-6 lg:pt-16">
        <Card>
          <div class="mb-1 text-entity text-ink">{heading}</div>
          <div class="text-sm text-ink-muted">
            {run.classify
              ? t('fetch.everyEnabledSourceThenThe')
              : t('fetch.everyEnabledSourceNewJobs')}
          </div>

          {failed ? (
            <div class="mt-4 space-y-4">
              <Notice tone="danger" role="alert">
                {run.error ?? FETCH_FAILED}
              </Notice>
              <div class="flex flex-wrap gap-2">
                <Button href={run.backUrl} variant="secondary">
                  ← {run.backUrl === '/welcome' ? t('fetch.backToSetup') : t('fetch.backToRuns')}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <RunSteps steps={FETCH_RUN_STEPS} currentIdx={currentIdx} view={stepView(run)} />
              <div class="mt-5 flex items-center justify-between gap-3 border-t border-line pt-3">
                <Hint>{t('fetch.youCanCloseThisPage')}</Hint>
                <span id="run-elapsed" class="shrink-0 text-meta tabular-nums text-ink-faint">
                  {elapsed}s
                </span>
              </div>
              <script
                id="run-data"
                type="application/json"
                dangerouslySetInnerHTML={{
                  __html: JSON.stringify({ id: run.id, stateUrl: `/runs/fetch-now/${run.id}/state` }),
                }}
              />
              <script type="module" dangerouslySetInnerHTML={{ __html: RUN_BOOT }} />
            </>
          )}
        </Card>
      </div>
    </Layout>
  );
};

const RUN_BOOT = `
import { init } from '/static/target-run.mjs';
import { fetchActivity } from '/static/fetch-run.mjs';
init(JSON.parse(document.getElementById('run-data').textContent), fetchActivity);
`;
