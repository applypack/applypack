/*
 * Copy-to-clipboard for the cover letter card. Dependency-free ES module
 * served as-is from /static/ (import-smoke-tested from cover-letter-card
 * tests — no DOM at import time).
 */

const RESET_MS = 1500;

export function init() {
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
      }, RESET_MS);
    });
  }
}
