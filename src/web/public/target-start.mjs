/*
 * Enhancements for the /target launcher. Served as a static ES module; the
 * page boots init(). Two behaviors: focusing a field inside a resume-mode
 * box selects that mode, and a pasted description gets page chrome trimmed
 * in place (posting-clean.mjs — the job-header block with title / company /
 * salary survives). Empty fields are detected server-side, inside the run.
 * Importing this module touches no DOM.
 */

import { cleanPostingText } from './posting-clean.mjs';

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
  // paste fires before the textarea value updates, hence the timeout.
  desc.addEventListener('paste', () =>
    setTimeout(() => {
      const cleaned = cleanPostingText(desc.value);
      if (cleaned !== desc.value) desc.value = cleaned;
    }, 50),
  );
}
