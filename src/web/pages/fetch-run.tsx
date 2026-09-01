/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import { ActionForm, Button, Card, Hint } from '../ui';
import { RunSteps, type StepView } from './run-steps';
import { FETCH_RUN_STEPS, type FetchRun } from '../fetch-runs';

function stepView(classify: boolean): Record<string, StepView> {
  return {
    fetch: {
      label: 'Ask every enabled source',
      detail: 'one request per board, a polite second apart — a few minutes',
    },
    store: classify
      ? {
          label: 'Score what is new',
          detail:
            'filter, de-duplicate, then the AI scores each new job and alerts on matches — minutes for a big batch',
        }
      : {
          label: 'Store what is new',
          detail: 'filter and de-duplicate; stored unscored — no AI spent while the pipeline is paused',
        },
  };
}

/** "Fetch now" — one form shared by Overview and /runs; a link to the live run while one is in flight. */
export const FetchNowButton: FC<{ run: FetchRun | null }> = ({ run }) =>
  run ? (
    <Button href={`/runs/fetch-now/${run.id}`} size="sm" variant="secondary">
      Fetching… watch
    </Button>
  ) : (
    <ActionForm action="/runs/fetch-now">
      <Button
        size="sm"
        variant="secondary"
        title="Run the hourly fetch now. While the pipeline is paused, new jobs are stored unscored."
      >
        Fetch now
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
  const heading = failed ? 'Fetch failed' : 'Fetching now';
  return (
    <Layout title={failed ? heading : `${heading}…`} active="runs">
      <div class="w-full pt-6 lg:pt-16">
        <Card>
          <div class="mb-1 text-sm font-semibold text-ink">{heading}</div>
          <div class="text-sm text-ink-muted">
            {run.classify
              ? 'Every enabled source, then the new jobs are scored and alerted — the hourly tick, just now.'
              : 'Every enabled source; new jobs are stored unscored because the pipeline is paused.'}
          </div>

          {failed ? (
            <div class="mt-4 space-y-4">
              <div class="rounded-md border border-danger/25 bg-danger/5 px-3.5 py-2.5 text-sm text-danger">
                {run.error ?? 'The run failed — see the web logs.'}
              </div>
              <div class="flex flex-wrap gap-2">
                <Button href="/runs" variant="secondary">
                  ← Back to runs
                </Button>
              </div>
            </div>
          ) : (
            <>
              <RunSteps steps={FETCH_RUN_STEPS} currentIdx={currentIdx} view={stepView(run.classify)} />
              <div class="mt-5 flex items-center justify-between gap-3 border-t border-line pt-3">
                <Hint>You can close this page — the run keeps going, and its row lands on Runs.</Hint>
                <span id="run-elapsed" class="shrink-0 text-xs tabular-nums text-ink-faint">
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
