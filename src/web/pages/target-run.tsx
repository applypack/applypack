/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import { Button, Card, Hint, MarkIcon } from '../ui';
import type { RunStep, TargetRun } from '../target-runs';

const STEP_VIEW: Record<RunStep, { label: string; detail: string }> = {
  classify: {
    label: 'Classify the posting',
    detail: 'fit score against the active profile — seconds',
  },
  scan: {
    label: 'Scan the new resume version',
    detail: 'headline, skills, ATS issues — about a minute',
  },
  match: {
    label: 'AI match',
    detail: 'the resume model reads both texts — about a minute',
  },
};

/** Server-rendered progress: meta-refreshes every 2 s until the run resolves. */
export const TargetRunPage: FC<{ run: TargetRun }> = ({ run }) => {
  const failed = run.stage === 'error';
  const currentIdx = run.steps.indexOf(run.stage as RunStep);
  const elapsed = Math.max(0, Math.round((Date.now() - run.startedAt) / 1000));
  return (
    <Layout title={failed ? 'Comparison failed' : 'Comparing…'} active="target" refresh={failed ? undefined : 2}>
      <div class="mx-auto w-full max-w-xl pt-6 lg:pt-16">
        <Card>
          <div class="mb-1 text-sm font-semibold text-ink">
            {failed ? 'Comparison failed' : 'Comparing'}
          </div>
          <div class="text-sm text-ink-muted">
            "{run.resumeName}" ↔ "{run.jobTitle}"
          </div>

          {failed ? (
            <div class="mt-4 space-y-4">
              <div class="rounded-md border border-danger/25 bg-danger/5 px-3.5 py-2.5 text-sm text-danger">
                {run.error ?? 'Unexpected failure — see the web logs.'}
              </div>
              <div class="flex flex-wrap gap-2">
                <Button href="/target" variant="secondary">
                  ← Back to Target
                </Button>
                {run.jobId && (
                  <Button href={`/jobs/${run.jobId}`} variant="secondary">
                    Open the saved job
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <>
              <ol class="mt-5 space-y-4">
                {run.steps.map((s, i) => {
                  const state = i < currentIdx ? 'done' : i === currentIdx ? 'active' : 'pending';
                  return (
                    <li class="flex items-start gap-3">
                      <span class="mt-0.5 grid h-5 w-5 shrink-0 place-items-center" aria-hidden="true">
                        {state === 'done' ? (
                          <MarkIcon kind="check" class="text-ok" />
                        ) : state === 'active' ? (
                          <span class="h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
                        ) : (
                          <span class="h-2 w-2 rounded-full bg-line-strong" />
                        )}
                      </span>
                      <span class="min-w-0">
                        <span
                          class={`block text-sm ${
                            state === 'pending' ? 'text-ink-faint' : 'font-medium text-ink'
                          }`}
                        >
                          {STEP_VIEW[s].label}
                          {state === 'done' && <span class="sr-only"> — done</span>}
                          {state === 'active' && <span class="sr-only"> — in progress</span>}
                        </span>
                        <span
                          class={`block text-xs ${
                            state === 'active' ? 'text-ink-muted' : 'text-ink-faint'
                          }`}
                        >
                          {STEP_VIEW[s].detail}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ol>
              <div class="mt-5 flex items-center justify-between gap-3 border-t border-line pt-3">
                <Hint>Refreshes every 2 s and opens the result automatically.</Hint>
                <span class="shrink-0 text-xs tabular-nums text-ink-faint" aria-live="polite">
                  {elapsed}s
                </span>
              </div>
            </>
          )}
        </Card>
      </div>
    </Layout>
  );
};
