/**
 * Navigation progress bar. The dashboard is server-rendered, so every link and
 * every form submit is a full document load — between the click and the first
 * byte nothing on screen moves, and a slow route (a re-classify, a big /jobs
 * page) reads as a frozen tab. This draws that wait.
 *
 * Nothing here ever completes the bar: the new document replaces it. The one
 * case that needs cleaning up is bfcache, which restores the old DOM with the
 * bar still frozen mid-creep.
 */

// A warm local page swaps well under this, so the bar appears only when the
// wait is real — otherwise every click flashes a bar for one frame.
const SHOW_DELAY_MS = 150;
const TICK_MS = 120;
// Never reached on our own: the bar finishes by being replaced, so an
// unexpectedly slow route keeps creeping instead of sitting at a fake 100%.
const CEILING = 90;
const MIN_STEP = 0.4;
const EASE = 0.12;

/**
 * How far the bar creeps in one tick — large steps early, asymptotic near the
 * ceiling. The floor keeps it visibly alive on a long wait, where proportional
 * steps alone would round to nothing.
 */
export function nextWidth(current) {
  if (!(current >= 0)) return 0;
  if (current >= CEILING) return CEILING;
  const step = Math.max(MIN_STEP, (CEILING - current) * EASE);
  return Math.min(CEILING, current + step);
}

/**
 * Whether clicking `link` replaces the current document. Everything that lands
 * somewhere else — a new tab, a download, a mail client — or that only scrolls
 * the page must leave the bar alone, because no load follows and nothing would
 * ever take the bar away.
 *
 * `link` is a plain shape ({ href, target, download }) rather than an element,
 * so the decision is testable without a DOM.
 */
export function shouldTrack(link, event, currentUrl) {
  if (!link || typeof link.href !== 'string' || link.href.length === 0) return false;
  if (event.defaultPrevented) return false;
  // Anything but an unmodified left click opens elsewhere or does nothing.
  if (event.button !== undefined && event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (link.target && link.target !== '_self') return false;
  if (link.download) return false;

  let target;
  let here;
  try {
    target = new URL(link.href, currentUrl);
    here = new URL(currentUrl);
  } catch {
    return false;
  }
  // mailto:, tel:, javascript: — the page stays put.
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return false;
  if (target.origin !== here.origin) return false;
  // Same page, different fragment: the browser scrolls, it does not load.
  // Live cases: the layout's "Skip to content" (#main) and #stages on settings.
  if (target.hash && target.pathname === here.pathname && target.search === here.search) {
    return false;
  }
  return true;
}

/**
 * Wires the bar to navigations.
 *
 * Both listeners sit in the BUBBLE phase on purpose. The dashboard's delete
 * forms carry `if(!confirm(...))return false;` in their onsubmit attribute
 * (ui.tsx ActionForm), and that runs at the target — a capture listener would
 * start the bar before the user answers, then leave it stuck forever when they
 * cancel. By the time the event bubbles up here, defaultPrevented tells the
 * truth.
 */
export function init() {
  const bar = document.getElementById('page-progress');
  if (!bar) return;

  const reduced =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let showTimer = null;
  let tickTimer = null;
  let width = 0;

  function paint() {
    bar.style.transform = `scaleX(${width / 100})`;
  }

  function start() {
    if (showTimer !== null || tickTimer !== null) return;
    showTimer = setTimeout(() => {
      showTimer = null;
      bar.hidden = false;
      if (reduced) {
        // No creep to watch: show the whole bar and leave it until the
        // document is replaced.
        width = CEILING;
        paint();
        return;
      }
      width = 0;
      paint();
      tickTimer = setInterval(() => {
        width = nextWidth(width);
        paint();
      }, TICK_MS);
    }, SHOW_DELAY_MS);
  }

  function stop() {
    if (showTimer !== null) clearTimeout(showTimer);
    if (tickTimer !== null) clearInterval(tickTimer);
    showTimer = null;
    tickTimer = null;
    width = 0;
    bar.hidden = true;
    paint();
  }

  document.addEventListener('click', (event) => {
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!anchor) return;
    const link = {
      href: anchor.href,
      target: anchor.getAttribute('target'),
      download: anchor.hasAttribute('download'),
    };
    if (shouldTrack(link, event, location.href)) start();
  });

  document.addEventListener('submit', (event) => {
    if (!event.defaultPrevented) start();
  });

  // Restoring from bfcache brings back the DOM as it was — bar included.
  addEventListener('pageshow', (event) => {
    if (event.persisted) stop();
  });

  // Escape is how a browser cancels a load in progress; the bar has to go with
  // it, or it sits there describing a navigation that is no longer happening.
  addEventListener('keydown', (event) => {
    if (event.key === 'Escape') stop();
  });
}
