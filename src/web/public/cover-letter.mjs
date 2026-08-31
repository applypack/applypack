/*
 * Cover-letter card behaviour. Dependency-free ES module served as-is; the
 * card boots init(). Progressive: without JS the Save button is visible and
 * the plain form POST still works, so nothing here is load-bearing.
 *   - the letter autosaves while you type (debounced), the button hides;
 *   - Copy puts the current text on the clipboard.
 * statusFor and nextDelay are pure — unit-tested from src/web/cover-letter.test.ts.
 */

const SAVE_DEBOUNCE_MS = 900;
const COPY_RESET_MS = 1500;

/** What the status line says for a given save state. */
export function statusFor(state, verdict) {
  switch (state) {
    case 'dirty':
      return 'Unsaved changes…';
    case 'saving':
      return 'Saving…';
    case 'saved':
      return verdict === 'block'
        ? 'Saved — the fact check flags a claim in your edit'
        : verdict === 'warn'
          ? 'Saved — the fact check could not read one claim'
          : 'Saved';
    case 'failed':
      return 'Could not save — press Save to retry';
    default:
      return '';
  }
}

/** Retry backoff after a failed autosave; capped so it never sleeps forever. */
export function nextDelay(attempt) {
  return Math.min(SAVE_DEBOUNCE_MS * 2 ** attempt, 15_000);
}

function wireCopy() {
  for (const btn of document.querySelectorAll('[data-copy-target]')) {
    btn.addEventListener('click', async () => {
      const el = document.getElementById(btn.dataset.copyTarget);
      if (!el) return;
      let ok = true;
      try {
        await navigator.clipboard.writeText(el.value);
      } catch {
        el.select();
        ok = typeof document.execCommand === 'function' && document.execCommand('copy');
      }
      const original = btn.textContent;
      btn.textContent = ok ? 'Copied' : 'Copy failed';
      btn.disabled = true;
      setTimeout(() => {
        btn.textContent = original;
        btn.disabled = false;
      }, COPY_RESET_MS);
    });
  }
}

function wireAutosave() {
  const form = document.querySelector('[data-letter-form]');
  if (!form) return;
  const area = form.querySelector('textarea[name=text]');
  const status = form.querySelector('[data-save-status]');
  const button = form.querySelector('[data-save-button]');
  const counter = form.querySelector('[data-word-count]');
  if (!area || !status) return;

  // The button is the no-JS path; autosave replaces it. `hidden` alone loses
  // to the button's own `display: inline-flex`, so hide it by style.
  const showButton = (on) => {
    if (button) button.style.display = on ? '' : 'none';
  };
  showButton(false);
  let saved = area.value;
  let timer = null;
  let attempt = 0;
  let inFlight = false;

  const show = (state, verdict) => {
    status.textContent = statusFor(state, verdict);
    status.dataset.state = state;
  };

  async function save() {
    if (inFlight) return;
    const text = area.value;
    if (text === saved) return;
    inFlight = true;
    show('saving');
    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ text }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      saved = text;
      attempt = 0;
      show('saved', data.gateVerdict);
    } catch {
      attempt += 1;
      show('failed');
      showButton(true);
      timer = setTimeout(save, nextDelay(attempt));
    } finally {
      inFlight = false;
    }
  }

  area.addEventListener('input', () => {
    if (counter) counter.textContent = String(area.value.trim().split(/\s+/).filter(Boolean).length);
    if (area.value === saved) {
      show('');
      return;
    }
    show('dirty');
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, SAVE_DEBOUNCE_MS);
  });

  // Leaving the field commits immediately — no waiting out the debounce.
  area.addEventListener('blur', () => {
    if (timer) clearTimeout(timer);
    void save();
  });

  // A pending edit must not be lost to a navigation.
  window.addEventListener('pagehide', () => {
    if (area.value === saved) return;
    navigator.sendBeacon?.(form.action, new URLSearchParams({ text: area.value }));
  });
}

export function init() {
  wireCopy();
  wireAutosave();
}
