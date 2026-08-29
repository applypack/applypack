/*
 * Progress-page driver: polls /target/runs/:id/state every 2 s, advances the
 * step list and rotates a "what the analysis is doing right now" line with a
 * fade. On a terminal state it reloads — the server route then redirects with
 * the flash. The activity lines mirror the checklist the prompts actually walk
 * through (profile scoring; the MATCH_SYSTEM steps), paced by stage-elapsed
 * time. activityFor is pure — tested from src/web/target-run.test.ts.
 */

const ACTIVITIES = {
  classify: [
    'Reading the posting…',
    'Scoring fit against the active profile — stack, role type, region, salary…',
  ],
  scan: [
    'Extracting the text an ATS parser would see…',
    'Cataloguing skills, seniority and job-agnostic issues…',
  ],
  match: [
    'Reading the posting and the resume side by side…',
    'Building the keyword frame — must-have, preferred, nice-to-have, primary stack…',
    'Searching the resume for evidence of every keyword…',
    'Grading alignment — title, summary, most recent role…',
    'Checking hard requirements, red flags and facts to confirm…',
    'Drafting edit suggestions and removals with exact quotes…',
    'Composing the deterministic score — almost there…',
  ],
};
const ROTATE_MS = 9000;
const POLL_MS = 2000;
const FADE_MS = 250;

/** Which activity line a step shows after `stageElapsedMs`; holds on the last one. */
export function activityFor(step, stageElapsedMs) {
  const list = ACTIVITIES[step] ?? [];
  if (list.length === 0) return '';
  return list[Math.min(Math.floor(stageElapsedMs / ROTATE_MS), list.length - 1)];
}

export function formatElapsed(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function init(data) {
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
    }
    const active = steps.find((li) => li.dataset.state === 'active');
    if (!active) return;
    const el = active.querySelector('[data-activity]');
    const text = activityFor(active.dataset.step, state.stageElapsedMs);
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
      const res = await fetch(`/target/runs/${data.id}/state`);
      if (res.status === 404) return location.reload();
      if (!res.ok) return;
      state = await res.json();
      if (state.stage === 'done' || state.stage === 'error') return location.reload();
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
