/*
 * Copy-to-clipboard, shared by every page that offers one. Dependency-free ES
 * module served as-is; the page imports wireCopy() once and every
 * `[data-copy]` (literal text) and `[data-copy-target]` (an element's value)
 * button works from then on.
 *
 * Two things it does that a bare navigator.clipboard call does not: it falls
 * back to a hidden textarea + execCommand where the Clipboard API is refused
 * (Safari without a user-gesture chain, an insecure origin), and it announces
 * the result in a polite live region, because a button that only changes its
 * own label says nothing to a screen reader.
 */

const RESET_MS = 2000;
const LIVE_ID = 'copy-live';
/**
 * Roots already listening. /jobs/:id boots this module itself AND through the
 * cover-letter card, so without this every click there would copy twice.
 */
const wired = new WeakSet();

/** The one live region per page, created on first use so no page has to carry the markup. */
function liveRegion() {
  let el = document.getElementById(LIVE_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = LIVE_ID;
    el.setAttribute('aria-live', 'polite');
    // Off-screen rather than hidden: display:none is not announced.
    el.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap';
    document.body.appendChild(el);
  }
  return el;
}

export function announce(message) {
  liveRegion().textContent = message;
}

/** Put `text` on the clipboard. Resolves to whether it landed. */
export async function copyToClipboard(text) {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // execCommand needs a selection in the document, so borrow one off-screen.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = typeof document.execCommand === 'function' && document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

/** Say it on the button and in the live region, then put the button back. */
export function flashCopied(button, ok) {
  const original = button.dataset.copyLabel ?? button.textContent;
  button.dataset.copyLabel = original;
  button.textContent = ok ? 'Copied' : 'Copy failed';
  announce(ok ? 'Copied to clipboard' : 'Could not copy — select the text and copy it by hand');
  clearTimeout(Number(button.dataset.copyTimer));
  button.dataset.copyTimer = String(
    setTimeout(() => {
      button.textContent = original;
    }, RESET_MS),
  );
}

/** Copy `text` and report it on `button` — for buttons whose payload is built at click time. */
export async function copyFrom(button, text) {
  flashCopied(button, await copyToClipboard(text));
}

/**
 * Delegate clicks inside `root`: `[data-copy]` copies the attribute's own text,
 * `[data-copy-target]` copies the value of the element with that id. Delegation
 * rather than per-button listeners, so markup rendered after boot works too.
 */
export function wireCopy(root = document) {
  if (wired.has(root)) return;
  wired.add(root);
  root.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-copy], [data-copy-target]');
    if (!button || !root.contains(button)) return;
    const source = button.dataset.copyTarget ? document.getElementById(button.dataset.copyTarget) : null;
    const text = button.dataset.copyTarget ? (source?.value ?? source?.textContent ?? '') : button.dataset.copy;
    copyFrom(button, text ?? '');
  });
}
