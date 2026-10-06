/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import { Button, Card, Hint, Notice } from '../ui';
import { RunSteps, type StepView } from './run-steps';
import { LETTER_FAILED, UNEXPECTED_FAILURE, type RunStep, type TargetRun } from '../target-runs';
import { bandFor, laneLabel, type Lane } from '../lane';
import type { MessageKey } from '../../i18n/catalog';
import { t } from '../../i18n/t';

/** Every step a run can show; its label is `target.step.<step>` and the line under it `target.step.<step>.detail`. */
const STEPS = [
  'liveness',
  'fetch',
  'extract',
  'brief',
  'scan',
  'structure',
  'keywords',
  'match',
  'suggestions',
  'verify',
  'letter',
  'review',
  'score',
  'compare',
] as const satisfies readonly RunStep[];

/** The engine × model behind the steps: reading the resume and analysing it are two tasks, and may be two engines (ADR 0060). */
export interface RunLanes {
  read: Lane;
  analysis: Lane;
}

/** What the timed steps cost when the lane is not one we measured. */
const GENERIC_BAND = {
  // No measured band yet: the posting is the shortest prompt of the family,
  // and on the second comparison of the same posting it costs nothing at all.
  brief: 'target.band.briefFirst',
  scan: 'target.band.halfToOne',
  structure: 'target.band.halfToOne',
  keywords: 'target.band.halfToOne',
  match: 'target.band.matchOpus',
  suggestions: 'target.band.minuteOpus',
  review: 'target.band.minuteOpus',
} as const satisfies Partial<Record<RunStep, MessageKey>>;

const isTimed = (step: RunStep): step is keyof typeof GENERIC_BAND => step in GENERIC_BAND;

/** The step copy with this install's measured band appended — "about 20 s on Sonnet 5 through the Claude CLI" (#184). */
function stepView(lanes: RunLanes): Record<string, StepView> {
  const out: Record<string, StepView> = {};
  for (const step of STEPS) {
    const detail = t(`target.step.${step}.detail`);
    if (!isTimed(step)) {
      out[step] = { label: t(`target.step.${step}`), detail };
      continue;
    }
    const lane = step === 'scan' || step === 'structure' ? lanes.read : lanes.analysis;
    const band = bandFor(step, lane);
    const when = band ? t('target.band.measured', { band, lane: laneLabel(lane) }) : t(GENERIC_BAND[step]);
    out[step] = { label: t(`target.step.${step}`), detail: t('target.step.timed', { detail, when }) };
  }
  return out;
}

/**
 * Live progress: /static/target-run.mjs polls the state route, advances the
 * step icons and fades a "what the analysis is doing right now" line under
 * the active step. Terminal states reload into the server-side redirect.
 */
export const TargetRunPage: FC<{ run: TargetRun; lanes: RunLanes }> = ({ run, lanes }) => {
  const failed = run.stage === 'error';
  const currentIdx = run.steps.indexOf(run.stage as RunStep);
  const elapsed = Math.max(0, Math.round((Date.now() - run.startedAt) / 1000));
  // A letter or suggestions run reads oddly as "Comparing" — the verb follows
  // the steps; wizard runs (scan / score) bring their own copy.
  const copy = run.heading ?? runCopy(run.steps);
  const heading = failed ? copy.failed : copy.running;
  return (
    <Layout title={failed ? heading : t('target.run.titleRunning', { heading })} active={run.heading ? undefined : 'target'}>
      <div class="mx-auto w-full max-w-2xl pt-6 lg:pt-16">
        <Card>
          <div class="mb-1 text-entity text-ink">{heading}</div>
          <div class="text-sm text-ink-muted">
            {run.subtitle ?? (
              // Two names as the user gave them: a resume and a posting's title.
              <span translate="no">
                "{run.resumeName}" ↔ "<span id="run-job-title">{run.jobTitle}</span>"
              </span>
            )}
          </div>

          {failed ? (
            <div class="mt-4 space-y-4">
              <Notice tone="danger" role="alert">
                {runError(run.error)}
              </Notice>
              <div class="flex flex-wrap gap-2">
                <Button href={run.backUrl} variant="secondary">
                  ← {run.backLabel}
                </Button>
                {run.jobId && (
                  <Button href={`/jobs/${run.jobId}`} variant="secondary">
                    {t('target.run.openSavedJob')}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <>
              <RunSteps
                steps={run.steps}
                currentIdx={currentIdx}
                view={stepView(lanes)}
                stepMs={run.stepMs}
                activeMs={Date.now() - run.stageAt}
                results={run.results}
              />
              <div class="mt-5 flex items-center justify-between gap-3 border-t border-line pt-3">
                <Hint>
                  {t(run.backUrl.startsWith('/screen') ? 'target.run.closeScreening' : run.heading ? 'target.run.closeSetup' : 'target.run.closeJob')}
                </Hint>
                <span id="run-elapsed" class="shrink-0 text-meta tabular-nums text-ink-faint">
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
  if (steps.includes('letter')) return { running: t('target.run.letter.running'), failed: t('target.run.letter.failed') };
  if (steps.includes('structure')) return { running: t('target.run.structure.running'), failed: t('target.run.structure.failed') };
  if (steps.includes('suggestions')) return { running: t('target.run.suggestions.running'), failed: t('target.run.suggestions.failed') };
  return { running: t('target.run.compare.running'), failed: t('target.run.compare.failed') };
}

/**
 * The error a failed run shows. A chain that threw stored nothing, and the
 * letter routes store `LETTER_FAILED` as it is written, so both are worded
 * here, in the reader's language; any other error is the sentence its route wrote.
 */
function runError(error: string | undefined): string {
  if (error === undefined) return t(UNEXPECTED_FAILURE);
  return error === LETTER_FAILED ? t('target.run.letterFailed') : error;
}

const RUN_BOOT = `
import { init } from '/static/target-run.mjs';
init(JSON.parse(document.getElementById('run-data').textContent));
`;
