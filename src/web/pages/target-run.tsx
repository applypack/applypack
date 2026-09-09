/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import { Button, Card, Hint } from '../ui';
import { RunSteps, type StepView } from './run-steps';
import type { RunStep, TargetRun } from '../target-runs';
import { bandFor, laneLabel, type Lane } from '../lane';

const STEP_VIEW: Record<RunStep, StepView> = {
  liveness: {
    label: 'Ask the board and read the posting page',
    detail: 'the free checks — seconds, no AI spent',
  },
  fetch: {
    label: 'Read the posting page',
    detail: 'one request to the URL you gave — seconds',
  },
  extract: {
    label: 'Detect posting facts',
    detail: 'company, title, location, salary from the description — 10 to 40 s on a CLI engine, seconds on an API one',
  },
  brief: {
    label: 'Read the posting',
    detail:
      'the role, the seniority, the industry, who reads your resume first and what impresses them — written once per posting and reused while you edit',
  },
  scan: {
    // Also reached by a plain re-scan and a first upload, where there is no
    // "new version" to speak of.
    label: 'Read the resume',
    detail: 'headline, skills, ATS issues, the resume as a shape',
  },
  structure: {
    label: 'Read the resume as data',
    detail: 'every line copied into the JSON Resume shape, then checked against your own words',
  },
  keywords: {
    label: 'Quick AI check',
    detail: 'the resume model judges every keyword, the gates and the score — no edit suggestions',
  },
  match: {
    label: 'Full AI analysis',
    detail: 'the resume model reads both texts and writes the full report with edit suggestions',
  },
  suggestions: {
    label: 'Edit suggestions',
    detail: 'what to change and what to remove, written from the stored keyword verdicts — the score stays',
  },
  verify: {
    label: 'Research the company',
    detail: 'seven named checks with web search — careers page, LinkedIn, reputation, posting age, salary, named humans, the posting itself — 2 to 4 minutes',
  },
  letter: {
    label: 'Write the cover letter',
    detail: 'grounded in the resume, fact-checked before it is shown — about a minute',
  },
  review: {
    label: 'Review the resume',
    detail: 'six dimensions graded with quotes from your own text, then the advice',
  },
  score: {
    label: 'Score the best matches',
    detail: 'the AI reads each one against your profile — seconds on an API engine, up to half a minute on a CLI one',
  },
  compare: {
    label: 'Read the shortlist head to head',
    detail: 'two readings at once, the second with the resumes in the reverse order — about a minute on a CLI engine',
  },
};

/** What the timed steps cost when the lane is not one we measured. */
const GENERIC_BAND: Partial<Record<RunStep, string>> = {
  // No measured band yet: the posting is the shortest prompt of the family,
  // and on the second comparison of the same posting it costs nothing at all.
  brief: 'half a minute the first time, instant afterwards',
  scan: 'half a minute to a minute',
  structure: 'half a minute to a minute',
  keywords: 'half a minute to a minute',
  match: '1½ to 2 minutes on Opus',
  suggestions: 'about a minute on Opus',
  review: 'about a minute on Opus',
};

/** The step copy with this install's measured band appended — "about 20 s on Sonnet 5 through the Claude CLI" (#184). */
function stepView(lane: Lane): Record<RunStep, StepView> {
  const out = { ...STEP_VIEW };
  for (const step of Object.keys(GENERIC_BAND) as RunStep[]) {
    const band = bandFor(step, lane);
    const when = band ? `about ${band} on ${laneLabel(lane)}` : GENERIC_BAND[step];
    out[step] = { ...STEP_VIEW[step], detail: `${STEP_VIEW[step].detail} — ${when}` };
  }
  return out;
}

/**
 * Live progress: /static/target-run.mjs polls the state route, advances the
 * step icons and fades a "what the analysis is doing right now" line under
 * the active step. Terminal states reload into the server-side redirect.
 */
export const TargetRunPage: FC<{ run: TargetRun; lane: Lane }> = ({ run, lane }) => {
  const failed = run.stage === 'error';
  const currentIdx = run.steps.indexOf(run.stage as RunStep);
  const elapsed = Math.max(0, Math.round((Date.now() - run.startedAt) / 1000));
  // A letter or suggestions run reads oddly as "Comparing" — the verb follows
  // the steps; wizard runs (scan / score) bring their own copy.
  const copy = run.heading ?? runCopy(run.steps);
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
              <RunSteps
                steps={run.steps}
                currentIdx={currentIdx}
                view={stepView(lane)}
                stepMs={run.stepMs}
                activeMs={Date.now() - run.stageAt}
                results={run.results}
              />
              <div class="mt-5 flex items-center justify-between gap-3 border-t border-line pt-3">
                <Hint>
                  You can close this page — the run keeps going and the result lands{' '}
                  {run.backUrl.startsWith('/screen') ? 'on the screening page' : run.heading ? 'back in setup' : 'on the job page'}.
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

function runCopy(steps: RunStep[]): { running: string; failed: string } {
  if (steps.includes('letter')) return { running: 'Writing a cover letter', failed: 'Generation failed' };
  if (steps.includes('structure')) return { running: 'Reading the resume as data', failed: 'The reading failed' };
  if (steps.includes('suggestions')) return { running: 'Writing suggestions', failed: 'Suggestions failed' };
  return { running: 'Comparing', failed: 'Comparison failed' };
}

const RUN_BOOT = `
import { init } from '/static/target-run.mjs';
init(JSON.parse(document.getElementById('run-data').textContent));
`;
