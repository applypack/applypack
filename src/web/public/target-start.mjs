/*
 * Enhancements for the /target launcher. Served as a static ES module; the
 * page boots init(). The mode boxes and the job filter are the shared
 * launcher behaviour (launcher.mjs); on top of it, a pasted description
 * gets page chrome trimmed in place (posting-clean.mjs — the job-header block
 * with title / company / salary survives). Empty fields are detected
 * server-side, inside the run. Importing this module touches no DOM.
 */

import { cleanPostingText } from './posting-clean.mjs';
import { init as initLauncher } from './launcher.mjs';

export function init() {
  initLauncher();

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
