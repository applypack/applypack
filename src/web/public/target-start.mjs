/*
 * Enhancements for the /target launcher. Served as a static ES module; the
 * page boots init(). Two behaviors: focusing a field inside a resume-mode box
 * selects that mode, and pasting a description auto-fills EMPTY company /
 * title / location fields via POST /target/extract. A field the user filled
 * is never overwritten. mergeExtracted is pure — tested from
 * src/web/target-start.test.ts; importing this module touches no DOM.
 */

export const MIN_DESCRIPTION_CHARS = 200;

/** Which extracted values may land in the form: only where the user left it empty. */
export function mergeExtracted(current, extracted) {
  const patch = {};
  if (!extracted) return patch;
  for (const key of ['company', 'title', 'location']) {
    const value = extracted[key];
    if (typeof value === 'string' && value.trim() && !(current[key] ?? '').trim()) {
      patch[key] = value.trim();
    }
  }
  return patch;
}

export function init() {
  document.querySelectorAll('[data-mode]').forEach((box) => {
    const radio = box.querySelector('input[type=radio][name=resumeMode]');
    if (!radio || radio.disabled) return;
    box.addEventListener('focusin', (e) => {
      if (e.target !== radio) radio.checked = true;
    });
  });

  const form = document.getElementById('target-form');
  if (!form) return;
  const desc = form.elements.description;
  const fields = {
    company: form.elements.companyName,
    title: form.elements.title,
    location: form.elements.location,
  };
  const status = document.getElementById('extract-status');
  let busy = false;

  async function autofill() {
    const text = desc.value.trim();
    if (busy || text.length < MIN_DESCRIPTION_CHARS) return;
    if (!Object.values(fields).some((el) => !el.value.trim())) return;
    busy = true;
    status.hidden = false;
    status.textContent = 'Detecting company, title and location from the description…';
    try {
      const res = await fetch('/target/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: text }),
      });
      const extracted = res.ok ? await res.json() : null;
      const current = {
        company: fields.company.value,
        title: fields.title.value,
        location: fields.location.value,
      };
      const patch = mergeExtracted(current, extracted);
      for (const [key, value] of Object.entries(patch)) fields[key].value = value;
      const found = Object.keys(patch);
      status.textContent = found.length
        ? 'Auto-filled from the description: ' + found.join(', ') + ' — check before comparing.'
        : 'Could not detect the empty fields — fill them in manually.';
    } catch {
      status.textContent = '';
      status.hidden = true;
    }
    busy = false;
  }

  // paste fires before the textarea value updates; change covers manual typing.
  desc.addEventListener('paste', () => setTimeout(autofill, 50));
  desc.addEventListener('change', autofill);
}
