/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import { Button, Card, Hint } from '../ui';
import { RunSteps, type StepView } from './run-steps';
import type { RunStep, TargetRun } from '../target-runs';

const STEP_VIEW: Record<RunStep, StepView> = {
  fetch: {
    label: 'Read the posting page',
    detail: 'one request to the URL you gave — seconds',
  },
  extract: {
    label: 'Detect posting facts',
    detail: 'company, title, location, salary from the description — seconds',
  },
  scan: {
    // Also reached by a plain re-scan and a first upload, where there is no
    // "new version" to speak of.
    label: 'Read the resume',
    detail: 'headline, skills, ATS issues — about a minute',
  },
  match: {
    label: 'AI match',
    detail: 'the resume model reads both texts — about a minute',
  },
  verify: {
    label: 'Research the company',
    detail: 'ghost-check with web search — 2 to 4 minutes',
  },
  letter: {
    label: 'Write the cover letter',
    detail: 'grounded in the resume, fact-checked before it is shown — about a minute',
  },
  score: {
    label: 'Score the best matches',
    detail: 'the AI reads each one against your profile — seconds on an API engine, up to half a minute on a CLI one',
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
  // A letter run reads oddly as "Comparing" — the verb follows the steps;
  // wizard runs (scan / score) bring their own copy.
  const letter = run.steps.includes('letter');
  const copy = run.heading ?? {
    running: letter ? 'Writing a cover letter' : 'Comparing',
    failed: letter ? 'Generation failed' : 'Comparison failed',
  };
  const heading = failed ? copy.failed : copy.running;
  return (
    <Layout title={failed ? heading : `${heading}…`} active={run.heading ? undefined : 'target'}>
      <div class="mx-auto w-full max-w-2xl pt-6 lg:pt-16">
        <Card>
          <div class="mb-1 text-sm font-semibold text-ink">{heading}</div>
          <div class="text-sm text-ink-muted">
            {run.subtitle ?? (
              <>
                "{run.resumeName}" ↔ "<span id="run-job-title">{run.jobTitle}</span>"
              </>
            )}
          </div>

          {failed ? (
            <div class="mt-4 space-y-4">
              <div class="rounded-md border border-danger/25 bg-danger/5 px-3.5 py-2.5 text-sm text-danger">
                {run.error ?? 'Unexpected failure — see the web logs.'}
              </div>
              <div class="flex flex-wrap gap-2">
                <Button href={run.backUrl} variant="secondary">
                  ← {run.backLabel}
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
              <RunSteps steps={run.steps} currentIdx={currentIdx} view={STEP_VIEW} />
              <div class="mt-5 flex items-center justify-between gap-3 border-t border-line pt-3">
                <Hint>
                  You can close this page — the run keeps going and the result lands{' '}
                  {run.heading ? 'back in setup' : 'on the job page'}.
                </Hint>
                <span id="run-elapsed" class="shrink-0 text-xs tabular-nums text-ink-faint">
                  {elapsed}s
                </span>
              </div>
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

const RUN_BOOT = `
import { init } from '/static/target-run.mjs';
init(JSON.parse(document.getElementById('run-data').textContent));
`;
