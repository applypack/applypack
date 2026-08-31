/*
 * Per-engine model pickers save themselves. Dependency-free ES module served
 * as-is; the settings page boots init(). Progressive: without JS the Save
 * button stays visible and the plain form POST still works.
 *
 * The trigger is `change`, not `input`, on purpose: a <select> commits the
 * moment you pick, while the free-text engine (openai_api) commits only on
 * blur or Enter — so a half-typed model id is never saved.
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
      return error || 'Could not save — press Save models to retry';
    default:
      return '';
  }
}

const SAVED_CLEAR_MS = 2500;

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

  form.addEventListener('change', async () => {
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
    } catch {
      show('failed');
      showButton(true);
    }
  });
}

export function init() {
  document.querySelectorAll('[data-model-form]').forEach(wireForm);
}
