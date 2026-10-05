/*
 * Per-engine model pickers and task boxes save themselves. Dependency-free ES module served
 * as-is; the settings page boots init(). Progressive: without JS the Save
 * button stays visible and the plain form POST still works.
 *
 * The trigger is `change`, not `input`, on purpose: a <select> commits when
 * you settle on a value (select-commit.mjs: a pointer pick at once, a keyboard
 * pick on blur or Enter — #90), while the free-text engine (openai_api)
 * commits only on blur or Enter — so a half-typed model id is never saved.
 * statusFor is pure — unit-tested from src/web/settings-models.test.ts.
 */

/** What the status line says; the server owns the rejection wording. */
export function statusFor(state, error) {
  switch (state) {
    case 'saving':
      return 'Saving…';
    case 'saved':
      return 'Saved';
    case 'failed':
      return error || 'Could not save — press the Save button to retry';
    default:
      return '';
  }
}

import { wireSelectCommit } from './select-commit.mjs';

const SAVED_CLEAR_MS = 2500;

/** The "who does what" table is drawn by the server; after a save it is read again rather than left showing the answer from before. */
async function refreshPlan() {
  const plan = document.querySelector('[data-ai-plan]');
  if (!plan) return;
  try {
    const res = await fetch(location.href, { headers: { Accept: 'text/html' } });
    const fresh = new DOMParser().parseFromString(await res.text(), 'text/html').querySelector('[data-ai-plan]');
    if (fresh) plan.replaceChildren(...fresh.childNodes);
  } catch {
    // The table catches up on the next page load.
  }
}

function wireForm(form) {
  const status = form.querySelector('[data-save-status]');
  const button = form.querySelector('[data-save-button]');
  if (!status) return;
  // `hidden` alone loses to the button's own display rule, so hide by style.
  const showButton = (on) => {
    if (button) button.style.display = on ? '' : 'none';
  };
  showButton(false);

  let clearTimer = null;
  const show = (state, error) => {
    status.textContent = statusFor(state, error);
    if (clearTimer) clearTimeout(clearTimer);
    if (state === 'saved') clearTimer = setTimeout(() => (status.textContent = ''), SAVED_CLEAR_MS);
  };

  const save = async () => {
    show('saving');
    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: new URLSearchParams(new FormData(form)),
      });
      const data = await res.json().catch(() => ({}));
      // A wrong-family id is a real answer, not a transport failure: show the
      // server's own wording and leave the button out so a retry is one pick.
      if (!res.ok || data.error) {
        show('failed', data.error);
        return;
      }
      show('saved');
      void refreshPlan();
    } catch {
      show('failed');
      showButton(true);
    }
  };
  // A select commits through the keyboard-aware rule; the free-text model id
  // keeps its native change (blur or Enter), which already waits for the user.
  for (const select of form.querySelectorAll('select')) wireSelectCommit(select, save);
  form.addEventListener('change', (e) => {
    if (e.target.tagName !== 'SELECT') void save();
  });
}

export function init() {
  document.querySelectorAll('[data-model-form]').forEach(wireForm);
}
