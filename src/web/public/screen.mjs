/*
 * The screening page's two behaviours, both progressive: while a run is in
 * flight the results line polls the state route and reloads when it ends;
 * a decision select saves itself (select-commit.mjs). Without JS the page
 * still works — the Score button says how many are pending on reload, and
 * the decision form has a Save button in <noscript>.
 */
import { wireSelectCommits } from './select-commit.mjs';

const POLL_MS = 2000;

/** "Scoring… 12 of 40 (2 failed)" — pure, tested from src/web/screen.test.ts. */
export function progressLine(state) {
  const done = state.done + state.failed;
  const failed = state.failed > 0 ? ` (${state.failed} failed)` : '';
  return `Scoring… ${done} of ${state.total}${failed} — one call per applicant, three at a time; the page updates itself.`;
}

function pollProgress(el) {
  const id = el.dataset.screening;
  async function tick() {
    try {
      const res = await fetch(`/screen/${id}/state`);
      if (!res.ok) return location.reload();
      const state = await res.json();
      if (!state.running) return location.reload();
      el.textContent = progressLine(state);
    } catch {
      /* transient — the next tick retries */
    }
    setTimeout(tick, POLL_MS);
  }
  setTimeout(tick, POLL_MS);
}

export function init() {
  wireSelectCommits(document);
  const progress = document.getElementById('run-progress');
  if (progress && progress.dataset.running) pollProgress(progress);
}
