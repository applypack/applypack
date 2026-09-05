/*
 * The AI-check chip beside the score (#184): what one poll of a background
 * run's state reads as. Pure — tested from src/web/run-chip.test.ts; the page
 * paints it and re-polls while the run is live.
 */

const TONE = { running: 'text-ink-muted', done: 'text-ok', error: 'text-danger' };

/** The first step result the run recorded — "AI match 91/100" — whatever the step was called. */
function firstResult(state) {
  const results = state.results && typeof state.results === 'object' ? Object.values(state.results) : [];
  return results.find((r) => typeof r === 'string' && r.length > 0) ?? null;
}

/**
 * null = nothing to show (the run is gone). `link.label` is the one action:
 * the progress page while it runs, the result when it landed.
 */
export function runChip(state, runUrl) {
  if (!state || state.gone) return null;
  if (state.stage === 'error') {
    return { kind: 'error', tone: TONE.error, text: 'AI check failed', link: { href: runUrl, label: 'why' } };
  }
  if (state.stage === 'done') {
    const result = firstResult(state) ?? 'done';
    return {
      kind: 'done',
      tone: TONE.done,
      text: `AI check ready: ${result}`,
      link: state.resultUrl ? { href: state.resultUrl, label: 'Use it' } : null,
    };
  }
  const seconds = Math.max(0, Math.round((state.elapsedMs ?? 0) / 1000));
  return { kind: 'running', tone: TONE.running, text: `AI check running · ${seconds} s`, link: { href: runUrl, label: 'progress' } };
}

/** Whether the page should ask again. */
export function runLive(state) {
  return Boolean(state) && !state.gone && state.stage !== 'done' && state.stage !== 'error';
}
