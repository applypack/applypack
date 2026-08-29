/*
 * Enhancements for the /target launcher. Served as a static ES module; the
 * page boots init(). Behaviors: focusing a field inside a resume-mode box
 * selects that mode; pasting a description trims page chrome from it
 * (posting-clean.mjs — the job-header block with salary survives) and
 * auto-fills EMPTY company / title / location via POST /target/extract.
 * Salary and workplace land in hidden fields; a field the user filled is
 * never overwritten. mergeExtracted is pure — tested from
 * src/web/target-start.test.ts; importing this module touches no DOM.
 */

import { cleanPostingText } from './posting-clean.mjs';

export const MIN_DESCRIPTION_CHARS = 200;
const PULSE = ['animate-pulse', 'ring-2', 'ring-violet/30'];
const FILLED_FLASH = ['ring-2', 'ring-violet/40'];

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
  const hidden = {
    salaryMin: form.elements.salaryMin,
    salaryMax: form.elements.salaryMax,
    workplace: form.elements.workplace,
  };
  const status = document.getElementById('extract-status');
  const spin = document.getElementById('extract-spin');
  const text = document.getElementById('extract-text');
  let busy = false;
  let pendingSubmit = false;

  function say(message, spinning) {
    status.hidden = false;
    spin.hidden = !spinning;
    text.textContent = message;
  }

  async function autofill(postingText, trimmedNote) {
    if (busy || postingText.trim().length < MIN_DESCRIPTION_CHARS) return;
    const emptyFields = Object.values(fields).filter((el) => !el.value.trim());
    if (emptyFields.length === 0) {
      if (trimmedNote) say(trimmedNote, false);
      return;
    }
    busy = true;
    for (const el of emptyFields) el.classList.add(...PULSE);
    say('Analyzing the pasted posting — detecting company, title and location…', true);
    try {
      const res = await fetch('/target/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: postingText }),
      });
      const extracted = res.ok ? await res.json() : null;
      const current = {
        company: fields.company.value,
        title: fields.title.value,
        location: fields.location.value,
      };
      const patch = mergeExtracted(current, extracted);
      for (const [key, value] of Object.entries(patch)) {
        fields[key].value = value;
        fields[key].classList.add(...FILLED_FLASH);
        setTimeout(() => fields[key].classList.remove(...FILLED_FLASH), 1500);
      }
      if (extracted) {
        if (extracted.salaryMin) hidden.salaryMin.value = String(extracted.salaryMin);
        if (extracted.salaryMax) hidden.salaryMax.value = String(extracted.salaryMax);
        if (extracted.workplace) hidden.workplace.value = extracted.workplace;
      }
      const found = Object.keys(patch);
      const parts = [];
      if (trimmedNote) parts.push(trimmedNote);
      parts.push(
        found.length
          ? 'Auto-filled: ' + found.join(', ') + ' — check before comparing.'
          : 'Could not detect the empty fields — fill them in manually.',
      );
      if (extracted && (extracted.salaryMin || extracted.salaryMax)) parts.push('Salary saved to the job.');
      say(parts.join(' '), false);
    } catch {
      status.hidden = true;
    }
    for (const el of Object.values(fields)) el.classList.remove(...PULSE);
    busy = false;
    if (pendingSubmit) {
      pendingSubmit = false;
      form.submit(); // bypasses the submit listener — no recursion
    }
  }

  // Compare pressed while detection is in flight: wait for it, then submit —
  // otherwise the POST would race the auto-fill and land with empty fields.
  form.addEventListener('submit', (e) => {
    if (!busy) return;
    e.preventDefault();
    pendingSubmit = true;
    say('Finishing detection, then comparing…', true);
  });

  // Detection runs ONLY after a paste — never on load, never while typing.
  // (paste fires before the textarea value updates, hence the timeout.)
  // The extractor gets the CLEANED text: the cleaner keeps the job-header
  // block, so company / title / salary survive while the nav chrome —
  // which would otherwise eat the extractor's 3500-char head — is gone.
  desc.addEventListener('paste', () =>
    setTimeout(() => {
      const raw = desc.value;
      const cleaned = cleanPostingText(raw);
      let note = '';
      if (cleaned !== raw) {
        desc.value = cleaned;
        note = 'Trimmed page chrome from the paste.';
      }
      void autofill(cleaned, note);
    }, 50),
  );
  // Clearing the description clears the status with it.
  desc.addEventListener('input', () => {
    if (!busy && desc.value.trim().length < MIN_DESCRIPTION_CHARS) status.hidden = true;
  });
}
