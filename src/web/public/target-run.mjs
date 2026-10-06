/*
 * Progress-page driver: polls the run's state route every 2 s, advances the
 * step list and rotates a "what the analysis is doing right now" line with a
 * fade. On a terminal state it reloads — the server route then redirects with
 * the flash. The activity lines mirror the checklist the prompts actually walk
 * through (profile scoring; the MATCH_SYSTEM steps), paced by stage-elapsed
 * time. The "Fetch now" page reuses init with its own state URL and activity
 * function (fetch-run.mjs). activityFor / paced are pure — tested from
 * src/web/target-run.test.ts.
 */

import { t } from './i18n.mjs';

/* The lines are catalog keys (`browser.activity.*`), worded in the page's language when one shows. */

/** The judgment half of the match prompt — walked by both variants. */
const VERDICT_LINES = [
  'browser.activity.verdict1',
  'browser.activity.verdict2',
  'browser.activity.verdict3',
  'browser.activity.verdict4',
  'browser.activity.verdict5',
];
const SCORE_LINE = 'browser.activity.scoreLine';

const ACTIVITIES = {
  fetch: ['browser.activity.fetch1', 'browser.activity.fetch2'],
  extract: ['browser.activity.extract1', 'browser.activity.extract2'],
  scan: ['browser.activity.scan1', 'browser.activity.scan2'],
  structure: ['browser.activity.structure1', 'browser.activity.structure2', 'browser.activity.structure3'],
  // The quick check walks the same steps as the full report minus the
  // suggestion drafting, so the two lists are one list (ADR 0029).
  keywords: [...VERDICT_LINES, SCORE_LINE],
  match: [...VERDICT_LINES, 'browser.activity.matchDraft', SCORE_LINE],
  suggestions: ['browser.activity.suggestions1', 'browser.activity.suggestions2', 'browser.activity.suggestions3'],
  liveness: ['browser.activity.liveness1', 'browser.activity.liveness2'],
  // The prompt's seven named checks (EVIDENCE_CHECKS), in its order.
  verify: [
    'browser.activity.verify1',
    'browser.activity.verify2',
    'browser.activity.verify3',
    'browser.activity.verify4',
    'browser.activity.verify5',
    'browser.activity.verify6',
    'browser.activity.verify7',
    'browser.activity.verify8',
  ],
  brief: [
    'browser.activity.brief1',
    'browser.activity.brief2',
    'browser.activity.brief3',
    'browser.activity.brief4',
    'browser.activity.brief5',
    'browser.activity.brief6',
  ],
  letter: ['browser.activity.letter1', 'browser.activity.letter2', 'browser.activity.letter3', 'browser.activity.letter4'],
  review: [
    'browser.activity.review1',
    'browser.activity.review2',
    'browser.activity.review3',
    'browser.activity.review4',
    'browser.activity.review5',
    'browser.activity.review6',
  ],
  score: ['browser.activity.score1', 'browser.activity.score2'],
  import: ['browser.activity.import1', 'browser.activity.import2', 'browser.activity.import3'],
};
const ROTATE_MS = 9000;
const POLL_MS = 2000;
const FADE_MS = 250;

/** Which entry of `list` shows after `elapsedMs`; holds on the last one. */
export function paced(list, elapsedMs) {
  if (list.length === 0) return '';
  return list[Math.min(Math.floor(elapsedMs / ROTATE_MS), list.length - 1)];
}

/** Which activity line a step shows after `stageElapsedMs`. */
export function activityFor(step, stageElapsedMs) {
  const key = paced(ACTIVITIES[step] ?? [], stageElapsedMs);
  return key ? t(key) : '';
}

/** "12 of 100 jobs scored" — the line once the run reports real counts; a step without a unit of its own says "done". */
export function progressLine(step, progress) {
  return t('browser.run.progress', { unit: step === 'score' ? 'score' : 'other', done: progress.done, total: progress.total });
}

function defaultActivity(step, state) {
  return state.progress ? progressLine(step, state.progress) : activityFor(step, state.stageElapsedMs);
}

export function formatElapsed(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? t('browser.duration.seconds', { n: s }) : t('browser.duration.minutesSeconds', { m: Math.floor(s / 60), s: s % 60 });
}

/** The time slot next to a step: its final time once done, a live count while active. */
export function stepTime(stepState, step, state) {
  if (stepState === 'active') return formatElapsed(state.stageElapsedMs);
  if (stepState === 'done' && state.stepMs && state.stepMs[step] != null) return formatElapsed(state.stepMs[step]);
  return '';
}

export function init(data, activity = defaultActivity) {
  const steps = [...document.querySelectorAll('[data-step]')];
  const elapsedEl = document.getElementById('run-elapsed');
  let state = null;
  let shownText = '';

  function apply() {
    if (!state) return;
    const idx = state.steps.indexOf(state.stage);
    for (const li of steps) {
      const i = state.steps.indexOf(li.dataset.step);
      // idx === -1 means a terminal stage: everything reads done while we reload.
      li.dataset.state = idx === -1 || i < idx ? 'done' : i === idx ? 'active' : 'pending';
      const timeEl = li.querySelector('[data-step-time]');
      if (timeEl) timeEl.textContent = stepTime(li.dataset.state, li.dataset.step, state);
      const resultEl = li.querySelector('[data-result]');
      if (resultEl && state.results) resultEl.textContent = state.results[li.dataset.step] ?? '';
    }
    const active = steps.find((li) => li.dataset.state === 'active');
    if (!active) return;
    const el = active.querySelector('[data-activity]');
    const text = activity(active.dataset.step, state);
    if (el && text !== shownText) {
      shownText = text;
      el.style.opacity = '0';
      setTimeout(() => {
        el.textContent = text;
        el.style.opacity = '1';
      }, FADE_MS);
    }
  }

  async function poll() {
    try {
      const res = await fetch(data.stateUrl ?? `/target/runs/${data.id}/state`);
      if (res.status === 404) return location.reload();
      if (!res.ok) return;
      state = await res.json();
      if (state.stage === 'done' || state.stage === 'error') return location.reload();
      // The extract step can rename the run ("Detecting the role…" → real title).
      const titleEl = document.getElementById('run-job-title');
      if (titleEl && state.jobTitle && titleEl.textContent !== state.jobTitle) {
        titleEl.textContent = state.jobTitle;
      }
      apply();
    } catch {
      /* transient network hiccup — the next poll retries */
    }
  }

  // Local 1 s tick keeps the counter and rotation smooth between polls; each
  // poll re-syncs both to the server clock.
  setInterval(() => {
    if (!state) return;
    state.stageElapsedMs += 1000;
    state.elapsedMs += 1000;
    if (elapsedEl) elapsedEl.textContent = formatElapsed(state.elapsedMs);
    apply();
  }, 1000);
  setInterval(poll, POLL_MS);
  void poll();
}
