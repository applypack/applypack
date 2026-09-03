/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { MarkIcon } from '../ui';

export interface StepView {
  label: string;
  detail: string;
}

/*
 * Step list shared by the progress pages (/target/runs/:id, /runs/fetch-now/:id).
 * data-state drives the visuals through RUN_CSS, so the poller
 * (target-run.mjs) only flips attributes; the activity line under the active
 * step is filled by the page's activity function.
 */
export const RunSteps: FC<{
  steps: string[];
  currentIdx: number;
  view: Record<string, StepView>;
  /** Time already spent: finished steps from the registry, the active one as of this render. */
  stepMs?: Partial<Record<string, number>>;
  activeMs?: number;
}> = ({ steps, currentIdx, view, stepMs = {}, activeMs }) => (
  <>
    <ol class="mt-5 space-y-5" aria-label="Progress">
      {steps.map((s, i) => (
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
            <span class="flex items-baseline gap-2">
              <span class="t-label text-sm">{view[s]?.label ?? s}</span>
              <span class="text-xs tabular-nums text-ink-faint" data-step-time>
                {formatElapsed(i < currentIdx ? stepMs[s] : i === currentIdx ? activeMs : undefined)}
              </span>
            </span>
            <span class="t-detail block text-xs">{view[s]?.detail}</span>
            <span
              class="t-activity mt-1.5 block text-[13px] leading-5 text-violet transition-opacity duration-300"
              data-activity
              aria-live="polite"
            ></span>
          </span>
        </li>
      ))}
    </ol>
    <style dangerouslySetInnerHTML={{ __html: RUN_CSS }} />
  </>
);

/** "4s" / "1m 16s" — the same shape target-run.mjs paints once it polls. */
function formatElapsed(ms: number | undefined): string {
  if (ms === undefined) return '';
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

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
