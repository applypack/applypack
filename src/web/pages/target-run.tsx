/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import { Button, Card, Hint, MarkIcon } from '../ui';
import type { RunStep, TargetRun } from '../target-runs';

const STEP_VIEW: Record<RunStep, { label: string; detail: string }> = {
  extract: {
    label: 'Detect posting facts',
    detail: 'company, title, location, salary from the description — seconds',
  },
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
  letter: {
    label: 'Write the cover letter',
    detail: 'grounded in the resume, fact-checked before it is shown — about a minute',
  },
};

/**
 * Live progress: /static/target-run.mjs polls the state route, advances the
 * step icons and fades a "what the analysis is doing right now" line under
 * the active step. Terminal states reload into the server-side redirect.
 */
export const TargetRunPage: FC<{ run: TargetRun }> = ({ run }) => {
  const failed = run.stage === 'error';
  const currentIdx = run.steps.indexOf(run.stage as RunStep);
  const elapsed = Math.max(0, Math.round((Date.now() - run.startedAt) / 1000));
  // A letter run reads oddly as "Comparing" — the verb follows the steps.
  const letter = run.steps.includes('letter');
  const heading = failed
    ? letter
      ? 'Generation failed'
      : 'Comparison failed'
    : letter
      ? 'Writing a cover letter'
      : 'Comparing';
  return (
    <Layout title={failed ? heading : `${heading}…`} active="target">
      <div class="mx-auto w-full max-w-2xl pt-6 lg:pt-16">
        <Card>
          <div class="mb-1 text-sm font-semibold text-ink">{heading}</div>
          <div class="text-sm text-ink-muted">
            "{run.resumeName}" ↔ "<span id="run-job-title">{run.jobTitle}</span>"
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
              <ol class="mt-5 space-y-5" aria-label="Progress">
                {run.steps.map((s, i) => (
                  <li
                    class="step flex items-start gap-3"
                    data-step={s}
                    data-state={i < currentIdx ? 'done' : i === currentIdx ? 'active' : 'pending'}
                  >
                    <span class="mt-0.5 grid h-5 w-5 shrink-0 place-items-center" aria-hidden="true">
                      <span class="i i-done">
                        <MarkIcon kind="check" class="text-ok" />
                      </span>
                      <span class="i i-active h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-accent"></span>
                      <span class="i i-pending h-2 w-2 rounded-full bg-line-strong"></span>
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="t-label block text-sm">{STEP_VIEW[s].label}</span>
                      <span class="t-detail block text-xs">{STEP_VIEW[s].detail}</span>
                      <span
                        class="t-activity mt-1.5 block text-[13px] leading-5 text-violet transition-opacity duration-300"
                        data-activity
                        aria-live="polite"
                      ></span>
                    </span>
                  </li>
                ))}
              </ol>
              <div class="mt-5 flex items-center justify-between gap-3 border-t border-line pt-3">
                <Hint>
                  You can close this page — the run keeps going and the result lands on the job
                  page.
                </Hint>
                <span id="run-elapsed" class="shrink-0 text-xs tabular-nums text-ink-faint">
                  {elapsed}s
                </span>
              </div>
              <style dangerouslySetInnerHTML={{ __html: RUN_CSS }} />
              <script
                id="run-data"
                type="application/json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify({ id: run.id }) }}
              />
              <script type="module" dangerouslySetInnerHTML={{ __html: RUN_BOOT }} />
            </>
          )}
        </Card>
      </div>
    </Layout>
  );
};

/* Step visuals are CSS-driven off data-state so the poller only flips attributes. */
const RUN_CSS = `
  .step .i { display: none; }
  .step[data-state="done"] .i-done,
  .step[data-state="active"] .i-active,
  .step[data-state="pending"] .i-pending { display: block; }
  .step .t-label { color: rgb(var(--ink)); font-weight: 500; }
  .step[data-state="pending"] .t-label { color: rgb(var(--ink-faint)); font-weight: 400; }
  .step .t-detail { color: rgb(var(--ink-faint)); }
  .step[data-state="active"] .t-detail { color: rgb(var(--ink-muted)); }
  .step .t-activity { display: none; }
  .step[data-state="active"] .t-activity { display: block; }
`;

const RUN_BOOT = `
import { init } from '/static/target-run.mjs';
init(JSON.parse(document.getElementById('run-data').textContent));
`;
